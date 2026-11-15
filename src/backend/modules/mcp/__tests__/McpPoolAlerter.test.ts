/**
 * @fileoverview Tests for the alert raised when an MCP group's shared daily
 * pool runs out: once per exhaustion, re-armed by a successful call, ignored
 * off the MCP path, and never failing when notifications or policies do.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IToolInvocationRecord } from '@/types';
import { McpPoolAlerter, MCP_POOL_EXHAUSTED_CATEGORY } from '../services/McpPoolAlerter.js';

/** A logger whose calls the tests inspect. */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;

/**
 * Build an audit record for an MCP call charged to a group.
 *
 * @param overrides - Fields that differ from a successful anonymous call.
 * @returns The record.
 */
function record(overrides: Partial<IToolInvocationRecord> = {}): IToolInvocationRecord {
    return {
        id: 'rec-1',
        toolName: 'resource-markets-get-prices',
        triggerPath: 'mcp',
        status: 'ok',
        origin: { endpoint: 'oauth', principalKind: 'anonymous', principalId: 'net-a', chargedGroupId: 'anonymous' },
        ...overrides
    } as IToolInvocationRecord;
}

/** A refused call: the group's pool was spent. */
const POOL_REFUSAL = { status: 'denied', limitHit: 'pool-day' } as const;

/**
 * Build an alerter whose group pool limit is 5,000 and whose notifications
 * service is a spy.
 *
 * @returns The alerter and the notify spy.
 */
function build() {
    const notify = vi.fn(async () => ({}));
    const policies = {
        getPolicies: vi.fn(async () => new Map()),
        policyFor: vi.fn(() => ({ limits: { callsPerDayGroup: 5_000 } }))
    } as any;
    const alerter = new McpPoolAlerter(policies, () => ({ notify } as any), logger);
    return { alerter, notify };
}

/** Let the background alert finish. */
async function settle(): Promise<void> {
    await new Promise(resolve => setImmediate(resolve));
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('McpPoolAlerter', () => {
    it('alerts once when a group\'s pool first refuses a call, naming the limit', async () => {
        const { alerter, notify } = build();
        alerter.observe(record(POOL_REFUSAL));
        alerter.observe(record(POOL_REFUSAL));
        alerter.observe(record({ ...POOL_REFUSAL, origin: { chargedGroupId: 'anonymous', principalId: 'net-b' } }));
        await settle();
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({
            category: MCP_POOL_EXHAUSTED_CATEGORY,
            severity: 'warning',
            data: { groupId: 'anonymous', poolCallsPerDay: 5_000 }
        }));
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0][0]).toMatchObject({ groupId: 'anonymous', poolCallsPerDay: 5_000 });
    });

    /**
     * A call charged to the group can only succeed once the pool has room,
     * so that is what allows the next exhaustion to be reported.
     */
    it('alerts again only after a call charged to the group succeeds', async () => {
        const { alerter, notify } = build();
        alerter.observe(record(POOL_REFUSAL));
        alerter.observe(record());
        alerter.observe(record(POOL_REFUSAL));
        await settle();
        expect(notify).toHaveBeenCalledTimes(2);
    });

    it('tracks each group separately', async () => {
        const { alerter, notify } = build();
        alerter.observe(record(POOL_REFUSAL));
        alerter.observe(record({ ...POOL_REFUSAL, origin: { chargedGroupId: 'mcp-users', principalId: 'user-1' } }));
        await settle();
        expect(notify).toHaveBeenCalledTimes(2);
    });

    it('ignores other limits, other trigger paths, and calls charged to no group', async () => {
        const { alerter, notify } = build();
        alerter.observe(record({ status: 'denied', limitHit: 'caller-day' }));
        alerter.observe(record({ ...POOL_REFUSAL, triggerPath: 'interactive' }));
        alerter.observe(record({ ...POOL_REFUSAL, origin: undefined }));
        await settle();
        expect(notify).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('still logs the alert when the notifications service is missing or fails', async () => {
        const policies = { getPolicies: vi.fn(async () => { throw new Error('database down'); }), policyFor: vi.fn() } as any;
        const failing = new McpPoolAlerter(policies, () => ({ notify: vi.fn(async () => { throw new Error('dispatch failed'); }) } as any), logger);
        failing.observe(record(POOL_REFUSAL));
        const missing = new McpPoolAlerter(policies, () => undefined, logger);
        missing.observe(record(POOL_REFUSAL));
        await settle();
        const messages: string[] = logger.warn.mock.calls.map((call: unknown[]) => String(call[1]));
        expect(messages.filter(message => message.startsWith("MCP group's daily call pool is used up"))).toHaveLength(2);
        expect(messages).toContain('Failed to send the MCP pool notification');
        expect(logger.warn.mock.calls.find((call: unknown[]) => String(call[1]).startsWith("MCP group's daily call pool is used up"))[0]).toMatchObject({ poolCallsPerDay: null });
    });
});
