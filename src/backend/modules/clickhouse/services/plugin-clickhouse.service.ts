/**
 * @fileoverview Scopes the shared ClickHouse client to a single plugin.
 *
 * Mirrors `PluginDatabaseService`, which wraps the Mongo connection so a plugin
 * asks for the collection `dust` and reads `plugin_dust-tracker_dust`. Before
 * this existed, plugins received the raw ClickHouse client and wrote their
 * physical table names out by hand, so the prefix rule was restated at every
 * call site and drifted the moment an identifier changed.
 *
 * Like `PluginDatabaseService`, this is constructed once per plugin during
 * plugin loading rather than being a singleton. The singleton rule in
 * modules.md governs services holding shared state configured once at
 * bootstrap; a per-plugin scope is the opposite of shared, and the point here
 * is that each plugin receives a different instance.
 */

import type { IClickHouseService, IPluginClickHouseService } from '@/types';
import { pluginPrefix } from '@/types';

/**
 * The logical table names a plugin may ask for.
 *
 * This is ClickHouse's own rule for an identifier that needs no quoting, and
 * requiring it here is a security gate rather than a style preference. The
 * name is interpolated into a backtick-quoted identifier, and `insert()` hands
 * the result to a client that drops it into `INSERT INTO ${table}` without
 * escaping anything, so a name carrying a backtick would close the quote and
 * inject into the statement. A plugin that builds a table name from data — a
 * per-token table, an operator-supplied suffix — is where that would come
 * from.
 *
 * The rule rejects rather than substituting, which is where this deliberately
 * differs from `DatabaseService.getPhysicalCollectionName`. That method
 * replaces illegal characters with `_`, which is safe for MongoDB but means
 * two distinct logical names can silently resolve to one collection. This API
 * is new and has no callers relying on the substituting behaviour, so a plugin
 * asking for something unusable is told at the call site instead of being
 * handed a table it did not ask for.
 */
const LOGICAL_TABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * ClickHouse access bound to one plugin's table namespace.
 */
export class PluginClickHouseService implements IPluginClickHouseService {
    /** The `plugin_<id>_` string every one of this plugin's tables begins with. */
    private readonly tablePrefix: string;

    /**
     * Bind the shared client to one plugin.
     *
     * The client arrives as a constructor argument rather than being pulled
     * from the singleton here, so a test can pass a stub and assert what a
     * plugin would run without a live ClickHouse behind it.
     *
     * @param inner - The shared client every plugin's wrapper delegates to.
     * @param pluginId - The plugin's `manifest.id`, which fixes this instance's
     *                   namespace for its lifetime.
     */
    constructor(
        private readonly inner: IClickHouseService,
        pluginId: string
    ) {
        this.tablePrefix = pluginPrefix(pluginId);
    }

    /**
     * Resolve a logical table name to the quoted physical name.
     *
     * The quoting is not decoration and is the reason to always come through
     * here. A plugin id keeps its hyphens, so a physical name such as
     * `plugin_dust-tracker_dust` is not a legal unquoted ClickHouse identifier
     * — the parser stops at the hyphen — and the installed client interpolates
     * whatever it is handed straight into the statement without quoting it.
     *
     * @param logicalName - The table as the plugin thinks of it, unprefixed and
     *                      unquoted, such as `'dust'`. It must match
     *                      `LOGICAL_TABLE_NAME_PATTERN`; build it from a
     *                      literal rather than from user input, and map any
     *                      caller-supplied value onto a fixed set of names you
     *                      control before passing it here.
     * @returns The backtick-quoted physical name, ready to interpolate into a
     *          statement or hand to `insert`.
     * @throws If `logicalName` is empty, not a string, or carries a character
     *         outside the pattern. The first would resolve to this plugin's
     *         bare prefix, which is not a table; the last is what stops a name
     *         assembled from data from breaking out of the quoting and
     *         injecting into the statement.
     */
    table(logicalName: string): string {
        if (!logicalName || typeof logicalName !== 'string') {
            throw new Error('table() requires a non-empty logical table name');
        }

        if (!LOGICAL_TABLE_NAME_PATTERN.test(logicalName)) {
            throw new Error(
                `table() rejected the logical table name '${logicalName}': a table name may ` +
                'contain only letters, digits, and underscores, and may not start with a digit. ' +
                'The name is interpolated into the statement, so anything else is an injection ' +
                'risk rather than a naming preference.'
            );
        }

        const result = `\`${this.tablePrefix}${logicalName}\``;

        return result;
    }

    /**
     * The unquoted prefix, for matching against `system.tables.name`.
     *
     * That column holds a value rather than an identifier, so a backtick would
     * be compared as part of the string and match nothing. Use `table()` for
     * anything entering a statement as a table name.
     *
     * @returns The raw `plugin_<id>_` prefix, for filtering a table listing
     *          down to the tables this plugin owns.
     */
    prefix(): string {
        const result = this.tablePrefix;

        return result;
    }

    /**
     * Insert a batch into one of this plugin's tables.
     *
     * Note the argument is the *logical* name — `'dust'`, not
     * `'plugin_dust-tracker_dust'`. Passing an already-prefixed name produces a
     * doubly-prefixed table that no reader ever looks at.
     *
     * @param logicalTable - The table as the plugin thinks of it, unprefixed.
     * @param rows - The batch to write. ClickHouse is built for batches, so
     *               accumulate rows rather than inserting one at a time.
     * @param options - Per-call overrides. `waitForCommit: true` waits for the
     *                  async-insert flush to commit, for a caller that cannot
     *                  tolerate a failure surfacing later in another log.
     */
    async insert<T extends Record<string, unknown>>(
        logicalTable: string,
        rows: T[],
        options?: { waitForCommit?: boolean }
    ): Promise<void> {
        await this.inner.insert(this.table(logicalTable), rows, options);

        return;
    }

    /**
     * Run a read query, passed through unchanged.
     *
     * The table name lives inside the SQL, where this service cannot reach it
     * without parsing the statement, so name tables with `table()` when you
     * build the string.
     *
     * @param sql - The statement. Bind caller-supplied values as parameters
     *              rather than interpolating them into the text.
     * @param params - Values for the statement's bound parameters.
     * @returns The result rows.
     */
    async query<T = Record<string, unknown>>(
        sql: string,
        params?: Record<string, unknown>
    ): Promise<T[]> {
        const result = await this.inner.query<T>(sql, params);

        return result;
    }

    /**
     * Run a statement that returns no rows, such as DDL, passed through
     * unchanged for the same reason as `query`.
     *
     * @param sql - The statement to execute, with tables named via `table()`.
     */
    async exec(sql: string): Promise<void> {
        await this.inner.exec(sql);

        return;
    }

    /**
     * Report whether ClickHouse is reachable, so a plugin can degrade rather
     * than fail when the analytics store is unavailable.
     *
     * @returns True when ClickHouse responds.
     */
    async ping(): Promise<boolean> {
        const result = await this.inner.ping();

        return result;
    }
}
