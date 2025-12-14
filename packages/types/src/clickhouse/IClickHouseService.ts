/**
 * ClickHouse analytical database service interface.
 *
 * Provides access to ClickHouse for time-series data, aggregations, and
 * analytical queries. Unlike IDatabaseService (MongoDB), this interface
 * is optimized for:
 * - High-volume batch inserts
 * - Fast analytical queries with aggregations
 * - Time-series data with automatic TTL
 *
 * ClickHouse is NOT suitable for:
 * - Frequent single-row updates
 * - Transactions requiring ACID guarantees
 * - Document-style flexible schemas
 *
 * Why this interface exists:
 * - **Testability** - Services can be tested with mock ClickHouse implementations
 * - **Consistency** - All ClickHouse access follows the same patterns
 * - **Decoupling** - Consumers depend on interface, not @clickhouse/client directly
 * - **Optional adoption** - Plugins check for undefined before using ClickHouse
 */
export interface IClickHouseService {
    /**
     * Execute a SELECT query and return typed results.
     *
     * Uses ClickHouse's parameterized query syntax to prevent SQL injection.
     * Parameters use the format {name:Type} in the query string.
     *
     * @param sql - ClickHouse SQL query with optional parameter placeholders
     * @param params - Query parameters (keys match placeholder names)
     * @returns Array of result rows typed as T
     *
     * @example
     * ```typescript
     * const pools = await clickhouse.query<IPoolAggregate>(`
     *     SELECT
     *         poolAddress,
     *         sum(abs(amountSun)) / 1000000 AS totalAmountTrx,
     *         count() AS delegationCount,
     *         uniq(fromAddress) AS delegatorCount
     *     FROM delegations
     *     WHERE timestamp > now() - INTERVAL {hours:UInt32} HOUR
     *     GROUP BY poolAddress
     *     ORDER BY totalAmountTrx DESC
     *     LIMIT 50
     * `, { hours: 24 });
     * ```
     */
    query<T = Record<string, unknown>>(
        sql: string,
        params?: Record<string, unknown>
    ): Promise<T[]>;

    /**
     * Insert rows into a table using batch insert.
     *
     * ClickHouse is optimized for batch inserts. Prefer inserting multiple
     * rows at once rather than single-row inserts. For high-throughput
     * scenarios, buffer rows in memory and flush periodically.
     *
     * @param table - Target table name (will be prefixed for plugins)
     * @param rows - Array of row objects matching table schema
     *
     * @example
     * ```typescript
     * await clickhouse.insert('delegations', [
     *     { txId: 'abc', timestamp: new Date(), poolAddress: 'T...' },
     *     { txId: 'def', timestamp: new Date(), poolAddress: 'T...' }
     * ]);
     * ```
     */
    insert<T extends Record<string, unknown>>(
        table: string,
        rows: T[]
    ): Promise<void>;

    /**
     * Execute DDL or command statements (CREATE TABLE, ALTER, DROP, etc.).
     *
     * Used for schema management in migrations. Does not return results.
     *
     * @param sql - DDL statement to execute
     *
     * @example
     * ```typescript
     * await clickhouse.exec(`
     *     CREATE TABLE IF NOT EXISTS delegations (
     *         txId String,
     *         timestamp DateTime64(3),
     *         poolAddress Nullable(String)
     *     )
     *     ENGINE = MergeTree()
     *     ORDER BY (timestamp, poolAddress)
     *     TTL timestamp + INTERVAL 90 DAY
     * `);
     * ```
     */
    exec(sql: string): Promise<void>;

    /**
     * Check if ClickHouse connection is healthy.
     *
     * @returns True if ClickHouse is reachable and responding
     */
    ping(): Promise<boolean>;
}
