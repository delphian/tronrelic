/**
 * @file ai-query-history.service.test.ts
 *
 * Pins the saved-prompt link and the filtered reads of the query history. A
 * record stores the saved prompt and trigger that fired it only when the
 * caller supplied them, so a filter on either never matches an interactive
 * run. The listing and the summary turn the same filter into the same
 * database filter, coerced to plain strings. The summary turns its one
 * aggregation into totals, counting runs with no outcome as `unrecorded` and
 * reporting zeros and nulls when nothing matched.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IDatabaseService, ISystemLogService } from '@/types';
import { AiQueryHistoryService, buildAiQueryRecord } from '../services/ai-query-history.service.js';

/**
 * Build the service over a fake database that records what each read sends.
 *
 * @param aggregateRows - What the summary aggregation returns.
 * @returns The service and the spies on the fake.
 */
function buildService(aggregateRows: unknown[] = []): {
    service: AiQueryHistoryService;
    find: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
} {
    const cursor = { sort: vi.fn(), skip: vi.fn(), limit: vi.fn(), toArray: vi.fn(async () => []) };
    cursor.sort.mockReturnValue(cursor);
    cursor.skip.mockReturnValue(cursor);
    cursor.limit.mockReturnValue(cursor);
    const find = vi.fn((_filter: Record<string, unknown>) => cursor);
    const aggregate = vi.fn((_pipeline: unknown[]) => ({ toArray: async () => aggregateRows }));
    const count = vi.fn(async () => 0);
    const database = {
        getCollection: () => ({ find, aggregate }),
        count
    } as unknown as IDatabaseService;
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as ISystemLogService;
    return { service: new AiQueryHistoryService(logger, database), find, count, aggregate };
}

describe('buildAiQueryRecord saved-prompt link', () => {
    it('stores the saved prompt and trigger when the caller supplies them', () => {
        const record = buildAiQueryRecord('scheduled', 'p', 'c-1', '2026-10-27T23:45:00.000Z', 'r-1', null, 'boom', 'm', {
            savedPromptId: 'news',
            triggerId: 'cron-1'
        });

        expect(record).toMatchObject({ savedPromptId: 'news', triggerId: 'cron-1' });
    });

    it('leaves both fields out of an interactive run rather than storing them empty', () => {
        const record = buildAiQueryRecord('stream', 'p', 'c-1', '2026-10-27T23:45:00.000Z', 'r-1', null, 'boom');

        expect('savedPromptId' in record).toBe(false);
        expect('triggerId' in record).toBe(false);
    });
});

describe('AiQueryHistoryService filtered reads', () => {
    it('lists with every filter applied, and counts the total over the same filter', async () => {
        const { service, find, count } = buildService();

        await service.list({
            savedPromptId: 'news',
            mode: 'scheduled',
            status: 'failed',
            outcome: 'failed',
            since: '2026-10-01T00:00:00.000Z',
            until: '2026-10-31T00:00:00.000Z',
            limit: 10
        });

        const expected = {
            savedPromptId: 'news',
            mode: 'scheduled',
            status: 'failed',
            outcome: 'failed',
            createdAt: { $gte: '2026-10-01T00:00:00.000Z', $lte: '2026-10-31T00:00:00.000Z' }
        };
        expect(find).toHaveBeenCalledWith(expected);
        expect(count).toHaveBeenCalledWith('module_ai-tools_query_history', expected);
    });

    it('lists everything when called with pagination only, as the Query tab does', async () => {
        const { service, find } = buildService();

        await service.list({ limit: 50, offset: 0 });

        expect(find).toHaveBeenCalledWith({});
    });

    it('summarizes over the same filter and maps the aggregation into totals', async () => {
        const { service, aggregate } = buildService([{
            totals: [{ runs: 5, costUsd: 1.25, pricedRuns: 4, inputTokens: 900, outputTokens: 120, firstRunAt: '2026-10-01T23:45:00.000Z', lastRunAt: '2026-10-05T23:45:00.000Z' }],
            byStatus: [{ _id: 'completed', count: 4 }, { _id: 'failed', count: 1 }],
            byOutcome: [{ _id: 'answered', count: 3 }, { _id: 'failed', count: 1 }, { _id: null, count: 1 }],
            lastAnswered: [{ id: 'r-4', createdAt: '2026-10-04T23:45:00.000Z' }]
        }]);

        const summary = await service.summarize({ savedPromptId: 'news' });

        const pipeline = aggregate.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
        expect(pipeline[0]).toEqual({ $match: { savedPromptId: 'news' } });
        expect(summary).toEqual({
            runs: 5,
            byStatus: { completed: 4, failed: 1 },
            byOutcome: { answered: 3, failed: 1, unrecorded: 1 },
            costUsd: 1.25,
            pricedRuns: 4,
            inputTokens: 900,
            outputTokens: 120,
            firstRunAt: '2026-10-01T23:45:00.000Z',
            lastRunAt: '2026-10-05T23:45:00.000Z',
            lastAnsweredAt: '2026-10-04T23:45:00.000Z',
            lastAnsweredRunId: 'r-4'
        });
    });

    it('reports zeros and nulls when no run matches', async () => {
        const { service } = buildService([{ totals: [], byStatus: [], byOutcome: [], lastAnswered: [] }]);

        const summary = await service.summarize({ savedPromptId: 'nothing-yet' });

        expect(summary).toEqual({
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
        });
    });
});
