/**
 * @fileoverview The ClickHouse connection one chain query tool call reads through.
 *
 * Every read runs as the `ai-agent` account, whose settings profile and hourly
 * quota ClickHouse enforces on every query. A session adds the three things a
 * single tool call needs on top of that:
 *
 * - It charges each read to the agent run that made it, by passing the run's
 *   query id as the quota key, so one busy run cannot spend every other run's
 *   hourly budget.
 * - It keeps a running total of rows and bytes read and the ClickHouse query
 *   ids, which every response reports so a model can pace itself and an
 *   operator can find the exact queries in `system.query_log`.
 * - It turns ClickHouse's limit errors into instructions a model can act on,
 *   and stops every read once the call's deadline passes, so a slow query is
 *   cancelled on the server rather than left running after the governor has
 *   given up waiting.
 *
 * @module backend/modules/blockchain/chain-query/ChainQuerySession
 */

import type { IClickHouseReader, IToolHandlerContext } from '@/types';
import { logger } from '../logger.js';
import { ChainQueryError } from './ChainQueryError.js';

/** What the reads in one tool call cost, reported in every response. */
export interface IChainQueryCost {
    /** Queries run. */
    queries: number;
    /** Rows ClickHouse read from tables, summed across queries. */
    readRows: number;
    /** Uncompressed bytes ClickHouse read, summed across queries. */
    readBytes: number;
    /** Time spent waiting on ClickHouse, in milliseconds. */
    elapsedMs: number;
    /** ClickHouse query ids, for finding each query in `system.query_log`. */
    queryIds: string[];
}

/**
 * How long one tool call may spend reading, in milliseconds. Under the
 * governor's 30-second handler budget, so the session cancels its own reads
 * and reports why before the governor stops waiting and reports a timeout
 * with no explanation.
 */
export const CHAIN_QUERY_DEADLINE_MS = 25_000;

/**
 * What to tell a model when a ClickHouse error code means a limit stopped the
 * query. Codes come from ClickHouse's `ErrorCodes`; the same set is counted
 * as limit hits on the admin page (`limitErrorCodes.ts` in the ClickHouse
 * accounts module).
 */
const LIMIT_MESSAGES: Readonly<Record<number, string>> = {
    158: 'The query would read more rows than the ai-agent account allows (TOO_MANY_ROWS).',
    159: 'The query ran longer than the ai-agent account allows (TIMEOUT_EXCEEDED).',
    160: 'The query was stopped for running too slowly (TOO_SLOW).',
    241: 'The query needed more memory than the ai-agent account allows (MEMORY_LIMIT_EXCEEDED).',
    307: 'The query would read more data than the ai-agent account allows (TOO_MANY_BYTES).',
    396: 'The query would return or read more rows than the ai-agent account allows (TOO_MANY_ROWS_OR_BYTES).'
};

/** Advice appended to every per-query limit message. */
const NARROWING_ADVICE =
    'Ask for less: shorten the window with hours or since/until, add a token filter, or pick a less active address. Very busy addresses such as exchange hot wallets need windows of an hour or two.';

/**
 * Read the numeric ClickHouse error code off an error from `@clickhouse/client`,
 * which carries it as a string `code` property.
 *
 * @param error - Whatever the reader threw.
 * @returns The code, or null when the error did not come from ClickHouse.
 */
function clickHouseCode(error: unknown): number | null {
    const raw = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    const code = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : Number.NaN;
    return Number.isInteger(code) ? code : null;
}

/**
 * The reads one tool call makes, with their running cost.
 *
 * Built per call and disposed when the call ends. A utility, not a service:
 * each call gets its own, because each carries its own run identity, deadline,
 * and cost total.
 */
export class ChainQuerySession {
    private readonly controller = new AbortController();
    private readonly timer: ReturnType<typeof setTimeout>;
    private readonly totals: IChainQueryCost = { queries: 0, readRows: 0, readBytes: 0, elapsedMs: 0, queryIds: [] };

    /**
     * @param reader - The `ai-agent` account's read-only connection.
     * @param context - The run identity from the governor. Its `queryId` becomes
     *                  the quota key; absent on a call with no run id, which then
     *                  counts against the account as a whole.
     * @param deadlineMs - How long the call may spend reading before every read is cancelled.
     */
    constructor(
        private readonly reader: IClickHouseReader,
        private readonly context: IToolHandlerContext | undefined,
        deadlineMs: number = CHAIN_QUERY_DEADLINE_MS
    ) {
        this.timer = setTimeout(() => this.controller.abort(), deadlineMs);
    }

    /**
     * Run one parameterized SELECT and add its cost to the call's total.
     *
     * @param sql - The statement, with `{name:Type}` placeholders for every
     *              value that came from the caller.
     * @param params - Values for the placeholders.
     * @returns The rows.
     * @throws ChainQueryError written for the model when a limit, the quota,
     *         the deadline, or anything else stopped the query.
     */
    public async query<T>(sql: string, params: Record<string, unknown>): Promise<T[]> {
        if (this.controller.signal.aborted) {
            throw this.deadlineError();
        }
        let rows: T[];
        try {
            const result = await this.reader.query<T>(sql, params, {
                quotaKey: this.context?.queryId ?? this.context?.conversationId,
                signal: this.controller.signal
            });
            this.totals.queries += 1;
            this.totals.readRows += result.readRows;
            this.totals.readBytes += result.readBytes;
            this.totals.elapsedMs += result.elapsedMs;
            this.totals.queryIds.push(result.queryId);
            rows = result.rows;
        } catch (error) {
            this.totals.queries += 1;
            throw this.translate(error);
        }
        return rows;
    }

    /**
     * The cost of every read so far, as a copy the caller can put in a response.
     *
     * @returns The totals.
     */
    public cost(): IChainQueryCost {
        return { ...this.totals, queryIds: [...this.totals.queryIds] };
    }

    /**
     * Stop the deadline timer. Called when the tool call ends, whatever its outcome.
     */
    public dispose(): void {
        clearTimeout(this.timer);
    }

    /**
     * The error reported when the call's reading time ran out.
     *
     * @returns An error telling the model the call was cut short and how to ask for less.
     */
    private deadlineError(): ChainQueryError {
        return new ChainQueryError(
            `This call ran out of its ${Math.round(CHAIN_QUERY_DEADLINE_MS / 1000)}-second reading time and its queries were cancelled. ${NARROWING_ADVICE}`,
            'limit'
        );
    }

    /**
     * Turn whatever a read threw into an error a model can act on.
     *
     * Limit, quota, and concurrency errors keep ClickHouse's own limit name,
     * because it tells the model which way to adjust. Anything else is logged
     * with its details and reported generically, so SQL text and server
     * internals never reach the model.
     *
     * @param error - Whatever the reader threw.
     * @returns The error to throw in its place.
     */
    private translate(error: unknown): ChainQueryError {
        const code = clickHouseCode(error);
        let translated: ChainQueryError;
        if (this.controller.signal.aborted) {
            translated = this.deadlineError();
        } else if (code !== null && LIMIT_MESSAGES[code]) {
            translated = new ChainQueryError(`${LIMIT_MESSAGES[code]} ${NARROWING_ADVICE}`, 'limit');
        } else if (code === 201) {
            translated = new ChainQueryError(
                'This run has used up its hourly chain-query quota (QUOTA_EXCEEDED). Stop querying and answer with what you have; the quota resets within the hour.',
                'limit'
            );
        } else if (code === 202) {
            translated = new ChainQueryError(
                'Too many chain queries are running at once for the ai-agent account (TOO_MANY_SIMULTANEOUS_QUERIES). Make calls one at a time and retry this one.',
                'limit'
            );
        } else {
            logger.error({ error, code, queryId: this.context?.queryId }, 'Chain query tool read failed');
            translated = new ChainQueryError('The chain query failed on the server. This is not caused by your input; retrying later may work.', 'failed');
        }
        return translated;
    }
}
