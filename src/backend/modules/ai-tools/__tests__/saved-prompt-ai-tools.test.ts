/**
 * @file saved-prompt-ai-tools.test.ts
 *
 * Pins what the two saved-prompt AI tools promise a model. The listing leaves
 * out the prompt body and every error message, but still flags failing
 * triggers. The read finds prompts by id or case-insensitive name, returns the
 * body as an unexpanded template one page at a time, cuts long errors, and
 * reports an unknown reference without failing the rest. Neither tool ever
 * returns the owner label, which is usually an email address.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IAiTool, ISavedPrompt, ISystemLogService } from '@/types';
import { AI_TOOL_NAMES, buildSavedPromptAiTools } from '../buildSavedPromptAiTools.js';

/**
 * A stored prompt with sensible defaults.
 *
 * @param overrides - Fields that differ from a manual-only prompt.
 * @returns The prompt.
 */
function savedPrompt(overrides: Partial<ISavedPrompt> & { id: string; name: string }): ISavedPrompt {
    return {
        prompt: 'Summarise {%chain-params%}',
        ownerUserId: 'user-1',
        ownerLabel: 'admin@example.test',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-02T00:00:00.000Z',
        ...overrides
    };
}

/**
 * Build the tools over a fake service returning the given prompts.
 *
 * @param prompts - The stored prompts, newest-updated first.
 * @param failure - When set, `list()` rejects with it instead.
 * @returns The tools keyed by name and the logger.
 */
function buildTools(prompts: ISavedPrompt[], failure?: Error): { tools: Record<string, IAiTool>; logger: ISystemLogService } {
    const list = vi.fn(async () => {
        if (failure) {
            throw failure;
        }
        return prompts;
    });
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as ISystemLogService;
    const tools = Object.fromEntries(buildSavedPromptAiTools({ list }, logger).map(tool => [tool.name, tool]));
    return { tools, logger };
}

const SCHEDULED = savedPrompt({
    id: 'p-1',
    name: 'Daily summary',
    model: 'claude-opus-5',
    providerId: 'ai-assistant',
    toolAllowlist: [],
    triggers: [{ id: 't-1', kind: 'cron', cron: '0 6 * * *', enabled: false, lastRunAt: '2026-10-15T06:00:00.000Z', lastRunError: 'provider said: bad request', failureCount: 5 }]
});

const MANUAL = savedPrompt({ id: 'p-2', name: 'Ad hoc' });

describe('saved prompt AI tools', () => {
    it('are named after the module and classified as internal reads', () => {
        const { tools } = buildTools([]);

        expect(Object.keys(tools).sort()).toEqual(Object.values(AI_TOOL_NAMES).sort());
        for (const tool of Object.values(tools)) {
            expect(tool.name.startsWith('ai-')).toBe(true);
            expect(tool.capability).toEqual(expect.objectContaining({ sideEffect: 'read', reversible: true, sensitivity: 'internal' }));
        }
        expect(tools[AI_TOOL_NAMES.listPrompts].capability?.surfacesUntrustedContent).toBeFalsy();
        expect(tools[AI_TOOL_NAMES.getPrompts].capability?.surfacesUntrustedContent).toBe(true);
    });

    it('lists settings and trigger health without the body, error text, or owner label', async () => {
        const { tools } = buildTools([SCHEDULED, MANUAL]);

        const result = await tools[AI_TOOL_NAMES.listPrompts].handler({}) as { prompts: Array<Record<string, unknown>> } & Record<string, unknown>;

        expect(result).toMatchObject({ success: true, total: 2, returned: 2, truncated: false });
        expect(result.prompts[0]).toEqual({
            id: 'p-1',
            name: 'Daily summary',
            providerId: 'ai-assistant',
            model: 'claude-opus-5',
            toolAllowlist: [],
            ownerUserId: 'user-1',
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-02T00:00:00.000Z',
            promptChars: SCHEDULED.prompt.length,
            triggers: [{ id: 't-1', kind: 'cron', enabled: false, cron: '0 6 * * *', lastRunAt: '2026-10-15T06:00:00.000Z', lastRunFailed: true, failureCount: 5 }]
        });
        expect(result.prompts[1]).toMatchObject({ toolAllowlist: null, model: null, triggers: [] });
        const text = JSON.stringify(result);
        expect(text).not.toContain('Summarise');
        expect(text).not.toContain('bad request');
        expect(text).not.toContain('admin@example.test');
    });

    it('reads prompts by id and by case-insensitive name, and reports an unknown reference', async () => {
        const { tools } = buildTools([SCHEDULED, MANUAL]);

        const result = await tools[AI_TOOL_NAMES.getPrompts].handler({ prompts: ['p-1', 'ad HOC', 'missing'] }) as { prompts: Array<Record<string, unknown>> };

        expect(result.prompts[0]).toMatchObject({
            ref: 'p-1',
            status: 'ok',
            prompt: 'Summarise {%chain-params%}',
            promptOffset: 0,
            promptTruncated: false,
            nextOffset: null,
            triggers: [expect.objectContaining({ lastRunError: 'provider said: bad request' })]
        });
        expect(result.prompts[1]).toMatchObject({ ref: 'ad HOC', status: 'ok', id: 'p-2' });
        expect(result.prompts[2]).toEqual({ ref: 'missing', status: 'not-found', reason: expect.any(String) });
        expect(JSON.stringify(result)).not.toContain('admin@example.test');
    });

    it('returns the first page of a long body with the offset of the next, and cuts a long error message', async () => {
        const long = savedPrompt({
            id: 'p-3',
            name: 'Long',
            prompt: 'x'.repeat(25_000),
            triggers: [{ id: 't-2', kind: 'hook', hookId: 'content.published', enabled: true, lastRunError: 'e'.repeat(5_000) }]
        });
        const { tools } = buildTools([long]);

        const result = await tools[AI_TOOL_NAMES.getPrompts].handler({ prompts: ['p-3'] }) as { prompts: Array<Record<string, unknown>> };
        const entry = result.prompts[0] as { prompt: string; promptChars: number; promptOffset: number; promptTruncated: boolean; nextOffset: number | null; triggers: Array<{ lastRunError: string; typeIdFilter: unknown }> };

        expect(entry.prompt.length).toBe(20_000);
        expect(entry.promptChars).toBe(25_000);
        expect(entry.promptOffset).toBe(0);
        expect(entry.promptTruncated).toBe(true);
        expect(entry.nextOffset).toBe(20_000);
        expect(entry.triggers[0].lastRunError.length).toBe(2_000);
        expect(entry.triggers[0].typeIdFilter).toBeNull();
    });

    it('reads a long body to its end by following nextOffset', async () => {
        const body = Array.from({ length: 45_000 }, (_, index) => String(index % 10)).join('');
        const { tools } = buildTools([savedPrompt({ id: 'p-4', name: 'Longer', prompt: body })]);
        const tool = tools[AI_TOOL_NAMES.getPrompts];

        let offset: number | null = 0;
        let assembled = '';
        let pages = 0;
        while (offset !== null) {
            const result = await tool.handler({ prompts: ['p-4'], offset }) as { prompts: Array<Record<string, unknown>> };
            const entry = result.prompts[0] as { prompt: string; promptOffset: number; promptTruncated: boolean; nextOffset: number | null };
            expect(entry.promptOffset).toBe(offset);
            expect(entry.promptTruncated).toBe(entry.nextOffset !== null);
            assembled += entry.prompt;
            offset = entry.nextOffset;
            pages += 1;
        }

        expect(pages).toBe(3);
        expect(assembled).toBe(body);
    });

    it('returns an empty last page for an offset past the end of a body', async () => {
        const { tools } = buildTools([MANUAL]);

        const result = await tools[AI_TOOL_NAMES.getPrompts].handler({ prompts: ['p-2'], offset: 500 }) as { prompts: Array<Record<string, unknown>> };

        expect(result.prompts[0]).toEqual(expect.objectContaining({
            status: 'ok',
            prompt: '',
            promptChars: MANUAL.prompt.length,
            promptOffset: MANUAL.prompt.length,
            promptTruncated: false,
            nextOffset: null
        }));
    });

    it('refuses a bad offset argument as an input error', async () => {
        const { tools } = buildTools([MANUAL]);
        const tool = tools[AI_TOOL_NAMES.getPrompts];

        for (const offset of [-1, 1.5, '10', 1_000_001]) {
            const result = await tool.handler({ prompts: ['p-2'], offset }) as Record<string, unknown>;
            expect(result).toEqual({ success: false, error: expect.any(String), errorKind: 'input' });
        }
    });

    it('refuses a bad prompts argument as an input error', async () => {
        const { tools } = buildTools([MANUAL]);
        const tool = tools[AI_TOOL_NAMES.getPrompts];

        for (const prompts of [undefined, [], ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'], [' '], ['x'.repeat(201)], [7]]) {
            const result = await tool.handler({ prompts }) as Record<string, unknown>;
            expect(result).toEqual({ success: false, error: expect.any(String), errorKind: 'input' });
        }
    });

    it('turns a storage failure into a generic answer and logs the real error', async () => {
        const { tools, logger } = buildTools([], new Error('MongoNetworkError: 10.0.0.9'));

        const result = await tools[AI_TOOL_NAMES.listPrompts].handler({}) as Record<string, unknown>;

        expect(result).toEqual({ success: false, error: expect.any(String), errorKind: 'failed' });
        expect(JSON.stringify(result)).not.toContain('10.0.0.9');
        expect(logger.error).toHaveBeenCalled();
    });
});
