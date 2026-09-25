/**
 * @fileoverview A read-only ClickHouse connection bound to one managed
 * account.
 *
 * Code that must run under an account's limits, such as an AI tool, reads
 * through this rather than through the shared `ClickHouseService`. It
 * authenticates as the account's own ClickHouse user, so ClickHouse applies
 * that user's settings profile and quota to every query, and it owns its own
 * small connection pool, so a slow query here never holds a connection the
 * chain writer or the rest of the application needs.
 */

import type { ClickHouseClient } from '@clickhouse/client';
import type {
    IClickHouseQueryOptions,
    IClickHouseReader,
    IClickHouseReadResult,
    ISystemLogService
} from '@/types';

/**
 * The part of ClickHouse's `X-ClickHouse-Summary` response header this reader
 * uses. ClickHouse sends 64-bit counters as strings.
 */
interface IClickHouseSummaryHeader {
    read_rows?: string;
    read_bytes?: string;
}

/**
 * Account-bound reader over a dedicated `@clickhouse/client` instance.
 */
export class ClickHouseAccountReader implements IClickHouseReader {
    /**
     * @param accountId - Account this reader connects as, reported back on
     *   every result so a caller holding several readers can tell them apart.
     * @param client - Client already configured with the account's user,
     *   password, and pool size. The connector that built it closes it on
     *   shutdown.
     * @param logger - Logger for failed reads, scoped to the ClickHouse module.
     */
    constructor(
        public readonly accountId: string,
        private readonly client: ClickHouseClient,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Run a parameterized SELECT as the account and report what it cost.
     *
     * `http_wait_end_of_query` makes ClickHouse buffer the response on the
     * server until the query finishes, which is what makes the rows-read
     * figure in the summary header final rather than a snapshot taken partway
     * through. The similar `wait_end_of_query` URL parameter is not used: on
     * ClickHouse 24.3 it answers a query that fails during execution, such as
     * one stopped by a limit, with an empty body, which would lose the error
     * message that names the limit. The quota key,
     * when given, makes the account's hourly quota count this read under that
     * key, such as one agent run. It is sent as the `X-ClickHouse-Quota`
     * header rather than the `quota_key` setting, because the reader's client
     * authenticates with ClickHouse's own headers and ClickHouse accepts the
     * quota header alongside them (see `ClickHouseService.openReader`).
     *
     * @param sql - SELECT statement with optional `{name:Type}` placeholders.
     * @param params - Values for the placeholders.
     * @param options - Query id, quota key, and abort signal for this read.
     * @returns The rows plus rows read, bytes read, and elapsed time.
     */
    async query<T = Record<string, unknown>>(
        sql: string,
        params?: Record<string, unknown>,
        options?: IClickHouseQueryOptions
    ): Promise<IClickHouseReadResult<T>> {
        const startedAt = Date.now();
        let result: IClickHouseReadResult<T>;
        try {
            const resultSet = await this.client.query({
                query: sql,
                query_params: params,
                format: 'JSONEachRow',
                query_id: options?.queryId,
                abort_signal: options?.signal,
                http_headers: options?.quotaKey ? { 'X-ClickHouse-Quota': options.quotaKey } : undefined,
                clickhouse_settings: {
                    http_wait_end_of_query: 1
                }
            });
            const rows = await resultSet.json<T>();
            const summary = ClickHouseAccountReader.parseSummary(resultSet.response_headers['x-clickhouse-summary']);
            result = {
                rows,
                queryId: resultSet.query_id,
                readRows: Number(summary.read_rows ?? 0),
                readBytes: Number(summary.read_bytes ?? 0),
                elapsedMs: Date.now() - startedAt
            };
        } catch (error) {
            this.logger.warn(
                { error, accountId: this.accountId, queryId: options?.queryId, sql: sql.substring(0, 200) },
                'ClickHouse account read failed'
            );
            throw error;
        }

        return result;
    }

    /**
     * Parse the `X-ClickHouse-Summary` header into its counters.
     *
     * A missing or malformed header yields empty counters rather than an
     * error, because the rows themselves are still valid and a caller's budget
     * should not fail a read over a missing statistic.
     *
     * @param header - The raw header value, which Node may give as an array.
     * @returns The parsed counters, or an empty object.
     */
    private static parseSummary(header: string | string[] | undefined): IClickHouseSummaryHeader {
        const raw = Array.isArray(header) ? header[0] : header;
        let summary: IClickHouseSummaryHeader = {};
        if (raw) {
            try {
                summary = JSON.parse(raw) as IClickHouseSummaryHeader;
            } catch {
                summary = {};
            }
        }

        return summary;
    }
}
