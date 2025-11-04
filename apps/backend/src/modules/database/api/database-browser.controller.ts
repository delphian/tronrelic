/**
 * Controller for database browser API endpoints.
 *
 * Handles HTTP requests for browsing MongoDB collections and documents. Provides
 * REST endpoints for collection statistics, document pagination, and filtered queries.
 *
 * Why this controller exists:
 * - Separates HTTP concerns (validation, response formatting) from data access logic
 * - Provides clean REST API for frontend database browser
 * - Maintains consistent error handling across all database browser endpoints
 * - Enforces request validation and security checks at API boundary
 *
 * All endpoints require admin authentication (enforced by parent router middleware).
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@tronrelic/types';
import { DatabaseBrowserRepository } from '../repositories/database-browser.repository.js';

export class DatabaseBrowserController {
    /**
     * Creates a new database browser controller instance.
     *
     * @param repository - Database browser repository for data access
     * @param logger - Logger for request handling and errors
     */
    constructor(
        private repository: DatabaseBrowserRepository,
        private logger: ISystemLogService
    ) {}

    /**
     * GET /api/admin/database/stats
     *
     * Retrieves database-wide statistics including all collections.
     *
     * Response includes:
     * - Database name
     * - Total size across all collections
     * - Per-collection metrics (count, size, indexes)
     *
     * Why this endpoint:
     * - Provides overview for main database browser page
     * - Helps administrators identify large collections
     * - Shows database composition at a glance
     *
     * @param req - Express request object
     * @param res - Express response object
     */
    async getStats(req: Request, res: Response): Promise<void> {
        try {
            const stats = await this.repository.getDatabaseStats();

            res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error) {
            this.logger.error({ error }, 'Failed to fetch database stats');

            res.status(500).json({
                success: false,
                error: 'Failed to fetch database statistics',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * GET /api/admin/database/collections/:name/documents
     *
     * Retrieves paginated documents from a specific collection.
     *
     * Query parameters:
     * - page: Page number (1-indexed, default: 1)
     * - limit: Documents per page (default: 20, max: 100)
     * - sort: Sort field (default: '-_id' for newest first)
     *
     * Response includes:
     * - Documents array
     * - Pagination metadata (total, page, totalPages, hasNext/PrevPage)
     *
     * Why this endpoint:
     * - Allows browsing collection contents without external tools
     * - Supports sorting for newest/oldest document exploration
     * - Enforces reasonable page sizes to prevent memory issues
     *
     * @param req - Express request object with collection name in params
     * @param res - Express response object
     */
    async getDocuments(req: Request, res: Response): Promise<void> {
        try {
            const { name } = req.params;
            const page = parseInt(req.query.page as string) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
            const sortParam = (req.query.sort as string) || '-_id';

            // Parse sort parameter (e.g., '-_id' -> { _id: -1 })
            const sort = this.parseSortParam(sortParam);

            // Validate inputs
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

            const result = await this.repository.getDocuments(name, { page, limit, sort });

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            this.logger.error({ error, params: req.params, query: req.query }, 'Failed to fetch documents');

            res.status(500).json({
                success: false,
                error: 'Failed to fetch documents',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/admin/database/collections/:name/query
     *
     * Executes a filtered query against a collection.
     *
     * Request body:
     * - filter: MongoDB query object (sanitized by middleware)
     * - page: Page number (1-indexed, default: 1)
     * - limit: Documents per page (default: 20, max: 100)
     * - sort: Sort specification object (default: { _id: -1 })
     *
     * Response includes:
     * - Matching documents
     * - Pagination metadata
     *
     * Why this endpoint:
     * - Enables searching/filtering without external MongoDB clients
     * - Supports MongoDB query syntax for flexible filtering
     * - Sanitization prevents injection attacks
     *
     * Security:
     * - Middleware (express-mongo-sanitize) strips $ and . from input
     * - Repository blocks dangerous operators ($where, $function, etc.)
     * - Read-only operations only
     *
     * @param req - Express request object with collection name and query
     * @param res - Express response object
     */
    async queryDocuments(req: Request, res: Response): Promise<void> {
        try {
            const { name } = req.params;
            const { filter = {}, page = 1, limit = 20, sort = { _id: -1 } } = req.body;

            // Validate inputs
            if (typeof filter !== 'object' || Array.isArray(filter)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid filter',
                    message: 'Filter must be an object'
                });
                return;
            }

            const parsedPage = parseInt(page as any) || 1;
            const parsedLimit = Math.min(parseInt(limit as any) || 20, 100);

            if (parsedPage < 1) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid page number',
                    message: 'Page must be >= 1'
                });
                return;
            }

            if (parsedLimit < 1 || parsedLimit > 100) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid limit',
                    message: 'Limit must be between 1 and 100'
                });
                return;
            }

            if (typeof sort !== 'object' || Array.isArray(sort)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid sort',
                    message: 'Sort must be an object'
                });
                return;
            }

            const result = await this.repository.queryDocuments(name, {
                filter,
                page: parsedPage,
                limit: parsedLimit,
                sort
            });

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            this.logger.error({ error, params: req.params, body: req.body }, 'Failed to execute query');

            res.status(500).json({
                success: false,
                error: 'Failed to execute query',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Parses sort parameter string into MongoDB sort object.
     *
     * Supports prefixed notation for direction:
     * - '-field' -> { field: -1 } (descending)
     * - 'field' -> { field: 1 } (ascending)
     *
     * Why this format:
     * - Common in REST APIs (e.g., JSON:API spec)
     * - Concise for single-field sorts
     * - Easy to parse from query strings
     *
     * @param sortParam - Sort parameter string (e.g., '-_id', 'timestamp')
     * @returns MongoDB sort object
     *
     * @example
     * parseSortParam('-_id') // { _id: -1 }
     * parseSortParam('timestamp') // { timestamp: 1 }
     */
    private parseSortParam(sortParam: string): Record<string, 1 | -1> {
        if (sortParam.startsWith('-')) {
            return { [sortParam.substring(1)]: -1 };
        }
        return { [sortParam]: 1 };
    }
}
