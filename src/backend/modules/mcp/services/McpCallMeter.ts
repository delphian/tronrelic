/**
 * @fileoverview Writes one row per MCP call to the ClickHouse `mcp_calls`
 * table, which the usage view on `/system/mcp` totals by group, tool, and
 * caller.
 *
 * Rows are buffered in memory and written in batches, because ClickHouse
 * handles a few large inserts far better than one insert per call. A failed
 * write is logged and its rows dropped: accounting must never slow down or
 * break a tool call. The MongoDB audit trail keeps the authoritative record of
 * every call regardless, so a lost batch costs totals, not evidence.
 */

import type { IClickHouseService, ISystemLogService, IToolInvocationRecord } from '@/types';
import { MCP_ANONYMOUS_GROUP_ID, MCP_USERS_GROUP_ID } from '@/types';
import { formatClickHouseDateTime64Utc } from '../../../lib/formatClickHouseDateTime64Utc.js';
import type { IMcpCaller } from './IMcpCaller.js';
import type { IMcpCallMeter } from './IMcpCallMeter.js';

/** The ClickHouse table the meter writes and the usage service reads. */
export const MCP_CALLS_TABLE = 'mcp_calls';

/** How often buffered rows are written. */
const FLUSH_INTERVAL_MS = 5_000;

/** Buffer size that triggers a write before the interval elapses. */
const FLUSH_AT_ROWS = 500;

/**
 * Most rows held while ClickHouse is failing. Past this the oldest are
 * dropped, so a long outage cannot grow memory without bound.
 */
const MAX_BUFFERED_ROWS = 10_000;

/** How the call ended, as the usage view groups it. */
type McpCallOutcome = 'succeeded' | 'refused' | 'failed';

/** One row of `mcp_calls`. Field names match the columns exactly. */
export interface IMcpCallRow extends Record<string, unknown> {
    timestamp: string;
    endpoint: string;
    principal_kind: string;
    principal_id: string;
    charged_group: string;
    tool: string;
    outcome: McpCallOutcome;
    status: string;
    limit_hit: string;
    reason: string;
    duration_ms: number;
    cost_usd: number;
    client_id: string;
    client_name: string;
    record_id: string;
}

/**
 * Buffers and writes MCP accounting rows.
 */
export class McpCallMeter implements IMcpCallMeter {
    private buffer: IMcpCallRow[] = [];
    private timer: ReturnType<typeof setInterval> | null = null;
    private flushing: Promise<void> | null = null;

    /**
     * @param clickhouse - The ClickHouse service, or undefined when ClickHouse
     *   is not configured, in which case every method is a no-op.
     * @param logger - Module logger, for failed writes and dropped rows.
     */
    constructor(
        private readonly clickhouse: IClickHouseService | undefined,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Start the periodic write. Called from the module's `run()`.
     */
    start(): void {
        if (this.clickhouse && !this.timer) {
            this.timer = setInterval(() => { void this.flush(); }, FLUSH_INTERVAL_MS);
            // The interval must not keep the process alive on shutdown.
            this.timer.unref?.();
        }
    }

    /**
     * Stop the periodic write and write whatever is buffered.
     *
     * @returns Resolves once the last write has finished.
     */
    async stop(): Promise<void> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        await this.flush();
    }

    /** @inheritdoc */
    observe(record: IToolInvocationRecord): void {
        const origin = record.origin;
        if (record.triggerPath === 'mcp' && origin?.endpoint && origin.principalKind && origin.principalId) {
            this.push({
                timestamp: formatClickHouseDateTime64Utc(new Date(record.createdAt)),
                endpoint: origin.endpoint,
                principal_kind: origin.principalKind,
                principal_id: origin.principalId,
                charged_group: origin.chargedGroupId ?? '',
                tool: record.toolName,
                outcome: outcomeOf(record.status),
                status: record.status,
                limit_hit: record.limitHit ?? '',
                reason: '',
                duration_ms: Math.max(0, Math.round(record.durationMs)),
                cost_usd: record.costUsd ?? 0,
                client_id: origin.clientId ?? '',
                client_name: origin.clientName ?? '',
                record_id: record.id
            });
        }
    }

    /** @inheritdoc */
    recordWithheld(caller: IMcpCaller, toolName: string, reason: string): void {
        this.push({
            timestamp: formatClickHouseDateTime64Utc(new Date()),
            endpoint: caller.endpoint,
            principal_kind: caller.principalKind,
            principal_id: caller.principalId,
            // A tool that was not served has no charged group. An anonymous
            // caller can only ever be charged to `anonymous`, and every
            // signed-in caller is in `mcp-users`, so the refusal is counted
            // against the group every such caller shares.
            charged_group: caller.principalKind === 'anonymous' ? MCP_ANONYMOUS_GROUP_ID : MCP_USERS_GROUP_ID,
            tool: toolName.slice(0, 64),
            outcome: 'refused',
            status: 'not-served',
            limit_hit: '',
            reason,
            duration_ms: 0,
            cost_usd: 0,
            client_id: caller.claims?.clientId ?? '',
            client_name: caller.clientName ?? '',
            record_id: ''
        });
    }

    /**
     * Write every buffered row in one insert. Concurrent calls share the
     * write already in progress.
     *
     * @returns Resolves once the write has finished or failed.
     */
    flush(): Promise<void> {
        if (!this.flushing && this.clickhouse && this.buffer.length > 0) {
            const rows = this.buffer;
            this.buffer = [];
            const clickhouse = this.clickhouse;
            this.flushing = clickhouse.insert(MCP_CALLS_TABLE, rows, { synchronous: true })
                .catch((error: unknown) => {
                    this.logger.warn({ err: error, rows: rows.length }, 'Could not write MCP accounting rows; they were dropped');
                })
                .finally(() => {
                    this.flushing = null;
                });
        }
        return this.flushing ?? Promise.resolve();
    }

    /**
     * Add a row, writing early when the buffer is full and dropping the
     * oldest rows when writes keep failing.
     *
     * @param row - The row to add.
     */
    private push(row: IMcpCallRow): void {
        if (this.clickhouse) {
            this.buffer.push(row);
            if (this.buffer.length > MAX_BUFFERED_ROWS) {
                const dropped = this.buffer.length - MAX_BUFFERED_ROWS;
                this.buffer.splice(0, dropped);
                this.logger.warn({ dropped }, 'MCP accounting buffer full; oldest rows dropped');
            }
            if (this.buffer.length >= FLUSH_AT_ROWS) {
                void this.flush();
            }
        }
    }
}

/**
 * Map the governor's status onto the three outcomes the usage view counts.
 *
 * @param status - The audit record's status.
 * @returns `succeeded` when the tool ran and returned, `failed` when it ran
 *   and failed, and `refused` for every call that did not run.
 */
function outcomeOf(status: IToolInvocationRecord['status']): McpCallOutcome {
    let outcome: McpCallOutcome;
    if (status === 'ok') {
        outcome = 'succeeded';
    } else if (status === 'error') {
        outcome = 'failed';
    } else {
        outcome = 'refused';
    }
    return outcome;
}
