/**
 * Controller for ClickHouse browser API endpoints.
 *
 * Provides parity with the MongoDB collection browser so administrators
 * can inspect ClickHouse tables from the same console UI without dropping
 * into clickhouse-client. Two endpoints — stats and rows — match the
 * shape of /api/admin/database/{stats,collections/:name/documents} for
 * straightforward frontend reuse.
 *
 * Why this controller exists:
 * - ClickHouse data was previously invisible from the admin UI; ops had
 *   no way to verify a table's row count, size, or sample contents.
 * - Mirroring the MongoDB browser keeps the admin mental model uniform.
 * - Centralizes identifier validation so the SELECT * query path cannot
 *   be coerced into reading a table that does not exist or into executing
 *   arbitrary SQL — ClickHouse query parameters cannot bind identifiers, so
 *   the database and table names are validated against system.tables before
 *   interpolation.
 *
 * The unscoped listing is the universal browser and covers every database
 * except ClickHouse's own, so data kept outside the application database —
 * the `tron` chain data, for one — is visible from the same console. Scoped
 * listings stay inside the application database, because a plugin or module
 * asking for its own tables must never be handed another database's.
 */

import type { Request, Response } from 'express';
import type { IClickHouseService, ISystemLogService } from '@/types';

/**
 * ClickHouse's own databases. They describe the server rather than hold data
 * anyone stored, so the universal listing leaves them out and the row reader
 * refuses them.
 */
const SERVER_DATABASES: readonly string[] = ['system', 'INFORMATION_SCHEMA', 'information_schema'];

interface ITableStat {
    database: string;
    name: string;
    rowCount: number;
    sizeBytes: number;
    engine: string;
}

interface IClickHouseStats {
    dbName: string;
    totalSize: number;
    tables: ITableStat[];
}

interface IPaginatedRows {
    rows: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
}

/** Why a request was refused, written into the error response as-is. */
interface IRequestProblem {
    /** The HTTP status to answer with. */
    status: number;
    /** A short label for the problem. */
    error: string;
    /** What the caller has to change. */
    message: string;
}

export class ClickHouseBrowserController {
    constructor(
        private clickhouse: IClickHouseService,
        private logger: ISystemLogService
    ) {}

    /**
     * GET /api/admin/clickhouse/stats
     *
     * Returns one row per table (database, name, row count, size, engine)
     * plus the aggregate size. Sorted by size descending so the heaviest
     * tables appear first, matching the MongoDB browser. With no scope the
     * list covers every database except ClickHouse's own, because this is the
     * universal browser. Accepts either `?prefix=` or repeated `?tables=` to
     * scope the list to the application database; `tables` wins when both
     * are sent, and an empty `tables` is a 400.
     *
     * @param req - The request carrying the optional scope parameters.
     * @param res - The response the stats or an error is written to.
     */
    getStats = async (req: Request, res: Response): Promise<void> => {
        try {
            // Optional `?prefix=` narrows the response to one namespace so an
            // embedded browser (a plugin admin page, say) is not handed the
            // whole deployment's table inventory. Filtering happens in SQL
            // rather than in the client so the untargeted list never leaves
            // the server. The value is bound as a query parameter — never
            // interpolated — because it arrives from the request.
            const prefixParam = req.query.prefix;
            const prefix = typeof prefixParam === 'string' && prefixParam.length > 0
                ? prefixParam
                : null;
            // Optional repeated `?tables=` narrows the response to exact table
            // names. Core modules use it because their tables share no naming
            // prefix. When present it replaces the prefix filter, and the
            // names are bound as an array parameter for the same reason the
            // prefix is: they arrive from the request.
            const tableFilter = ClickHouseBrowserController.readTableNames(req.query.tables);

            if (tableFilter !== null && tableFilter.length === 0) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid tables filter',
                    message: 'tables must name at least one table'
                });
            } else {
                const stats = await this.loadStats(prefix, tableFilter);
                res.status(200).json({ success: true, data: stats });
            }
        } catch (error) {
            this.logger.error({ error }, 'Failed to fetch ClickHouse stats');
            res.status(500).json({
                success: false,
                error: 'Failed to fetch ClickHouse statistics',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    };

    /**
     * Query the table inventory for the stats endpoint.
     *
     * Kept apart from the handler so the handler only decides between
     * refusing the request and answering it. There are three query shapes. A
     * scoped caller — exact names or a prefix — is a plugin or module asking
     * for its own tables, which all live in the application database, so the
     * query never leaves it. Only the unscoped universal view spans databases.
     *
     * @param prefix - The name prefix to scope to, or null for none.
     * @param tableFilter - Exact table names to scope to, or null for none.
     *                      Takes precedence over `prefix`.
     * @returns Every matching table sorted by size, largest first, with the
     *          application database's name and the total size.
     */
    private async loadStats(prefix: string | null, tableFilter: string[] | null): Promise<IClickHouseStats> {
        let sql: string;
        let params: Record<string, unknown>;
        if (tableFilter !== null) {
            sql = `
                SELECT database, name, total_rows, total_bytes, engine
                FROM system.tables
                WHERE database = currentDatabase()
                  AND has({tables:Array(String)}, name)
                ORDER BY name
            `;
            params = { tables: tableFilter };
        } else if (prefix !== null) {
            sql = `
                SELECT database, name, total_rows, total_bytes, engine
                FROM system.tables
                WHERE database = currentDatabase()
                  AND startsWith(name, {prefix:String})
                ORDER BY name
            `;
            params = { prefix };
        } else {
            sql = `
                SELECT database, name, total_rows, total_bytes, engine
                FROM system.tables
                WHERE NOT has({serverDatabases:Array(String)}, database)
                  AND NOT is_temporary
                ORDER BY database, name
            `;
            params = { serverDatabases: SERVER_DATABASES };
        }

        // The two reads are independent, so they run together rather than
        // costing the page two round trips in a row.
        const [rawTables, dbInfo] = await Promise.all([
            this.clickhouse.query<{
                database: string;
                name: string;
                total_rows: string | null;
                total_bytes: string | null;
                engine: string;
            }>(sql, params),
            this.clickhouse.query<{ dbName: string }>(`SELECT currentDatabase() AS dbName`)
        ]);
        const dbName = dbInfo[0]?.dbName ?? process.env.CLICKHOUSE_DATABASE ?? '';

        const tables: ITableStat[] = rawTables.map((row) => ({
            database: row.database,
            name: row.name,
            rowCount: row.total_rows ? Number(row.total_rows) : 0,
            sizeBytes: row.total_bytes ? Number(row.total_bytes) : 0,
            engine: row.engine
        }));

        const totalSize = tables.reduce((acc, t) => acc + t.sizeBytes, 0);
        tables.sort((a, b) => b.sizeBytes - a.sizeBytes);

        return { dbName, totalSize, tables };
    }

    /**
     * Read the `tables` query parameter into a list of names, so the stats
     * query can tell "no filter asked for" apart from "a filter naming
     * nothing". The second must be rejected rather than read as the first,
     * because an unfiltered query hands a scoped caller the whole
     * deployment's inventory.
     *
     * Express parses `?tables=a&tables=b` as an array and `?tables=a` as a
     * string, so both shapes are accepted. Blank entries are dropped.
     *
     * @param raw - The raw `req.query.tables` value.
     * @returns `null` when the parameter is absent, otherwise the non-blank
     * names it carried, which may be empty.
     */
    private static readTableNames(raw: unknown): string[] | null {
        let names: string[] | null = null;
        if (typeof raw === 'string') {
            names = [raw];
        } else if (Array.isArray(raw)) {
            names = raw.filter((value): value is string => typeof value === 'string');
        }
        return names === null ? null : names.filter((name) => name.length > 0);
    }

    /**
     * Quote a database or table name for interpolation into a statement.
     *
     * ClickHouse cannot bind identifiers as query parameters, so a name has
     * to be written into the SQL itself. Callers validate the name against
     * `system.tables` first; doubling any backtick here is the second line
     * of defence, so a later loosening of that check cannot turn a name into
     * injected SQL.
     *
     * @param identifier - A database or table name already confirmed to exist.
     * @returns The name wrapped in backticks with inner backticks doubled.
     */
    private static quoteIdentifier(identifier: string): string {
        return `\`${identifier.replace(/`/g, '``')}\``;
    }

    /**
     * Check the paging and database parameters of a rows request before any
     * query runs.
     *
     * Grouped here so the handler has one place that decides whether to
     * refuse the request, instead of a series of early exits.
     *
     * @param page - The requested page, already parsed.
     * @param limit - The requested page size, already parsed and capped.
     * @param requestedDatabase - The database named in the request, or null
     *                            for the application database.
     * @returns The first problem found, or null when the request is acceptable.
     */
    private static findRowsRequestProblem(
        page: number,
        limit: number,
        requestedDatabase: string | null
    ): IRequestProblem | null {
        let problem: IRequestProblem | null = null;
        if (page < 1) {
            problem = { status: 400, error: 'Invalid page number', message: 'Page must be >= 1' };
        } else if (limit < 1 || limit > 100) {
            problem = { status: 400, error: 'Invalid limit', message: 'Limit must be between 1 and 100' };
        } else if (requestedDatabase !== null && SERVER_DATABASES.includes(requestedDatabase)) {
            problem = {
                status: 400,
                error: 'Invalid database',
                message: `ClickHouse server database is not browsable: ${requestedDatabase}`
            };
        }
        return problem;
    }

    /**
     * GET /api/admin/clickhouse/tables/:name/rows?page=&limit=&database=
     *
     * Returns a paginated slice of rows from the requested table. The
     * optional `database` selects which database the table lives in, so the
     * universal listing's tables outside the application database can be
     * opened; it defaults to the application database, which keeps every
     * existing caller working unchanged. ClickHouse's own databases are
     * refused, matching what the listing shows. Both names are validated
     * against system.tables before interpolation to prevent SQL injection —
     * ClickHouse query parameters cannot bind identifiers.
     *
     * @param req - The request carrying the table name, paging, and optional database.
     * @param res - The response the rows or an error is written to.
     */
    getRows = async (req: Request, res: Response): Promise<void> => {
        try {
            const { name } = req.params;
            const databaseParam = req.query.database;
            const requestedDatabase = typeof databaseParam === 'string' && databaseParam.length > 0
                ? databaseParam
                : null;
            const page = parseInt(req.query.page as string) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

            let problem = ClickHouseBrowserController.findRowsRequestProblem(page, limit, requestedDatabase);
            let result: IPaginatedRows | null = null;

            if (problem === null) {
                // Identifier whitelist — confirms the requested table actually
                // exists in the requested database, or the application database
                // when none was named, before either name is interpolated. The
                // database comes back from the row so the interpolated value is
                // the one ClickHouse reported, not the one the request supplied.
                const exists = await this.clickhouse.query<{ database: string; name: string }>(
                    `SELECT database, name FROM system.tables
                     WHERE database = if({database:String} = '', currentDatabase(), {database:String})
                       AND name = {table:String}
                     LIMIT 1`,
                    { database: requestedDatabase ?? '', table: name }
                );
                if (exists.length === 0) {
                    problem = {
                        status: 404,
                        error: 'Table not found',
                        message: `No such table: ${requestedDatabase ?? 'current database'}.${name}`
                    };
                } else {
                    result = await this.readPage(exists[0].database, exists[0].name, page, limit);
                }
            }

            if (problem !== null) {
                res.status(problem.status).json({ success: false, error: problem.error, message: problem.message });
            } else {
                res.status(200).json({ success: true, data: result });
            }
        } catch (error) {
            this.logger.error(
                { error, params: req.params, query: req.query },
                'Failed to fetch ClickHouse rows'
            );
            res.status(500).json({
                success: false,
                error: 'Failed to fetch table rows',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    };

    /**
     * Read one page of rows from a table already confirmed to exist.
     *
     * No ORDER BY: tables are read in primary-key order (the engine's native
     * sort), which is fast and avoids accidentally triggering a full-table sort
     * on large tables.
     *
     * @param database - The table's database, as `system.tables` reported it.
     * @param table - The table's name, as `system.tables` reported it.
     * @param page - The page to read, starting at 1.
     * @param limit - Rows per page.
     * @returns The rows and the paging figures the browser renders.
     */
    private async readPage(database: string, table: string, page: number, limit: number): Promise<IPaginatedRows> {
        // Belt-and-braces: even though both names are whitelisted, escape
        // any backticks before quoting so a future relaxation of the check
        // can't punch through.
        const safeName = `${ClickHouseBrowserController.quoteIdentifier(database)}.` +
            ClickHouseBrowserController.quoteIdentifier(table);
        const offset = (page - 1) * limit;

        // The page and the count are independent, so they run together rather
        // than costing the request two round trips in a row.
        const [rows, totalResult] = await Promise.all([
            this.clickhouse.query<Record<string, unknown>>(
                `SELECT * FROM ${safeName} LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
                { limit, offset }
            ),
            this.clickhouse.query<{ count: string }>(
                `SELECT count() AS count FROM ${safeName}`
            )
        ]);
        const total = totalResult.length > 0 ? Number(totalResult[0].count) : 0;
        const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

        return {
            rows,
            total,
            page,
            limit,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
        };
    }
}
