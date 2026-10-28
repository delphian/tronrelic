/**
 * @file tool-invocation-ai-tools.test.ts
 *
 * Pins what `ai-list-tool-invocations` promises a model. It is a `secret` read
 * that surfaces untrusted content. It passes only validated, normalized
 * filters to the audit store, and refuses a bad argument as an input error
 * before the store is touched. It pages honestly, cuts long arguments, and
 * never returns the raw upstream error body or the caller's IP address and
 * credential id. The store applies the time window as a `createdAt` range.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IAiTool, IDatabaseService, ISystemLogService, IToolInvocationRecord } from '@/types';
import { AI_TOOL_NAMES, buildToolInvocationAiTools } from '../buildToolInvocationAiTools.js';
import { ToolAuditStore, type IToolInvocationQuery } from '../services/tool-audit-store.js';

/**
 * A stored record with sensible defaults.
 *
 * @param overrides - Fields that differ from an ok scheduled fetch.
 * @returns The record.
 */
function record(overrides: Partial<IToolInvocationRecord> = {}): IToolInvocationRecord {
    return {
        id: 'rec-1',
        toolName: 'tronrelic-fetch-url',
        providerId: 'core',
        aiProviderId: 'ai-assistant',
        capability: { sideEffect: 'external', reversible: true, sensitivity: 'public', surfacesUntrustedContent: true },
        actor: { kind: 'system' },
        triggerPath: 'programmatic',
        queryId: 'run-1',
        toolUseId: 'toolu_1',
        input: { url: 'https://forum.trondao.org/latest.rss' },
        status: 'ok',
        resultDigest: '{"success":false,"status":404}',
        durationMs: 412,
        createdAt: '2026-10-27T23:46:10.000Z',
        ...overrides
    };
}

/**
 * Build the tool over a fake store that returns the given records.
 *
 * @param records - What the store's `list` returns.
 * @param total - The matching total the store reports.
 * @returns The tool and the `list` spy.
 */
function buildTool(records: IToolInvocationRecord[], total = records.length): { tool: IAiTool; list: ReturnType<typeof vi.fn> } {
    const list = vi.fn(async (_query: IToolInvocationQuery) => ({ records, total }));
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as ISystemLogService;
    const [tool] = buildToolInvocationAiTools({ list }, logger);
    return { tool, list };
}

describe('tool invocation AI tool', () => {
    it('is named after the module and classified as a secret read over untrusted content', () => {
        const { tool } = buildTool([]);

        expect(tool.name).toBe(AI_TOOL_NAMES.listInvocations);
        expect(tool.name.startsWith('ai-')).toBe(true);
        expect(tool.capability).toEqual({ sideEffect: 'read', reversible: true, sensitivity: 'secret', surfacesUntrustedContent: true });
    });

    it('passes validated filters to the store, rewriting time bounds into the stored shape', async () => {
        const { tool, list } = buildTool([]);

        await tool.handler({
            toolName: 'tronrelic-fetch-url',
            status: 'ok',
            triggerPath: 'programmatic',
            queryId: ' run-1 ',
            since: '2026-10-27T01:00:00+02:00',
            until: '2026-10-28T01:49:43Z',
            limit: 50,
            offset: 50
        });

        expect(list).toHaveBeenCalledWith({
            toolName: 'tronrelic-fetch-url',
            status: 'ok',
            triggerPath: 'programmatic',
            queryId: 'run-1',
            since: '2026-10-26T23:00:00.000Z',
            until: '2026-10-28T01:49:43.000Z',
            limit: 50,
            offset: 50
        });
    });

    it('sends only the defaults when called with no arguments', async () => {
        const { tool, list } = buildTool([]);

        await tool.handler({});

        expect(list).toHaveBeenCalledWith({ limit: 25, offset: 0 });
    });

    it('returns each record without the raw error body or the caller address and credential', async () => {
        const { tool } = buildTool([record({
            triggerPath: 'mcp',
            actor: { kind: 'user', id: 'user-7' },
            endUserId: 'user-7',
            origin: { clientId: 'https://client.example/meta.json', credentialId: 'jti-123', ip: '203.0.113.9' },
            status: 'error',
            error: 'The fetch failed.',
            errorRaw: 'upstream body: <html>internal</html>'
        })]);

        const result = await tool.handler({}) as { success: boolean; invocations: Array<Record<string, unknown>> };

        expect(result.success).toBe(true);
        expect(result.invocations[0]).toEqual(expect.objectContaining({
            id: 'rec-1',
            toolName: 'tronrelic-fetch-url',
            triggerPath: 'mcp',
            actorKind: 'user',
            actorId: 'user-7',
            endUserId: 'user-7',
            clientId: 'https://client.example/meta.json',
            queryId: 'run-1',
            toolUseId: 'toolu_1',
            status: 'error',
            durationMs: 412,
            input: { url: 'https://forum.trondao.org/latest.rss' },
            inputTruncated: false,
            resultDigest: '{"success":false,"status":404}',
            error: 'The fetch failed.'
        }));
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('internal</html>');
        expect(serialized).not.toContain('203.0.113.9');
        expect(serialized).not.toContain('jti-123');
    });

    it('cuts long arguments to a JSON string and marks them truncated', async () => {
        const { tool } = buildTool([record({ toolName: 'propose-blog-post', input: { body: 'x'.repeat(5_000) } })]);

        const result = await tool.handler({}) as { invocations: Array<Record<string, unknown>> };

        expect(typeof result.invocations[0].input).toBe('string');
        expect((result.invocations[0].input as string).length).toBe(2_000);
        expect(result.invocations[0].inputTruncated).toBe(true);
    });

    it('reports nextOffset while more records match, and null on the last page', async () => {
        const middle = buildTool([record(), record({ id: 'rec-2' })], 5);
        const last = buildTool([record({ id: 'rec-5' })], 5);

        const first = await middle.tool.handler({ limit: 2, offset: 2 }) as Record<string, unknown>;
        const final = await last.tool.handler({ limit: 2, offset: 4 }) as Record<string, unknown>;

        expect(first).toEqual(expect.objectContaining({ total: 5, offset: 2, limit: 2, returned: 2, nextOffset: 4 }));
        expect(final).toEqual(expect.objectContaining({ total: 5, offset: 4, returned: 1, nextOffset: null }));
    });

    it('refuses a bad argument as an input error without querying the store', async () => {
        const { tool, list } = buildTool([]);

        const badInputs: Array<Record<string, unknown>> = [
            { toolName: 'hosted:web_fetch' },
            { toolName: 42 },
            { status: 'failed' },
            { triggerPath: 'cron' },
            { queryId: '' },
            { conversationId: 'x'.repeat(257) },
            { since: 'yesterday' },
            { since: '2026-13-45T00:00:00Z' },
            { since: '2026-10-28T00:00:00Z', until: '2026-10-27T00:00:00Z' },
            { limit: 0 },
            { limit: 101 },
            { offset: -1 },
            { offset: 100_001 }
        ];
        for (const input of badInputs) {
            const result = await tool.handler(input) as Record<string, unknown>;
            expect(result).toEqual({ success: false, error: expect.any(String), errorKind: 'input' });
        }
        expect(list).not.toHaveBeenCalled();
    });

    it('answers a store failure generically', async () => {
        const list = vi.fn(async () => {
            throw new Error('connect ECONNREFUSED 10.0.0.5:27017');
        });
        const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as ISystemLogService;
        const [tool] = buildToolInvocationAiTools({ list }, logger);

        const result = await tool.handler({}) as Record<string, unknown>;

        expect(result).toEqual({ success: false, error: expect.any(String), errorKind: 'failed' });
        expect(JSON.stringify(result)).not.toContain('10.0.0.5');
        expect(logger.error).toHaveBeenCalled();
    });
});

describe('ToolAuditStore time window', () => {
    /**
     * Build a store over a fake database that records the filter `list` sends.
     *
     * @returns The store and the `find` spy.
     */
    function buildStore(): { store: ToolAuditStore; find: ReturnType<typeof vi.fn> } {
        const cursor = { sort: vi.fn(), skip: vi.fn(), limit: vi.fn(), toArray: vi.fn(async () => []) };
        cursor.sort.mockReturnValue(cursor);
        cursor.skip.mockReturnValue(cursor);
        cursor.limit.mockReturnValue(cursor);
        const find = vi.fn((_filter: Record<string, unknown>) => cursor);
        const database = {
            getCollection: () => ({ find }),
            count: vi.fn(async () => 0)
        } as unknown as IDatabaseService;
        const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as ISystemLogService;
        return { store: new ToolAuditStore(logger, database), find };
    }

    it('filters createdAt by since and until together', async () => {
        const { store, find } = buildStore();

        await store.list({ toolName: 'tronrelic-fetch-url', since: '2026-10-27T00:00:00.000Z', until: '2026-10-28T00:00:00.000Z' });

        expect(find).toHaveBeenCalledWith({
            toolName: 'tronrelic-fetch-url',
            createdAt: { $gte: '2026-10-27T00:00:00.000Z', $lte: '2026-10-28T00:00:00.000Z' }
        });
    });

    it('applies a single bound on its own, and no createdAt filter without either', async () => {
        const { store, find } = buildStore();

        await store.list({ since: '2026-10-27T00:00:00.000Z' });
        await store.list({});

        expect(find).toHaveBeenNthCalledWith(1, { createdAt: { $gte: '2026-10-27T00:00:00.000Z' } });
        expect(find).toHaveBeenNthCalledWith(2, {});
    });
});
