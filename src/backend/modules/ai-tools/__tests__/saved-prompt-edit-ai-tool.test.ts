/**
 * @file saved-prompt-edit-ai-tool.test.ts
 *
 * Covers `ai-propose-saved-prompt-edit`: the trigger paths it refuses, the
 * admin check for MCP callers, and how find-and-replace edits build the
 * proposed body. The edits service is a spy, so these tests stop at the hand-off.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ISavedPrompt, ISystemLogService, IToolEndUserPrincipal, IToolHandlerContext } from '@/types';
import { buildSavedPromptEditAiTool } from '../buildSavedPromptEditAiTool.js';

/** Logger whose every level is a no-op spy. */
function createLogger(): ISystemLogService {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn(() => logger) };
    return logger as unknown as ISystemLogService;
}

const PROMPT: ISavedPrompt = {
    id: 'p1',
    name: 'Memo - 8 Hours',
    prompt: 'Phrases:\n  Found inscribed on-chain\n  Carved into the chain\n  Carved into the chain again\n',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z'
};

const ADMIN: IToolEndUserPrincipal = { userId: 'admin-1' } as IToolEndUserPrincipal;

/** Handler context for a given trigger path. */
function onPath(triggerPath: IToolHandlerContext['triggerPath']): IToolHandlerContext {
    return { triggerPath };
}

describe('ai-propose-saved-prompt-edit', () => {
    let propose: ReturnType<typeof vi.fn>;
    let isAdminUser: (userId: string) => Promise<boolean>;
    let tool: ReturnType<typeof buildSavedPromptEditAiTool>;

    beforeEach(() => {
        propose = vi.fn(async (input: { proposedPrompt: string }) => ({
            proposal: { id: 'prop-1', proposedPrompt: input.proposedPrompt },
            supersededCount: 0,
            variablesAdded: [],
            variablesRemoved: []
        }));
        isAdminUser = vi.fn(async (userId: string) => userId === 'admin-1');
        tool = buildSavedPromptEditAiTool({
            savedPrompts: { list: async () => [PROMPT] },
            edits: { propose } as never,
            isAdminUser,
            logger: createLogger()
        });
    });

    it('declares a self-curated write bound to the saved-prompt edit curation type', () => {
        expect(tool.capability).toMatchObject({
            sideEffect: 'write',
            forcesCuratorReview: true,
            curationTypeId: 'ai-tools:saved-prompt-edit'
        });
    });

    /** Guards against an unattended prompt, steered by untrusted text, rewriting prompts. */
    it.each(['scheduled', 'programmatic'] as const)('refuses the %s trigger path', async (path) => {
        const result = await tool.handler(
            { prompt: 'p1', reason: 'r', newPrompt: 'x' },
            ADMIN,
            onPath(path)
        ) as Record<string, unknown>;

        expect(result).toMatchObject({ success: false, errorKind: 'input' });
        expect(propose).not.toHaveBeenCalled();
    });

    it('refuses an MCP caller who is not an admin', async () => {
        const result = await tool.handler(
            { prompt: 'p1', reason: 'r', newPrompt: 'x' },
            { userId: 'member-1' } as IToolEndUserPrincipal,
            onPath('mcp')
        ) as Record<string, unknown>;

        expect(result).toMatchObject({ success: false, errorKind: 'input' });
        expect(propose).not.toHaveBeenCalled();
    });

    it('applies find-and-replace edits and proposes the result for an admin over MCP', async () => {
        const result = await tool.handler(
            {
                prompt: 'memo - 8 hours',
                reason: 'Mining motif',
                edits: [{ find: 'Found inscribed on-chain', replace: 'Struck in a deep seam' }]
            },
            ADMIN,
            onPath('mcp')
        ) as Record<string, unknown>;

        expect(result).toMatchObject({ success: true, pendingReview: true, proposalId: 'prop-1', promptId: 'p1' });
        expect(propose).toHaveBeenCalledWith(expect.objectContaining({
            promptId: 'p1',
            proposedPrompt: PROMPT.prompt.replace('Found inscribed on-chain', 'Struck in a deep seam'),
            proposedBy: 'admin-1',
            source: 'ai-tool:ai-propose-saved-prompt-edit (mcp)'
        }));
    });

    it('refuses an edit whose find text matches more than one place', async () => {
        const result = await tool.handler(
            { prompt: 'p1', reason: 'r', edits: [{ find: 'Carved into the chain', replace: 'Chipped from the chain face' }] },
            ADMIN,
            onPath('interactive')
        ) as Record<string, unknown>;

        expect(result).toMatchObject({ success: false, errorKind: 'input' });
        expect(String(result.error)).toMatch(/more than once/);
        expect(propose).not.toHaveBeenCalled();
    });

    it('requires exactly one of edits or newPrompt', async () => {
        const result = await tool.handler({ prompt: 'p1', reason: 'r' }, ADMIN, onPath('interactive')) as Record<string, unknown>;

        expect(result).toMatchObject({ success: false, errorKind: 'input' });
    });
});
