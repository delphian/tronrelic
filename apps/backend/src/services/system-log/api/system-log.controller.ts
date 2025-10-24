import type { Request, Response, NextFunction } from 'express';
import type { ISystemLogService } from '@tronrelic/types';
import type { LogLevel } from '../database/index.js';

/**
 * System Log Controller
 *
 * Handles HTTP requests for system log management endpoints.
 * Provides CRUD operations for querying, filtering, resolving, and deleting logs.
 *
 * **Why this exists:**
 *
 * Separates route handling logic from business logic (SystemLogService).
 * This controller focuses on:
 * - Request parsing and validation
 * - Response formatting
 * - HTTP status codes
 * - Error handling delegation to Express middleware
 *
 * The actual log operations (MongoDB queries, filtering, cleanup) live in
 * SystemLogService, keeping concerns separated.
 */
export class SystemLogController {
    constructor(private readonly logService: ISystemLogService) {}

    /**
     * Get paginated logs with optional filtering.
     *
     * Supports filtering by:
     * - Log levels (error, warn, info, debug)
     * - Service/plugin ID
     * - Resolved status
     * - Date range (startDate, endDate)
     *
     * Supports pagination via page/limit parameters.
     *
     * @route GET /api/admin/system/logs
     */
    public getLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const {
                levels,
                service,
                resolved,
                startDate,
                endDate,
                page,
                limit
            } = req.query;

            // Parse query parameters
            const query: any = {};

            if (levels) {
                query.levels = Array.isArray(levels) ? levels as LogLevel[] : [levels as LogLevel];
            }

            if (service) {
                query.service = service as string;
            }

            if (resolved !== undefined) {
                query.resolved = resolved === 'true';
            }

            if (startDate) {
                query.startDate = new Date(startDate as string);
            }

            if (endDate) {
                query.endDate = new Date(endDate as string);
            }

            if (page) {
                query.page = parseInt(page as string, 10);
            }

            if (limit) {
                query.limit = parseInt(limit as string, 10);
            }

            const result = await this.logService.getLogs(query);

            res.json({
                success: true,
                ...result
            });
        } catch (error) {
            next(error);
        }
    };

    /**
     * Get aggregate statistics about system logs.
     *
     * Returns counts by level, service, and resolved status.
     * Used by admin dashboard widgets.
     *
     * @route GET /api/admin/system/logs/stats
     */
    public getStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const stats = await this.logService.getStats();
            res.json({ success: true, stats });
        } catch (error) {
            next(error);
        }
    };

    /**
     * Get a single log entry by ID.
     *
     * Returns 404 if log entry not found.
     *
     * @route GET /api/admin/system/logs/:id
     */
    public getLogById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const log = await this.logService.getLogById(id);

            if (!log) {
                res.status(404).json({
                    success: false,
                    error: 'Log entry not found'
                });
                return;
            }

            res.json({ success: true, log });
        } catch (error) {
            next(error);
        }
    };

    /**
     * Mark a log entry as resolved.
     *
     * Sets the resolved flag and records who resolved it.
     * Allows admins to acknowledge errors without deleting them.
     *
     * @route PATCH /api/admin/system/logs/:id/resolve
     */
    public markAsResolved = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const { resolvedBy } = req.body;

            await this.logService.markAsResolved(id, resolvedBy);

            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    };

    /**
     * Mark a log entry as unresolved.
     *
     * Reverts the resolved flag. Used when an error recurs or was
     * incorrectly marked as resolved.
     *
     * Returns 404 if log entry not found.
     *
     * @route PATCH /api/admin/system/logs/:id/unresolve
     */
    public markAsUnresolved = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const log = await this.logService.markAsUnresolved(id);

            if (!log) {
                res.status(404).json({
                    success: false,
                    error: 'Log entry not found'
                });
                return;
            }

            res.json({ success: true, log });
        } catch (error) {
            next(error);
        }
    };

    /**
     * Delete all log entries.
     *
     * **Destructive operation** - Removes all logs from MongoDB.
     * Should be used with caution and typically only in development.
     *
     * @route DELETE /api/admin/system/logs
     */
    public deleteAllLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const deletedCount = await this.logService.deleteAllLogs();
            res.json({
                success: true,
                message: `Deleted ${deletedCount} log entries`,
                deletedCount
            });
        } catch (error) {
            next(error);
        }
    };
}
