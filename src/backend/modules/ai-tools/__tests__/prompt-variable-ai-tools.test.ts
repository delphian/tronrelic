/**
 * @file prompt-variable-ai-tools.test.ts
 *
 * Pins what the two prompt-variable AI tools promise a model. The listing runs
 * no resolver and returns no value. The read never returns a secret variable
 * and never runs its resolver. Long values are cut with an honest `truncated`.
 * One bad name does not fail the others, and a bad argument comes back as an
 * input error the model can correct from.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IAiTool, IPromptVariableRegistry, IPromptVariableSummary, ISystemLogService } from '@/types';
import { AI_TOOL_NAMES, buildPromptVariableAiTools } from '../buildPromptVariableAiTools.js';

/**
 * A summary with sensible defaults.
 *
 * @param overrides - Fields that differ from an internal dynamic variable.
 * @returns The summary.
 */
function summary(overrides: Partial<IPromptVariableSummary> & { name: string }): IPromptVariableSummary {
    return {
        pattern: `{%${overrides.name}%}`,
        description: 'd',
        category: 'c',
        kind: 'dynamic',
        sensitivity: 'internal',
        ...overrides
    };
}

/**
 * Build the tools over a fake registry holding the given variables.
 *
 * @param variables - Each variable's summary and its current value.
 * @returns The tools keyed by name, the resolver spy, and the logger.
 */
function buildTools(variables: Array<{ summary: IPromptVariableSummary; value: string | Error }>): {
    tools: Record<string, IAiTool>;
    resolve: ReturnType<typeof vi.fn>;
    logger: ISystemLogService;
} {
    const resolve = vi.fn(async (name: string) => {
        const value = variables.find(v => v.summary.name === name)?.value;
        if (value === undefined || value instanceof Error) {
            throw value ?? new Error(`Unknown prompt variable: {%${name}%}`);
        }
        return value;
    });
    const registry: Pick<IPromptVariableRegistry, 'listSummaries' | 'resolve'> = {
        listSummaries: () => variables.map(v => v.summary),
        resolve
    };
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as ISystemLogService;
    const tools = Object.fromEntries(buildPromptVariableAiTools(registry, logger).map(tool => [tool.name, tool]));
    return { tools, resolve, logger };
}

describe('prompt variable AI tools', () => {
    it('are named after the module and classified as internal reads', () => {
        const { tools } = buildTools([]);

        expect(Object.keys(tools).sort()).toEqual(Object.values(AI_TOOL_NAMES).sort());
        for (const tool of Object.values(tools)) {
            expect(tool.name.startsWith('ai-')).toBe(true);
            expect(tool.capability).toEqual(expect.objectContaining({ sideEffect: 'read', reversible: true, sensitivity: 'internal' }));
        }
        expect(tools[AI_TOOL_NAMES.getVariables].capability?.surfacesUntrustedContent).toBe(true);
    });

    it('lists every variable with readable flags and never resolves one', async () => {
        const { tools, resolve } = buildTools([
            { summary: summary({ name: 'chain-params' }), value: 'params' },
            { summary: summary({ name: 'api-key', kind: 'static', sensitivity: 'secret' }), value: 'SECRET-VALUE' }
        ]);

        const result = await tools[AI_TOOL_NAMES.listVariables].handler({}) as Record<string, unknown>;

        expect(resolve).not.toHaveBeenCalled();
        expect(result).toEqual({
            success: true,
            total: 2,
            returned: 2,
            truncated: false,
            variables: [
                { name: 'chain-params', pattern: '{%chain-params%}', description: 'd', category: 'c', kind: 'dynamic', sensitivity: 'internal', readable: true },
                { name: 'api-key', pattern: '{%api-key%}', description: 'd', category: 'c', kind: 'static', sensitivity: 'secret', readable: false }
            ]
        });
        expect(JSON.stringify(result)).not.toContain('SECRET-VALUE');
    });

    it('withholds a secret variable without running its resolver, and reads the rest', async () => {
        const { tools, resolve } = buildTools([
            { summary: summary({ name: 'site-info' }), value: 'TronRelic' },
            { summary: summary({ name: 'api-key', kind: 'static', sensitivity: 'secret' }), value: 'SECRET-VALUE' }
        ]);

        const result = await tools[AI_TOOL_NAMES.getVariables].handler({ names: ['site-info', '{%api-key%}', 'ghost'] }) as Record<string, unknown>;

        expect(resolve).toHaveBeenCalledTimes(1);
        expect(resolve).toHaveBeenCalledWith('site-info');
        expect(result.success).toBe(true);
        expect(result.variables).toEqual([
            { name: 'site-info', status: 'ok', content: 'TronRelic', sizeBytes: 9, truncated: false },
            { name: 'api-key', status: 'withheld', reason: expect.any(String) },
            { name: 'ghost', status: 'not-found', reason: expect.any(String) }
        ]);
        expect(JSON.stringify(result)).not.toContain('SECRET-VALUE');
    });

    it('cuts a long value and reports the full size', async () => {
        const long = 'x'.repeat(12_000);
        const { tools } = buildTools([{ summary: summary({ name: 'log-summary' }), value: long }]);

        const result = await tools[AI_TOOL_NAMES.getVariables].handler({ names: ['log-summary'] }) as { variables: Array<Record<string, unknown>> };

        expect((result.variables[0].content as string).length).toBe(10_000);
        expect(result.variables[0].sizeBytes).toBe(12_000);
        expect(result.variables[0].truncated).toBe(true);
    });

    it('reports a resolver failure on that entry only, without the underlying error text', async () => {
        const { tools, logger } = buildTools([
            { summary: summary({ name: 'broken' }), value: new Error('connect ECONNREFUSED 10.0.0.5:6379') },
            { summary: summary({ name: 'fine' }), value: 'ok' }
        ]);

        const result = await tools[AI_TOOL_NAMES.getVariables].handler({ names: ['broken', 'fine'] }) as { variables: Array<Record<string, unknown>> };

        expect(result.variables[0]).toEqual({ name: 'broken', status: 'error', reason: expect.any(String) });
        expect(JSON.stringify(result)).not.toContain('10.0.0.5');
        expect(result.variables[1].status).toBe('ok');
        expect(logger.warn).toHaveBeenCalled();
    });

    it('refuses a bad names argument as an input error', async () => {
        const { tools, resolve } = buildTools([]);
        const tool = tools[AI_TOOL_NAMES.getVariables];

        for (const names of [undefined, [], ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'], ['has space'], [42]]) {
            const result = await tool.handler({ names }) as Record<string, unknown>;
            expect(result).toEqual({ success: false, error: expect.any(String), errorKind: 'input' });
        }
        expect(resolve).not.toHaveBeenCalled();
    });
});
