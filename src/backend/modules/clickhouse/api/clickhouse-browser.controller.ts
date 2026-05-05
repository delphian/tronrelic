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
 *   be coerced into reading from another database or executing arbitrary
 *   SQL — ClickHouse query parameters cannot bind identifiers, so the
 *   table name is validated against system.tables before interpolation.
 */

import type { Request, Response } from 'express';
import type { IClickHouseService, ISystemLogService } from '@/types';

interface ITableStat {
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

export class ClickHouseBrowserController {
    constructor(
        private clickhouse: IClickHouseService,
        private logger: ISystemLogService
    ) {}

    /**
     * GET /api/admin/clickhouse/stats
     *
     * Returns one row per table in the current database (name, row count,
     * size, engine) plus aggregate database size. Sorted by size descending
     * so the heaviest tables appear first, matching the MongoDB browser.
     */
    getStats = async (_req: Request, res: Response): Promise<void> => {
        try {
            const rawTables = await this.clickhouse.query<{
                name: string;
                total_rows: string | null;
                total_bytes: string | null;
                engine: string;
            }>(`
                SELECT name, total_rows, total_bytes, engine
                FROM system.tables
                WHERE database = currentDatabase()
                ORDER BY name
            `);

            const dbInfo = await this.clickhouse.query<{ dbName: string }>(
                `SELECT currentDatabase() AS dbName`
            );
            const dbName = dbInfo[0]?.dbName ?? 'tronrelic';

            const tables: ITableStat[] = rawTables.map((row) => ({
                name: row.name,
                rowCount: row.total_rows ? Number(row.total_rows) : 0,
                sizeBytes: row.total_bytes ? Number(row.total_bytes) : 0,
                engine: row.engine
            }));

            const totalSize = tables.reduce((acc, t) => acc + t.sizeBytes, 0);
            tables.sort((a, b) => b.sizeBytes - a.sizeBytes);

            const stats: IClickHouseStats = { dbName, totalSize, tables };
            res.status(200).json({ success: true, data: stats });
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
     * GET /api/admin/clickhouse/tables/:name/rows?page=&limit=
     *
     * Returns a paginated slice of rows from the requested table. Validates
     * the name against system.tables before interpolation to prevent SQL
     * injection — ClickHouse query parameters cannot bind identifiers.
     * No ORDER BY: tables are read in primary-key order (the engine's
     * native sort), which is fast and avoids accidentally triggering a
     * full-table sort on large tables.
     */
    getRows = async (req: Request, res: Response): Promise<void> => {
        try {
            const { name } = req.params;
            const page = parseInt(req.query.page as string) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

            if (page < 1) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid page number',
                    message: 'Page must be >= 1'
                });
                return;
            }
            if (limit < 1 || limit > 100) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid limit',
                    message: 'Limit must be between 1 and 100'
                });
                return;
            }

            // Identifier whitelist — confirms the requested table actually
            // exists in the current database before we interpolate the name.
            const exists = await this.clickhouse.query<{ name: string }>(
                `SELECT name FROM system.tables
                 WHERE database = currentDatabase() AND name = {table:String}
                 LIMIT 1`,
                { table: name }
            );
            if (exists.length === 0) {
                res.status(404).json({
                    success: false,
                    error: 'Table not found',
                    message: `No such table in current database: ${name}`
                });
                return;
            }

            // Belt-and-braces: even though `name` is whitelisted, escape any
            // backticks before quoting so a future relaxation of the check
            // can't punch through.
            const safeName = `\`${name.replace(/`/g, '``')}\``;
            const offset = (page - 1) * limit;

            const rows = await this.clickhouse.query<Record<string, unknown>>(
                `SELECT * FROM ${safeName} LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
                { limit, offset }
            );

            const totalResult = await this.clickhouse.query<{ count: string }>(
                `SELECT count() AS count FROM ${safeName}`
            );
            const total = totalResult.length > 0 ? Number(totalResult[0].count) : 0;
            const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

            const result: IPaginatedRows = {
                rows,
                total,
                page,
                limit,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            };

            res.status(200).json({ success: true, data: result });
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
}
