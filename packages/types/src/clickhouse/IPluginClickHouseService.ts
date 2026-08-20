/**
 * @fileoverview The ClickHouse client as a plugin receives it, scoped to that
 * plugin's own tables.
 *
 * Plugins used to be handed the shared `IClickHouseService` directly, which
 * meant each one wrote its physical table names out by hand and repeated the
 * `plugin_<id>_` prefix at every call site. That is the problem
 * `PluginDatabaseService` already solves for MongoDB, where a plugin asks for
 * `dust` and the service resolves it to `plugin_dust-tracker_dust`. This
 * interface gives ClickHouse the same treatment.
 *
 * The parity is deliberately partial, and the reason is worth stating plainly.
 * MongoDB access always names the collection as an argument, so there is one
 * place to intercept. ClickHouse takes whole SQL statements, and a table name
 * inside an opaque SQL string cannot be rewritten without parsing SQL. So
 * `insert` prefixes for you, while `query` and `exec` pass through and you name
 * the table with `table()` when building the statement.
 *
 * This is an ergonomic boundary, not a security one. Because `query` and `exec`
 * accept arbitrary SQL, a plugin can still read another plugin's tables. That
 * was already true when plugins shared the raw client, so nothing is lost, but
 * do not mistake this for isolation.
 */

/**
 * ClickHouse access scoped to one plugin's namespace.
 */
export interface IPluginClickHouseService {
    /**
     * The physical, SQL-ready name for one of this plugin's tables.
     *
     * Use this everywhere a table name is embedded in a statement, and never
     * write the physical name out. Two things make that important. The name
     * drifts if the plugin's identifier ever changes, and — because plugin ids
     * keep their hyphens — the name requires backtick quoting that ClickHouse
     * will reject the statement without. This returns the quoted form, so an
     * interpolated call site is correct by construction.
     *
     * @param logicalName - The table as the plugin thinks of it, such as
     *                      `'dust'`, with no prefix and no quoting of its own.
     * @returns The backtick-quoted physical name, ready to interpolate into
     *          SQL or to hand to `insert`.
     */
    table(logicalName: string): string;

    /**
     * The unquoted prefix every table of this plugin's begins with.
     *
     * This is for comparing against `system.tables.name`, which is a column
     * value rather than an identifier and therefore must not carry backticks.
     * Use `table()` for anything that goes into a statement as a table name.
     *
     * @returns The raw prefix, for filtering a table listing down to this
     *          plugin's own tables.
     */
    prefix(): string;

    /**
     * Insert rows into one of this plugin's tables.
     *
     * The table is named logically and resolved here, so a caller cannot
     * accidentally write to another plugin's table or misspell the prefix.
     *
     * @param logicalTable - The table as the plugin thinks of it, unprefixed.
     * @param rows - The batch to insert. ClickHouse is built for batches, so
     *               prefer accumulating rows over inserting them one at a time.
     * @param options - Per-call overrides. `waitForCommit: true` waits for the
     *                  async-insert flush to commit, for a caller that cannot
     *                  tolerate a failure surfacing later in a different log.
     */
    insert<T extends Record<string, unknown>>(
        logicalTable: string,
        rows: T[],
        options?: { waitForCommit?: boolean }
    ): Promise<void>;

    /**
     * Run a read query.
     *
     * Passed through unchanged, because the table name lives inside the SQL
     * where this service cannot reach it. Build the statement with `table()`.
     *
     * @param sql - The statement. Bind user-supplied values as parameters
     *              rather than interpolating them.
     * @param params - Values for the statement's bound parameters.
     * @returns The result rows.
     */
    query<T = Record<string, unknown>>(
        sql: string,
        params?: Record<string, unknown>
    ): Promise<T[]>;

    /**
     * Run a statement that returns no rows, such as DDL.
     *
     * Passed through unchanged for the same reason as `query`. Build the
     * statement with `table()`.
     *
     * @param sql - The statement to execute.
     */
    exec(sql: string): Promise<void>;

    /**
     * Check that ClickHouse is reachable, so a plugin can degrade rather than
     * fail when the analytics store is unavailable.
     *
     * @returns True when ClickHouse responds.
     */
    ping(): Promise<boolean>;
}
