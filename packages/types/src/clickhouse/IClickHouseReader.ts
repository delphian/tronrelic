/**
 * @fileoverview Read-only access to ClickHouse as one managed account.
 *
 * Code that should run under an account's limits, such as an AI tool, receives
 * this instead of `IClickHouseService`. It can only read, it connects as the
 * account's own ClickHouse user, and it uses its own connections, so it cannot
 * exceed the account's limits or take connections from the rest of the
 * application.
 */

import type { IClickHouseQueryOptions } from './IClickHouseQueryOptions.js';
import type { IClickHouseReadResult } from './IClickHouseReadResult.js';

/**
 * A connection bound to one managed ClickHouse account.
 */
export interface IClickHouseReader {
    /** Id of the account this reader connects as. */
    readonly accountId: string;

    /**
     * Run a parameterized SELECT as the account.
     *
     * Parameters use ClickHouse's `{name:Type}` placeholder syntax, which keeps
     * caller values out of the SQL text. A query that breaks one of the
     * account's limits fails with ClickHouse's own error, which names the limit.
     *
     * @param sql - SELECT statement with optional `{name:Type}` placeholders.
     * @param params - Values for the placeholders.
     * @param options - Query id, quota key, and abort signal for this read.
     * @returns The rows and what the read cost.
     */
    query<T = Record<string, unknown>>(
        sql: string,
        params?: Record<string, unknown>,
        options?: IClickHouseQueryOptions
    ): Promise<IClickHouseReadResult<T>>;
}
