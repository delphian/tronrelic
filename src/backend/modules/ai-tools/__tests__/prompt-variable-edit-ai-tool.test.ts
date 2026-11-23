/**
 * @file prompt-variable-edit-ai-tool.test.ts
 *
 * Covers `ai-propose-prompt-variable-edit`: the trigger paths it refuses, the
 * admin check for MCP callers, the variables it will not touch, and how
 * find-and-replace edits build the proposed text. The edits service is a spy,
 * so these tests stop at the hand-off.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IStaticPromptVariable, ISystemLogService, IToolEndUserPrincipal, IToolHandlerContext } from '@/types';
import { buildPromptVariableEditAiTool } from '../buildPromptVariableEditAiTool.js';

/** Logger whose every level is a no-op spy. */
function createLogger(): ISystemLogService {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn(() => logger) };
    return logger as unknown as ISystemLogService;
}

const SOURCES: IStaticPromptVariable = {
    name: 'news-source-urls',
    description: 'External news sources',
    category: 'News',
    sensitivity: 'internal',
    content: 'SOURCE: forum\n  Authority: LOW.\nSOURCE: tips\n  Authority: LOW.\n',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z'
};

const VAULT: IStaticPromptVariable = { ...SOURCES, name: 'vault-key', sensitivity: 'secret', content: 'hunter2' };

const ADMIN: IToolEndUserPrincipal = { userId: 'admin-1' } as IToolEndUserPrincipal;

/** Handler context for a given trigger path. */
function onPath(triggerPath: IToolHandlerContext['triggerPath']): IToolHandlerContext {
    return { triggerPath };
}

describe('ai-propose-prompt-variable-edit', () => {
    let propose: ReturnType<typeof vi.fn>;
    let tool: ReturnType<typeof buildPromptVariableEditAiTool>;

    beforeEach(() => {
        propose = vi.fn(async (input: { proposedContent: string }) => ({
            proposal: { id: 'prop-1', proposedContent: input.proposedContent },
            supersededCount: 0,
            referencedBy: ['News - Last 24 Hours']
        }));
        const statics = new Map([[SOURCES.name, SOURCES], [VAULT.name, VAULT]]);
        tool = buildPromptVariableEditAiTool({
            variables: { getStatic: (name: string) => statics.get(name) },
            edits: { propose } as never,
            isAdminUser: vi.fn(async (userId: string) => userId === 'admin-1'),
            logger: createLogger()
        });
    });

    it('declares a self-curated write bound to the prompt-variable edit curation type', () => {
        expect(tool.capability).toMatchObject({
            sideEffect: 'write',
            forcesCuratorReview: true,
            curationTypeId: 'ai-tools:prompt-variable-edit'
        });
    });

    /** Guards against an unattended prompt, steered by untrusted text, rewriting the text every prompt receives. */
    it.each(['scheduled', 'programmatic'] as const)('refuses the %s trigger path', async (path) => {
        const result = await tool.handler({ variable: 'news-source-urls', reason: 'r', newContent: 'x' }, ADMIN, onPath(path)) as Record<string, unknown>;

        expect(result).toMatchObject({ success: false, errorKind: 'input' });
        expect(propose).not.toHaveBeenCalled();
    });

    it('refuses an MCP caller who is not an admin', async () => {
        const result = await tool.handler(
            { variable: 'news-source-urls', reason: 'r', newContent: 'x' },
            { userId: 'member-1' } as IToolEndUserPrincipal,
            onPath('mcp')
        ) as Record<string, unknown>;

        expect(result).toMatchObject({ success: false, errorKind: 'input' });
        expect(propose).not.toHaveBeenCalled();
    });

    it('refuses a secret variable and a name that is not an admin-authored variable', async () => {
        const secret = await tool.handler({ variable: 'vault-key', reason: 'r', newContent: 'x' }, ADMIN, onPath('interactive')) as Record<string, unknown>;
        const builtIn = await tool.handler({ variable: 'chain-params', reason: 'r', newContent: 'x' }, ADMIN, onPath('interactive')) as Record<string, unknown>;

        expect(secret).toMatchObject({ success: false, errorKind: 'input' });
        expect(builtIn).toMatchObject({ success: false, errorKind: 'input' });
        expect(propose).not.toHaveBeenCalled();
    });

    it('accepts the {%name%} pattern, applies edits, and proposes the result for an admin over MCP', async () => {
        const result = await tool.handler(
            {
                variable: '{%news-source-urls%}',
                reason: 'Drop repeat self-promotion',
                edits: [{ find: 'SOURCE: forum\n  Authority: LOW.', replace: 'SOURCE: forum\n  Authority: LOW. Cover own-product topics once.' }]
            },
            ADMIN,
            onPath('mcp')
        ) as Record<string, unknown>;

        expect(result).toMatchObject({ success: true, pendingReview: true, proposalId: 'prop-1', variable: '{%news-source-urls%}', referencedBy: ['News - Last 24 Hours'] });
        expect(propose).toHaveBeenCalledWith(expect.objectContaining({
            variableName: 'news-source-urls',
            proposedContent: SOURCES.content.replace('SOURCE: forum\n  Authority: LOW.', 'SOURCE: forum\n  Authority: LOW. Cover own-product topics once.'),
            proposedBy: 'admin-1',
            source: 'ai-tool:ai-propose-prompt-variable-edit (mcp)'
        }));
    });

    it('refuses an edit whose find text matches more than one place', async () => {
        const result = await tool.handler(
            { variable: 'news-source-urls', reason: 'r', edits: [{ find: 'Authority: LOW.', replace: 'Authority: MEDIUM.' }] },
            ADMIN,
            onPath('interactive')
        ) as Record<string, unknown>;

        expect(result).toMatchObject({ success: false, errorKind: 'input' });
        expect(String(result.error)).toMatch(/more than once/);
        expect(propose).not.toHaveBeenCalled();
    });

    it('requires exactly one of edits or newContent', async () => {
        const result = await tool.handler({ variable: 'news-source-urls', reason: 'r' }, ADMIN, onPath('interactive')) as Record<string, unknown>;

        expect(result).toMatchObject({ success: false, errorKind: 'input' });
    });
});
