/**
 * @file saved-prompt-edits.service.test.ts
 *
 * Covers proposed saved-prompt edits: holding a proposal in curation,
 * superseding an older one, the signed-in approval rule, the stale check that
 * stops an approval overwriting a newer save, and the diff a curator reviews.
 * The store and prompt library are in-memory fakes so the rules are tested
 * without a database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ICurationService, ISavedPrompt, ISavedPromptProposal, ISystemLogService, SavedPromptProposalStatus } from '@/types';
import {
    SavedPromptEditsService,
    SavedPromptEditError,
    SAVED_PROMPT_EDIT_CURATION_TYPE_ID,
    SUPERSEDED_DECIDED_BY
} from '../services/saved-prompt-edits.service.js';
import type { SavedPromptProposalStore } from '../services/saved-prompt-proposal-store.js';

/** Logger whose every level is a no-op spy. */
function createLogger(): ISystemLogService {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn(() => logger) };
    return logger as unknown as ISystemLogService;
}

/** In-memory stand-in for the proposal store, keeping the conditional-transition rule. */
function createStore() {
    const rows = new Map<string, ISavedPromptProposal>();
    const store = {
        rows,
        insert: vi.fn(async (proposal: ISavedPromptProposal) => { rows.set(proposal.id, { ...proposal }); }),
        get: vi.fn(async (id: string) => rows.get(id) ?? null),
        listPending: vi.fn(async () => [...rows.values()].filter(row => row.status === 'pending')),
        listPendingForPrompt: vi.fn(async (promptId: string) => [...rows.values()].filter(row => row.promptId === promptId && row.status === 'pending')),
        countPending: vi.fn(async () => [...rows.values()].filter(row => row.status === 'pending').length),
        setCurationItemId: vi.fn(async (id: string, curationItemId: string) => {
            const row = rows.get(id);
            if (row) {
                row.curationItemId = curationItemId;
            }
        }),
        transition: vi.fn(async (id: string, from: SavedPromptProposalStatus, to: SavedPromptProposalStatus, fields: { decidedBy?: string; failureReason?: string } = {}) => {
            const row = rows.get(id);
            let result: ISavedPromptProposal | null = null;
            if (row && row.status === from) {
                Object.assign(row, { status: to, ...fields });
                result = { ...row };
            }
            return result;
        })
    };
    return store;
}

/** In-memory prompt library with the compare-and-swap write the service relies on. */
function createPrompts(initial: ISavedPrompt) {
    const prompts = new Map<string, ISavedPrompt>([[initial.id, { ...initial }]]);
    return {
        prompts,
        get: vi.fn(async (id: string) => prompts.get(id) ?? null),
        updatePromptIfUnchanged: vi.fn(async (id: string, expectedUpdatedAt: string, prompt: string, editedBy: string) => {
            const current = prompts.get(id);
            let result: ISavedPrompt | null = null;
            if (current && current.updatedAt === expectedUpdatedAt) {
                result = { ...current, prompt, updatedAt: 'later', lastEditedBy: editedBy };
                prompts.set(id, result);
            }
            return result;
        })
    };
}

const PROMPT: ISavedPrompt = {
    id: 'p1',
    name: 'Memo - 8 Hours',
    prompt: 'Title phrases:\n  Found inscribed on-chain\n',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z'
};

describe('SavedPromptEditsService', () => {
    let store: ReturnType<typeof createStore>;
    let prompts: ReturnType<typeof createPrompts>;
    let curation: { hold: ReturnType<typeof vi.fn>; reject: ReturnType<typeof vi.fn> };
    let service: SavedPromptEditsService;
    let holdCount: number;

    beforeEach(() => {
        store = createStore();
        prompts = createPrompts(PROMPT);
        holdCount = 0;
        curation = {
            hold: vi.fn(async () => ({ id: `item-${++holdCount}` })),
            reject: vi.fn(async () => null)
        };
        service = new SavedPromptEditsService(
            store as unknown as SavedPromptProposalStore,
            prompts,
            () => curation as unknown as ICurationService,
            createLogger()
        );
    });

    it('stores a proposal against the current version and holds it under the saved-prompt edit type', async () => {
        const result = await service.propose({
            promptId: 'p1',
            proposedPrompt: 'Title phrases:\n  Struck in a deep seam {%site-info%}\n',
            reason: 'Mining motif',
            source: 'ai-tool:test (mcp)',
            proposedBy: 'user-1'
        });

        expect(curation.hold).toHaveBeenCalledWith({
            typeId: SAVED_PROMPT_EDIT_CURATION_TYPE_ID,
            ref: { proposalId: result.proposal.id },
            source: 'ai-tool:test (mcp)'
        });
        const stored = store.rows.get(result.proposal.id);
        expect(stored?.baseUpdatedAt).toBe(PROMPT.updatedAt);
        expect(stored?.curationItemId).toBe('item-1');
        expect(result.variablesAdded).toEqual(['{%site-info%}']);
    });

    it('withdraws an older pending proposal for the same prompt when a newer one arrives', async () => {
        const first = await service.propose({ promptId: 'p1', proposedPrompt: 'first', reason: 'r', source: 's' });
        const second = await service.propose({ promptId: 'p1', proposedPrompt: 'second', reason: 'r', source: 's' });

        expect(second.supersededCount).toBe(1);
        expect(store.rows.get(first.proposal.id)?.status).toBe('superseded');
        expect(curation.reject).toHaveBeenCalledWith('item-1', SUPERSEDED_DECIDED_BY);
        expect(store.rows.get(second.proposal.id)?.status).toBe('pending');
    });

    it('refuses an unchanged body and an unknown prompt', async () => {
        await expect(service.propose({ promptId: 'p1', proposedPrompt: PROMPT.prompt, reason: 'r', source: 's' }))
            .rejects.toBeInstanceOf(SavedPromptEditError);
        await expect(service.propose({ promptId: 'missing', proposedPrompt: 'x', reason: 'r', source: 's' }))
            .rejects.toBeInstanceOf(SavedPromptEditError);
        expect(curation.hold).not.toHaveBeenCalled();
    });

    it('writes the body when a signed-in curator approves, attributing the edit to them', async () => {
        const { proposal } = await service.propose({ promptId: 'p1', proposedPrompt: 'new body', reason: 'r', source: 's' });

        await service.applyDecision(proposal.id, 'applied', 'admin-1');

        expect(prompts.updatePromptIfUnchanged).toHaveBeenCalledWith('p1', PROMPT.updatedAt, 'new body', 'admin-1');
        expect(prompts.prompts.get('p1')?.prompt).toBe('new body');
        expect(store.rows.get(proposal.id)?.status).toBe('applied');
    });

    it('refuses an approval no signed-in person made, leaving the proposal pending', async () => {
        const { proposal } = await service.propose({ promptId: 'p1', proposedPrompt: 'new body', reason: 'r', source: 's' });

        await expect(service.applyDecision(proposal.id, 'applied', undefined)).rejects.toThrow(/signed-in admin/);
        await expect(service.applyDecision(proposal.id, 'applied', 'system:policy-auto-approve')).rejects.toThrow(/signed-in admin/);

        expect(prompts.updatePromptIfUnchanged).not.toHaveBeenCalled();
        expect(store.rows.get(proposal.id)?.status).toBe('pending');
    });

    /** Guards against an approval overwriting a save an admin made after the proposal. */
    it('marks an approval failed and writes nothing when the prompt changed since the proposal', async () => {
        const { proposal } = await service.propose({ promptId: 'p1', proposedPrompt: 'new body', reason: 'r', source: 's' });
        prompts.prompts.set('p1', { ...PROMPT, prompt: 'admin edit', updatedAt: '2026-03-01T00:00:00.000Z' });

        await expect(service.applyDecision(proposal.id, 'applied', 'admin-1')).rejects.toThrow(/changed or deleted/);

        expect(prompts.prompts.get('p1')?.prompt).toBe('admin edit');
        expect(store.rows.get(proposal.id)?.status).toBe('failed');
    });

    it('treats a repeated decision as a no-op', async () => {
        const { proposal } = await service.propose({ promptId: 'p1', proposedPrompt: 'new body', reason: 'r', source: 's' });
        await service.applyDecision(proposal.id, 'rejected', 'admin-1');

        await service.applyDecision(proposal.id, 'applied', 'admin-1');

        expect(prompts.updatePromptIfUnchanged).not.toHaveBeenCalled();
        expect(store.rows.get(proposal.id)?.status).toBe('rejected');
    });

    it('compares the proposal with the live prompt, listing referenced variables separately', async () => {
        const { proposal } = await service.propose({ promptId: 'p1', proposedPrompt: 'Use {%chain-params%} now', reason: 'r', source: 's' });

        const changes = await service.describeChanges(proposal.id);

        expect(changes?.baseline).toBe('approved');
        expect(changes?.changes.map(change => change.label)).toEqual(['Prompt body', 'Prompt variables referenced']);
    });

    it('always gives the review descriptor a title, so the hold notification never carries the body', async () => {
        const { proposal } = await service.propose({ promptId: 'p1', proposedPrompt: 'new body', reason: 'r', source: 's' });

        const descriptor = await service.describe(proposal.id);

        expect(descriptor.title).toBe('Saved prompt edit: Memo - 8 Hours');
        expect(descriptor.editable).toBe(false);
    });
});
