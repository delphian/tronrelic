/**
 * @file prompt-variable-edits.service.test.ts
 *
 * Covers proposed prompt-variable edits: holding a proposal in curation,
 * refusing built-in and secret variables, superseding an older proposal, the
 * signed-in approval rule, the stale check that stops an approval overwriting
 * a newer change, and what the review screen shows. The store and registry are
 * in-memory fakes so the rules are tested without a database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ICurationService, IPromptVariableProposal, ISavedPrompt, IStaticPromptVariable, ISystemLogService, PromptVariableProposalStatus } from '@/types';
import {
    PromptVariableEditsService,
    PromptVariableEditError,
    PROMPT_VARIABLE_EDIT_CURATION_TYPE_ID
} from '../services/PromptVariableEditsService.js';
import { SUPERSEDED_DECIDED_BY } from '../services/ProposalCurationQueue.js';
import type { ProposalStore } from '../services/ProposalStore.js';

/** Logger whose every level is a no-op spy. */
function createLogger(): ISystemLogService {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn(() => logger) };
    return logger as unknown as ISystemLogService;
}

/** In-memory stand-in for the proposal store, keeping the conditional-transition rule. */
function createStore() {
    const rows = new Map<string, IPromptVariableProposal>();
    return {
        rows,
        insert: vi.fn(async (proposal: IPromptVariableProposal) => { rows.set(proposal.id, { ...proposal }); }),
        get: vi.fn(async (id: string) => rows.get(id) ?? null),
        listPending: vi.fn(async () => [...rows.values()].filter(row => row.status === 'pending')),
        listPendingFor: vi.fn(async (name: string) => [...rows.values()].filter(row => row.variableName === name && row.status === 'pending')),
        countPending: vi.fn(async () => [...rows.values()].filter(row => row.status === 'pending').length),
        setCurationItemId: vi.fn(async (id: string, curationItemId: string) => {
            const row = rows.get(id);
            if (row) {
                row.curationItemId = curationItemId;
            }
        }),
        transition: vi.fn(async (id: string, from: PromptVariableProposalStatus, to: PromptVariableProposalStatus, fields: { decidedBy?: string; failureReason?: string } = {}) => {
            const row = rows.get(id);
            let result: IPromptVariableProposal | null = null;
            if (row && row.status === from) {
                Object.assign(row, { status: to, ...fields });
                result = { ...row };
            }
            return result;
        })
    };
}

/** In-memory static variables with the compare-and-swap write the service relies on. */
function createVariables(initial: IStaticPromptVariable[]) {
    const statics = new Map(initial.map(variable => [variable.name, { ...variable }]));
    return {
        statics,
        getStatic: vi.fn((name: string) => statics.get(name)),
        updateStaticContentIfUnchanged: vi.fn(async (name: string, expectedUpdatedAt: string, content: string) => {
            const current = statics.get(name);
            let result: IStaticPromptVariable | null = null;
            if (current && current.updatedAt === expectedUpdatedAt) {
                result = { ...current, content, updatedAt: 'later' };
                statics.set(name, result);
            }
            return result;
        })
    };
}

const SOURCES: IStaticPromptVariable = {
    name: 'news-source-urls',
    description: 'External news sources',
    category: 'News',
    sensitivity: 'internal',
    content: '\nSOURCE: forum\n  Select: keep TRON news.\n',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z'
};

const VAULT: IStaticPromptVariable = { ...SOURCES, name: 'vault-key', sensitivity: 'secret', content: 'hunter2' };

const NEWS_PROMPT = { id: 'p1', name: 'News - Last 24 Hours', prompt: 'Read {%news-source-urls%} first.' } as ISavedPrompt;

describe('PromptVariableEditsService', () => {
    let store: ReturnType<typeof createStore>;
    let variables: ReturnType<typeof createVariables>;
    let curation: { hold: ReturnType<typeof vi.fn>; reject: ReturnType<typeof vi.fn> };
    let service: PromptVariableEditsService;
    let holdCount: number;

    beforeEach(() => {
        store = createStore();
        variables = createVariables([SOURCES, VAULT]);
        holdCount = 0;
        curation = {
            hold: vi.fn(async () => ({ id: `item-${++holdCount}` })),
            reject: vi.fn(async () => null)
        };
        service = new PromptVariableEditsService(
            store as unknown as ProposalStore<IPromptVariableProposal>,
            variables,
            async () => [NEWS_PROMPT],
            () => curation as unknown as ICurationService,
            createLogger()
        );
    });

    it('stores a proposal against the current version, holds it, and names the prompts it reaches', async () => {
        const result = await service.propose({
            variableName: 'news-source-urls',
            proposedContent: '\nSOURCE: forum\n  Select: keep TRON news; drop repeat self-promotion.\n',
            reason: 'Stop repeat product coverage',
            source: 'ai-tool:test (mcp)',
            proposedBy: 'user-1'
        });

        expect(curation.hold).toHaveBeenCalledWith({
            typeId: PROMPT_VARIABLE_EDIT_CURATION_TYPE_ID,
            ref: { proposalId: result.proposal.id },
            source: 'ai-tool:test (mcp)'
        });
        const stored = store.rows.get(result.proposal.id);
        expect(stored?.baseUpdatedAt).toBe(SOURCES.updatedAt);
        expect(stored?.curationItemId).toBe('item-1');
        expect(result.referencedBy).toEqual(['News - Last 24 Hours']);
    });

    /** Guards against the review diff showing a secret's current value, which the read tools withhold. */
    it('refuses a secret variable, an unknown name, unchanged text, and empty text', async () => {
        const base = { reason: 'r', source: 's' };
        await expect(service.propose({ ...base, variableName: 'vault-key', proposedContent: 'x' })).rejects.toBeInstanceOf(PromptVariableEditError);
        await expect(service.propose({ ...base, variableName: 'chain-params', proposedContent: 'x' })).rejects.toBeInstanceOf(PromptVariableEditError);
        await expect(service.propose({ ...base, variableName: 'news-source-urls', proposedContent: SOURCES.content })).rejects.toBeInstanceOf(PromptVariableEditError);
        await expect(service.propose({ ...base, variableName: 'news-source-urls', proposedContent: '  \n' })).rejects.toBeInstanceOf(PromptVariableEditError);
        expect(curation.hold).not.toHaveBeenCalled();
    });

    it('withdraws an older pending proposal for the same variable when a newer one arrives', async () => {
        const first = await service.propose({ variableName: 'news-source-urls', proposedContent: 'first', reason: 'r', source: 's' });
        const second = await service.propose({ variableName: 'news-source-urls', proposedContent: 'second', reason: 'r', source: 's' });

        expect(second.supersededCount).toBe(1);
        expect(store.rows.get(first.proposal.id)?.status).toBe('superseded');
        expect(curation.reject).toHaveBeenCalledWith('item-1', SUPERSEDED_DECIDED_BY);
    });

    it('writes the text when a signed-in curator approves', async () => {
        const { proposal } = await service.propose({ variableName: 'news-source-urls', proposedContent: 'new text', reason: 'r', source: 's' });

        await service.applyDecision(proposal.id, 'applied', 'admin-1');

        expect(variables.updateStaticContentIfUnchanged).toHaveBeenCalledWith('news-source-urls', SOURCES.updatedAt, 'new text');
        expect(variables.statics.get('news-source-urls')?.content).toBe('new text');
        expect(store.rows.get(proposal.id)?.status).toBe('applied');
    });

    it('refuses an approval no signed-in person made, leaving the proposal pending', async () => {
        const { proposal } = await service.propose({ variableName: 'news-source-urls', proposedContent: 'new text', reason: 'r', source: 's' });

        await expect(service.applyDecision(proposal.id, 'applied', undefined)).rejects.toThrow(/signed-in admin/);
        await expect(service.applyDecision(proposal.id, 'applied', 'system:policy-auto-approve')).rejects.toThrow(/signed-in admin/);

        expect(variables.updateStaticContentIfUnchanged).not.toHaveBeenCalled();
        expect(store.rows.get(proposal.id)?.status).toBe('pending');
    });

    /** Guards against an approval overwriting an edit or reclassification an admin made after the proposal. */
    it('marks an approval failed and writes nothing when the variable changed since the proposal', async () => {
        const { proposal } = await service.propose({ variableName: 'news-source-urls', proposedContent: 'new text', reason: 'r', source: 's' });
        variables.statics.set('news-source-urls', { ...SOURCES, content: 'admin edit', updatedAt: '2026-03-01T00:00:00.000Z' });

        await expect(service.applyDecision(proposal.id, 'applied', 'admin-1')).rejects.toThrow(/changed, reclassified, or deleted/);

        expect(variables.statics.get('news-source-urls')?.content).toBe('admin edit');
        expect(store.rows.get(proposal.id)?.status).toBe('failed');
    });

    it('treats a repeated decision as a no-op', async () => {
        const { proposal } = await service.propose({ variableName: 'news-source-urls', proposedContent: 'new text', reason: 'r', source: 's' });
        await service.applyDecision(proposal.id, 'rejected', 'admin-1');

        await service.applyDecision(proposal.id, 'applied', 'admin-1');

        expect(variables.updateStaticContentIfUnchanged).not.toHaveBeenCalled();
        expect(store.rows.get(proposal.id)?.status).toBe('rejected');
    });

    /**
     * Guards against a leak: reclassifying a variable secret withdraws its
     * proposal, the withdrawal freezes this comparison into curation history,
     * and that history is readable with the shared admin service token.
     */
    it('gives no comparison once the variable has been reclassified secret', async () => {
        const { proposal } = await service.propose({ variableName: 'news-source-urls', proposedContent: 'new text', reason: 'r', source: 's' });
        variables.statics.set('news-source-urls', { ...SOURCES, sensitivity: 'secret', content: 'new secret', updatedAt: 'later' });

        expect(await service.describeChanges(proposal.id)).toBeNull();
    });

    it('gives the review screen a title, a diff against the live text, and the prompts it reaches', async () => {
        const { proposal } = await service.propose({ variableName: 'news-source-urls', proposedContent: 'new text', reason: 'r', source: 's' });

        const descriptor = await service.describe(proposal.id);
        const changes = await service.describeChanges(proposal.id);

        expect(descriptor.title).toBe('Prompt variable edit: {%news-source-urls%}');
        expect(descriptor.editable).toBe(false);
        expect(descriptor.details).toContainEqual({ label: 'Used by saved prompts', value: 'News - Last 24 Hours' });
        expect(changes?.changes.map(change => change.label)).toEqual(['Variable text']);
    });
});
