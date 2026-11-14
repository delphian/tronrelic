/**
 * @fileoverview Tests for the MCP accounting meter: which audit records become
 * rows, how outcomes are mapped, batching, and that a failed write never
 * escapes into a tool call.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IToolInvocationRecord } from '@/types';
import { MCP_CALLS_TABLE, McpCallMeter } from '../services/McpCallMeter.js';

/** A silent logger. */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;

/**
 * Build an audit record for an MCP call.
 *
 * @param overrides - Fields to change.
 * @returns The record.
 */
function record(overrides: Partial<IToolInvocationRecord> = {}): IToolInvocationRecord {
    return {
        id: 'rec-1',
        toolName: 'network-stats',
        providerId: 'blockchain',
        aiProviderId: 'mcp',
        capability: { sideEffect: 'read', reversible: true, sensitivity: 'public' },
        actor: { kind: 'anonymous', id: 'net-a' },
        triggerPath: 'mcp',
        input: {},
        status: 'ok',
        durationMs: 42.4,
        createdAt: '2026-11-14T05:00:00.000Z',
        origin: { endpoint: 'public', principalKind: 'anonymous', principalId: 'net-a', chargedGroupId: 'anonymous', clientName: 'claude-code/2.0' },
        ...overrides
    };
}

describe('McpCallMeter', () => {
    it('writes one row per MCP call with the outcome, group, and caller', async () => {
        const insert = vi.fn(async () => undefined);
        const meter = new McpCallMeter({ insert } as any, logger);
        meter.observe(record());
        meter.observe(record({ id: 'rec-2', status: 'denied', limitHit: 'pool-day' }));
        await meter.flush();
        expect(insert).toHaveBeenCalledTimes(1);
        const [table, rows, options] = insert.mock.calls[0] as unknown as [string, any[], unknown];
        expect(table).toBe(MCP_CALLS_TABLE);
        expect(options).toEqual({ synchronous: true });
        expect(rows[0]).toMatchObject({ outcome: 'succeeded', charged_group: 'anonymous', principal_id: 'net-a', duration_ms: 42, client_name: 'claude-code/2.0' });
        expect(rows[1]).toMatchObject({ outcome: 'refused', limit_hit: 'pool-day' });
    });

    it('ignores records from every path other than MCP', async () => {
        const insert = vi.fn(async () => undefined);
        const meter = new McpCallMeter({ insert } as any, logger);
        meter.observe(record({ triggerPath: 'interactive', origin: undefined }));
        await meter.flush();
        expect(insert).not.toHaveBeenCalled();
    });

    it('counts a tool that was not served as refused, charged to the group every such caller shares', async () => {
        const insert = vi.fn(async () => undefined);
        const meter = new McpCallMeter({ insert } as any, logger);
        meter.recordWithheld({ endpoint: 'oauth', principalKind: 'user', principalId: 'user-1', groups: ['mcp-users'] }, 'log-reader', 'not-granted');
        await meter.flush();
        const rows = (insert.mock.calls[0] as unknown as [string, any[]])[1];
        expect(rows[0]).toMatchObject({ outcome: 'refused', status: 'not-served', reason: 'not-granted', charged_group: 'mcp-users' });
    });

    it('logs and drops a batch ClickHouse refused, without throwing', async () => {
        logger.warn.mockClear();
        const meter = new McpCallMeter({ insert: vi.fn(async () => { throw new Error('down'); }) } as any, logger);
        meter.observe(record());
        await expect(meter.flush()).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('does nothing at all without ClickHouse', async () => {
        const meter = new McpCallMeter(undefined, logger);
        meter.observe(record());
        meter.start();
        await expect(meter.stop()).resolves.toBeUndefined();
    });
});
