/**
 * @file prompt-run-ai-tools.test.ts
 *
 * Pins what the three prompt-run AI tools promise a model. The listing pages
 * honestly (a `nextOffset` that stops on the last page), passes only validated
 * filters to the history, names the saved prompt a run came from, and never
 * carries an answer, transcript, or error text. The summary applies the same
 * filters and averages cost over priced runs only. The transcript read is classified
 * `secret`, finds a run by its own id or by conversation id, keeps the
 * allowlist's "unknown" state apart from "unrestricted", does not return the
 * answer twice, cuts each text field to the per-field limit, and pages a long
 * run so every segment is reachable and none is cut by the page total.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IAiQueryRecord, IAiTool, ISystemLogService } from '@/types';
import { AI_TOOL_NAMES, buildPromptRunAiTools } from '../buildPromptRunAiTools.js';
import type { IAiQueryHistoryFilter, IAiQueryRunSummary } from '../services/ai-query-history.service.js';

/** What the history reports when no run matches, the fake's default summary. */
const EMPTY_SUMMARY: IAiQueryRunSummary = {
    runs: 0,
    byStatus: {},
    byOutcome: {},
    costUsd: 0,
    pricedRuns: 0,
    inputTokens: 0,
    outputTokens: 0,
    firstRunAt: null,
    lastRunAt: null,
    lastAnsweredAt: null,
    lastAnsweredRunId: null
};

/**
 * A stored turn with sensible defaults.
 *
 * @param overrides - Fields that differ from a completed scheduled run.
 * @returns The record.
 */
function run(overrides: Partial<IAiQueryRecord> & { id: string }): IAiQueryRecord {
    return {
        mode: 'scheduled',
        prompt: 'Summarise {%chain-params%}',
        responseText: 'All quiet.',
        model: 'claude-opus-5',
        usage: { inputTokens: 100, outputTokens: 20 },
        costUsd: 0.01,
        errorMessage: null,
        status: 'completed',
        outcome: 'answered',
        createdAt: '2026-10-15T06:00:00.000Z',
        completedAt: '2026-10-15T06:00:10.000Z',
        ...overrides
    };
}

/**
 * Build the tools over a fake history holding the given records.
 *
 * @param records - Every stored turn, newest first.
 * @returns The tools keyed by name and the fake's spies.
 */
function buildTools(records: IAiQueryRecord[], summary: IAiQueryRunSummary = EMPTY_SUMMARY): {
    tools: Record<string, IAiTool>;
    list: ReturnType<typeof vi.fn>;
    summarize: ReturnType<typeof vi.fn>;
} {
    const summarize = vi.fn(async (_filter: IAiQueryHistoryFilter) => summary);
    const list = vi.fn(async (query: { limit?: number; offset?: number } = {}) => {
        const limit = query.limit ?? 50;
        const offset = query.offset ?? 0;
        return { records: records.slice(offset, offset + limit), total: records.length };
    });
    const history = {
        list,
        get: vi.fn(async (id: string) => records.find(record => record.id === id) ?? null),
        getConversation: vi.fn(async (conversationId: string) => records
            .filter(record => record.conversationId === conversationId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
        summarize
    };
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as ISystemLogService;
    const tools = Object.fromEntries(buildPromptRunAiTools(history, logger).map(tool => [tool.name, tool]));
    return { tools, list, summarize };
}

const WITH_TRANSCRIPT = run({
    id: 'r-2',
    conversationId: 'c-1',
    createdAt: '2026-10-15T07:00:00.000Z',
    responseText: 'Second answer',
    toolAllowlist: null,
    transcript: [
        { type: 'tool_use', id: 'tu-1', name: 'blockchain-get-block', input: { height: 1 } },
        { type: 'tool_result', toolUseId: 'tu-1', content: '{"memo":"gm"}' },
        { type: 'text', text: 'Second answer' }
    ]
});

const FIRST_TURN = run({ id: 'r-1', conversationId: 'c-1', errorMessage: null });

describe('prompt run AI tools', () => {
    it('are named after the module, with only the transcript read classified secret', () => {
        const { tools } = buildTools([]);

        expect(Object.keys(tools).sort()).toEqual(Object.values(AI_TOOL_NAMES).sort());
        expect(tools[AI_TOOL_NAMES.listRuns].capability).toEqual({ sideEffect: 'read', reversible: true, sensitivity: 'internal' });
        expect(tools[AI_TOOL_NAMES.getRun].capability).toEqual({ sideEffect: 'read', reversible: true, sensitivity: 'secret', surfacesUntrustedContent: true });
        expect(tools[AI_TOOL_NAMES.summarizeRuns].capability).toEqual({ sideEffect: 'read', reversible: true, sensitivity: 'internal' });
    });

    it('passes validated filters to the history, rewriting time bounds into the stored shape', async () => {
        const { tools, list } = buildTools([]);

        await tools[AI_TOOL_NAMES.listRuns].handler({
            savedPromptId: ' c1c4ed1d ',
            mode: 'scheduled',
            status: 'incomplete',
            outcome: 'empty',
            since: '2026-10-01T02:00:00+02:00',
            until: '2026-10-31T23:59:59Z',
            limit: 10
        });

        expect(list).toHaveBeenCalledWith({
            savedPromptId: 'c1c4ed1d',
            mode: 'scheduled',
            status: 'incomplete',
            outcome: 'empty',
            since: '2026-10-01T00:00:00.000Z',
            until: '2026-10-31T23:59:59.000Z',
            limit: 10,
            offset: 0
        });
    });

    it('returns the saved prompt and trigger a run came from, and null for a run with neither', async () => {
        const linked = run({ id: 'r-9', savedPromptId: 'news', triggerId: 'cron-1' });
        const { tools } = buildTools([linked, run({ id: 'r-8', mode: 'stream' })]);

        const result = await tools[AI_TOOL_NAMES.listRuns].handler({}) as { runs: Array<Record<string, unknown>> };

        expect(result.runs[0]).toMatchObject({ id: 'r-9', savedPromptId: 'news', triggerId: 'cron-1' });
        expect(result.runs[1]).toMatchObject({ id: 'r-8', savedPromptId: null, triggerId: null });
    });

    it('refuses a bad filter as an input error without reading the history', async () => {
        const { tools, list, summarize } = buildTools([]);

        const badInputs: Array<Record<string, unknown>> = [
            { savedPromptId: '' },
            { savedPromptId: 7 },
            { mode: 'cron' },
            { status: 'succeeded' },
            { outcome: 'timeout' },
            { since: 'last week' },
            { since: '2026-10-31T00:00:00Z', until: '2026-10-01T00:00:00Z' }
        ];
        for (const input of badInputs) {
            for (const name of [AI_TOOL_NAMES.listRuns, AI_TOOL_NAMES.summarizeRuns]) {
                const result = await tools[name].handler(input) as Record<string, unknown>;
                expect(result).toEqual({ success: false, error: expect.any(String), errorKind: 'input' });
            }
        }
        expect(list).not.toHaveBeenCalled();
        expect(summarize).not.toHaveBeenCalled();
    });

    it('summarizes with the applied filters and an average over priced runs only', async () => {
        const summary: IAiQueryRunSummary = {
            ...EMPTY_SUMMARY,
            runs: 30,
            byStatus: { completed: 26, failed: 4 },
            byOutcome: { answered: 25, empty: 1, failed: 4 },
            costUsd: 6,
            pricedRuns: 24,
            firstRunAt: '2026-10-01T23:45:00.000Z',
            lastRunAt: '2026-10-27T23:46:00.000Z',
            lastAnsweredAt: '2026-10-25T23:45:00.000Z',
            lastAnsweredRunId: 'r-25'
        };
        const { tools, summarize } = buildTools([], summary);

        const result = await tools[AI_TOOL_NAMES.summarizeRuns].handler({ savedPromptId: 'news', since: '2026-10-01T00:00:00Z' }) as Record<string, unknown>;

        expect(summarize).toHaveBeenCalledWith({ savedPromptId: 'news', since: '2026-10-01T00:00:00.000Z' });
        expect(result).toMatchObject({
            success: true,
            filters: { savedPromptId: 'news', since: '2026-10-01T00:00:00.000Z' },
            runs: 30,
            byStatus: { completed: 26, failed: 4 },
            costUsd: 6,
            pricedRuns: 24,
            averageCostUsd: 0.25,
            lastAnsweredRunId: 'r-25'
        });
    });

    it('reports no average cost when no run was priced', async () => {
        const { tools } = buildTools([], { ...EMPTY_SUMMARY, runs: 2, byStatus: { failed: 2 } });

        const result = await tools[AI_TOOL_NAMES.summarizeRuns].handler({}) as Record<string, unknown>;

        expect(result).toMatchObject({ runs: 2, pricedRuns: 0, averageCostUsd: null });
    });

    it('pages newest first and stops nextOffset on the last page', async () => {
        const records = Array.from({ length: 30 }, (_, i) => run({ id: `r-${i}` }));
        const { tools, list } = buildTools(records);
        const tool = tools[AI_TOOL_NAMES.listRuns];

        const first = await tool.handler({}) as Record<string, unknown>;
        const last = await tool.handler({ limit: 10, offset: 25 }) as Record<string, unknown>;

        expect(list).toHaveBeenCalledWith({ limit: 25, offset: 0 });
        expect(first).toMatchObject({ success: true, total: 30, offset: 0, limit: 25, returned: 25, nextOffset: 25 });
        expect(last).toMatchObject({ returned: 5, nextOffset: null });
    });

    it('lists metadata and a prompt preview without answers, transcripts, or error text', async () => {
        const failed = run({ id: 'r-3', status: 'failed', outcome: 'failed', responseText: null, errorMessage: 'upstream said 10.0.0.7 refused' });
        const { tools } = buildTools([WITH_TRANSCRIPT, failed]);

        const result = await tools[AI_TOOL_NAMES.listRuns].handler({}) as { runs: Array<Record<string, unknown>> };

        expect(result.runs[0]).toMatchObject({ id: 'r-2', conversationId: 'c-1', promptPreview: 'Summarise {%chain-params%}', toolCalls: 1, hasTranscript: true });
        expect(result.runs[1]).toMatchObject({ id: 'r-3', status: 'failed', hasTranscript: false });
        const text = JSON.stringify(result);
        expect(text).not.toContain('Second answer');
        expect(text).not.toContain('gm');
        expect(text).not.toContain('10.0.0.7');
    });

    it('reads one turn by run id without repeating the answer outside the transcript', async () => {
        const { tools } = buildTools([WITH_TRANSCRIPT, FIRST_TURN]);

        const result = await tools[AI_TOOL_NAMES.getRun].handler({ id: 'r-2' }) as { turns: Array<Record<string, unknown>> } & Record<string, unknown>;

        expect(result).toMatchObject({ success: true, found: true, matchedBy: 'run', turnsTruncated: false, truncatedFields: 0 });
        expect(result.turns).toHaveLength(1);
        expect(result.turns[0]).toMatchObject({
            id: 'r-2',
            toolAllowlistKnown: true,
            toolAllowlist: null,
            responseText: null,
            transcript: [
                { type: 'tool_use', id: 'tu-1', name: 'blockchain-get-block', input: { height: 1 }, server: false },
                { type: 'tool_result', toolUseId: 'tu-1', content: '{"memo":"gm"}', isError: false, server: false },
                { type: 'text', text: 'Second answer' }
            ],
            cutFields: []
        });
    });

    it('reads every turn of a conversation oldest first, and reports an unknown allowlist as unknown', async () => {
        const { tools } = buildTools([WITH_TRANSCRIPT, FIRST_TURN]);

        const result = await tools[AI_TOOL_NAMES.getRun].handler({ id: 'c-1' }) as { turns: Array<Record<string, unknown>> } & Record<string, unknown>;

        expect(result).toMatchObject({ found: true, matchedBy: 'conversation' });
        expect(result.turns.map(turn => turn.id)).toEqual(['r-1', 'r-2']);
        expect(result.turns[0]).toMatchObject({ toolAllowlistKnown: false, toolAllowlist: null, responseText: 'All quiet.' });
    });

    it('reports found false for an id that matches nothing', async () => {
        const { tools } = buildTools([FIRST_TURN]);

        const result = await tools[AI_TOOL_NAMES.getRun].handler({ id: 'nope' }) as Record<string, unknown>;

        expect(result).toMatchObject({ success: true, found: false, matchedBy: null, turns: [] });
    });

    it('cuts long fields, ends the page before an item that would not fit, and resumes there', async () => {
        const huge = 'y'.repeat(30_000);
        const long = run({
            id: 'r-9',
            prompt: huge,
            transcript: Array.from({ length: 8 }, () => ({ type: 'tool_result' as const, toolUseId: 'x', content: huge }))
        });
        const { tools } = buildTools([long]);
        const tool = tools[AI_TOOL_NAMES.getRun];
        type Page = { next: number | null; truncatedFields: number; turns: Array<Record<string, unknown> & { transcript: Array<{ content: string; truncated?: boolean }> }> };

        const first = await tool.handler({ id: 'r-9' }) as Page;
        const second = await tool.handler({ id: 'r-9', start: first.next }) as Page;
        const firstTurn = first.turns[0];
        const firstChars = (firstTurn.prompt as string).length + firstTurn.transcript.reduce((sum, segment) => sum + segment.content.length, 0);

        expect(firstTurn).toMatchObject({ continued: false, cutFields: ['prompt'], segmentStart: 0, segmentCount: 8 });
        expect((firstTurn.prompt as string).length).toBe(20_000);
        expect(firstTurn.transcript).toHaveLength(5);
        expect(firstTurn.transcript.every(segment => segment.content.length === 20_000 && segment.truncated)).toBe(true);
        expect(firstChars).toBeLessThanOrEqual(120_000);
        expect(first).toMatchObject({ next: 6, truncatedFields: 6 });

        expect(second.turns).toHaveLength(1);
        expect(second.turns[0]).toMatchObject({ id: 'r-9', continued: true, segmentStart: 5, segmentCount: 8 });
        expect(second.turns[0]).not.toHaveProperty('prompt');
        expect(second.turns[0].transcript).toHaveLength(3);
        expect(second).toMatchObject({ start: 6, next: null, truncatedFields: 3 });
    });

    it('pages a conversation across turns, returning each turn\'s text fields once and before its transcript', async () => {
        const big = 'z'.repeat(30_000);
        const segments = Array.from({ length: 6 }, () => ({ type: 'tool_result' as const, toolUseId: 'x', content: big }));
        const turnA = run({ id: 'r-a', conversationId: 'c-9', createdAt: '2026-10-15T06:00:00.000Z', transcript: segments });
        const turnB = run({ id: 'r-b', conversationId: 'c-9', createdAt: '2026-10-15T07:00:00.000Z', expandedPrompt: 'Summarise fee 420', transcript: segments });
        const { tools } = buildTools([turnB, turnA]);
        const tool = tools[AI_TOOL_NAMES.getRun];
        type Page = { next: number | null; turns: Array<Record<string, unknown> & { transcript: unknown[] }> };

        const first = await tool.handler({ id: 'c-9' }) as Page;
        const second = await tool.handler({ id: 'c-9', start: first.next }) as Page;
        const third = await tool.handler({ id: 'c-9', start: second.next }) as Page;
        const pages = [first, second, third];

        expect(first.turns.map(turn => turn.id)).toEqual(['r-a']);
        expect(first.next).toBe(6);
        expect(second.turns.map(turn => turn.id)).toEqual(['r-a', 'r-b']);
        expect(second.turns[0]).toMatchObject({ continued: true, segmentStart: 5 });
        expect(second.turns[0]).not.toHaveProperty('prompt');
        expect(second.turns[1]).toMatchObject({ continued: false, prompt: 'Summarise {%chain-params%}', expandedPrompt: 'Summarise fee 420', segmentStart: 0 });
        expect(second.next).toBe(12);
        expect(third.turns.map(turn => turn.id)).toEqual(['r-b']);
        expect(third.turns[0]).toMatchObject({ continued: true, segmentStart: 4 });
        expect(third.next).toBeNull();
        expect(pages.flatMap(page => page.turns).reduce((sum, turn) => sum + turn.transcript.length, 0)).toBe(12);
    });

    it('returns no turns and no next position when start is past the end', async () => {
        const { tools } = buildTools([WITH_TRANSCRIPT]);

        const result = await tools[AI_TOOL_NAMES.getRun].handler({ id: 'r-2', start: 50 }) as Record<string, unknown>;

        expect(result).toMatchObject({ success: true, found: true, start: 50, next: null, turns: [] });
    });

    it('refuses bad arguments as input errors', async () => {
        const { tools } = buildTools([]);

        for (const input of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { limit: 2.5 }]) {
            expect(await tools[AI_TOOL_NAMES.listRuns].handler(input)).toEqual({ success: false, error: expect.any(String), errorKind: 'input' });
        }
        for (const id of [undefined, '', '   ', 'x'.repeat(257), { $ne: null }]) {
            expect(await tools[AI_TOOL_NAMES.getRun].handler({ id })).toEqual({ success: false, error: expect.any(String), errorKind: 'input' });
        }
        for (const start of [-1, 1.5, '6', 1_000_001]) {
            expect(await tools[AI_TOOL_NAMES.getRun].handler({ id: 'r-1', start })).toEqual({ success: false, error: expect.any(String), errorKind: 'input' });
        }
    });
});
