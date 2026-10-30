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
 *   operator can find the exact queries in `system.query_log`. A query that
 *   fails is counted and named too, because it is usually the most expensive
 *   one, and leaving it out made a failed call look nearly free.
 * - It turns ClickHouse's limit errors into instructions a model can act on,
 *   using advice written for the tool that ran the query, and stops every read
 *   once the call's deadline passes, so a slow query is cancelled on the
 *   server rather than left running after the governor has given up waiting.
 *
 * @module backend/modules/blockchain/chain-query/ChainQuerySession
 */

import { randomUUID } from 'node:crypto';
import type { IClickHouseReader, IToolHandlerContext } from '@/types';
import { logger } from '../logger.js';
import { ChainQueryError } from './ChainQueryError.js';

/** What the reads in one tool call cost, reported in every response. */
export interface IChainQueryCost {
    /** Queries run, including any that failed. */
    queries: number;
    /**
     * Rows ClickHouse read from tables, summed across the queries that
     * finished. ClickHouse reports nothing for a query that failed, so a call
     * with `failedQueries` above zero read more than this.
     */
    readRows: number;
    /** Uncompressed bytes ClickHouse read, summed across the queries that finished. */
    readBytes: number;
    /** Time spent waiting on ClickHouse, in milliseconds, including time spent on queries that failed. */
    elapsedMs: number;
    /** Every query's ClickHouse id, in the order they ran, for finding each in `system.query_log`. */
    queryIds: string[];
    /** Queries that failed, such as one stopped by a limit. */
    failedQueries: number;
    /** The ids of the failed queries, also listed in `queryIds`, so an operator can find what each read before it stopped. */
    failedQueryIds: string[];
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

/**
 * Advice appended to a limit message when the tool supplied none of its own.
 * It names only the window, because that is the one change that narrows every
 * windowed tool's read; which other parameters help depends on the tool.
 */
export const DEFAULT_NARROWING_ADVICE = 'Ask for less: shorten the window with hours or since/until.';

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
    private readonly totals: IChainQueryCost = {
        queries: 0,
        readRows: 0,
        readBytes: 0,
        elapsedMs: 0,
        queryIds: [],
        failedQueries: 0,
        failedQueryIds: []
    };

    /**
     * @param reader - The `ai-agent` account's read-only connection.
     * @param context - The run identity from the governor. Its `quotaKey`, or
     *                  failing that its `queryId` or `conversationId`, becomes the
     *                  ClickHouse quota key. With none of them the call counts
     *                  against the account as a whole.
     * @param narrowingAdvice - What the calling tool tells a model to change
     *                          after a limit stops one of its reads, because
     *                          the change that helps depends on what that
     *                          tool's reads grow with.
     * @param deadlineMs - How long the call may spend reading before every read is cancelled.
     */
    constructor(
        private readonly reader: IClickHouseReader,
        private readonly context: IToolHandlerContext | undefined,
        private readonly narrowingAdvice: string = DEFAULT_NARROWING_ADVICE,
        deadlineMs: number = CHAIN_QUERY_DEADLINE_MS
    ) {
        this.timer = setTimeout(() => this.controller.abort(), deadlineMs);
    }

    /**
     * Run one parameterized SELECT and add its cost to the call's total.
     *
     * The session names each query itself rather than letting ClickHouse do
     * it, so a query that fails still has an id to report: ClickHouse returns
     * the generated id only with a successful result.
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
        const queryId = randomUUID();
        const startedAt = Date.now();
        let rows: T[];
        this.totals.queries += 1;
        try {
            const result = await this.reader.query<T>(sql, params, {
                queryId,
                quotaKey: this.context?.quotaKey ?? this.context?.queryId ?? this.context?.conversationId,
                signal: this.controller.signal
            });
            this.totals.readRows += result.readRows;
            this.totals.readBytes += result.readBytes;
            this.totals.elapsedMs += result.elapsedMs;
            this.totals.queryIds.push(result.queryId);
            rows = result.rows;
        } catch (error) {
            this.totals.elapsedMs += Date.now() - startedAt;
            this.totals.queryIds.push(queryId);
            this.totals.failedQueries += 1;
            this.totals.failedQueryIds.push(queryId);
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
        return { ...this.totals, queryIds: [...this.totals.queryIds], failedQueryIds: [...this.totals.failedQueryIds] };
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
            `This call ran out of its ${Math.round(CHAIN_QUERY_DEADLINE_MS / 1000)}-second reading time and its queries were cancelled. ${this.narrowingAdvice}`,
            'limit'
        );
    }

    /**
     * Turn whatever a read threw into an error a model can act on.
     *
     * Limit, quota, and concurrency errors keep ClickHouse's own limit name,
     * because it tells the model which way to adjust. Anything else is logged
     * with its details and reported generically: every query is written in
     * this codebase, so any other failure is ours to fix, and SQL text and
     * server internals never reach the model.
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
            translated = new ChainQueryError(`${LIMIT_MESSAGES[code]} ${this.narrowingAdvice}`, 'limit');
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
