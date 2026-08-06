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
import type { ISystemLogService } from '@/types';
import {
    DatabaseBrowserRepository,
    InvalidCursorError
} from '../repositories/database-browser.repository.js';
import type { CursorDirection } from '../types/browser.js';

/** The travel directions the cursor-paged branch accepts. */
const CURSOR_DIRECTIONS: ReadonlySet<string> = new Set<CursorDirection>([
    'first',
    'next',
    'prev',
    'last'
]);

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
            // Optional `?prefix=` narrows the response to one namespace, which is
            // how an embedded browser (e.g. a plugin admin page scoped to
            // `plugin_<id>_`) avoids receiving the whole deployment's inventory.
            const prefixParam = req.query.prefix;
            const prefix = typeof prefixParam === 'string' && prefixParam.length > 0
                ? prefixParam
                : undefined;

            const stats = await this.repository.getDatabaseStats(prefix);

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
     * Serves two paging strategies from one route, chosen by whether the
     * request carries a `direction`. Cursor paging is what the admin browser
     * uses and the only strategy that can reach a deep page safely; the
     * offset branch below is retained because `?page=` is a published contract
     * and remains perfectly reasonable on a small collection.
     *
     * Query parameters (cursor paging):
     * - direction: `first` | `next` | `prev` | `last`
     * - cursor: `_id` to step from; required by `next` and `prev`
     * - limit: Documents per page (default: 20, max: 100)
     *
     * Query parameters (offset paging):
     * - page: Page number (1-indexed, default: 1)
     * - limit: Documents per page (default: 20, max: 100)
     * - sort: Sort field (default: '-_id' for newest first)
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
        if (typeof req.query.direction === 'string') {
            await this.getDocumentPage(req, res);
            return;
        }

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
     * Cursor-paged branch of `GET /collections/:name/documents`.
     *
     * Reached when the request carries a `direction`. Exists so the browser can
     * offer First and Last at all: an offset jump to the end of a large
     * collection makes MongoDB walk every skipped index entry, which on the
     * 80M-document `transactions` collection is a production-grade stall for
     * ten rows. A cursor page touches `limit + 1` index entries wherever it
     * sits — see `getDocumentPage` for how.
     *
     * A missing cursor on `next`/`prev` is a 400 rather than a silent fallback
     * to the first page, because the two outcomes are indistinguishable on
     * screen: the operator would click Next and appear to be sent back to the
     * start with no indication anything went wrong.
     *
     * @param req - Express request carrying collection name, direction, cursor, limit.
     * @param res - Express response object.
     */
    private async getDocumentPage(req: Request, res: Response): Promise<void> {
        try {
            const { name } = req.params;
            const direction = req.query.direction as string;
            const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
            const cursor = typeof req.query.cursor === 'string' && req.query.cursor.length > 0
                ? req.query.cursor
                : undefined;

            if (!CURSOR_DIRECTIONS.has(direction)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid direction',
                    message: `Direction must be one of: ${[...CURSOR_DIRECTIONS].join(', ')}`
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

            if ((direction === 'next' || direction === 'prev') && cursor === undefined) {
                res.status(400).json({
                    success: false,
                    error: 'Missing cursor',
                    message: `Direction "${direction}" requires a cursor to step from`
                });
                return;
            }

            const result = await this.repository.getDocumentPage(name, {
                limit,
                direction: direction as CursorDirection,
                cursor
            });

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            // A cursor this server cannot read is the client's problem, not a
            // server fault — most often a token minted before a deploy. Answer
            // 400 with a recoverable instruction rather than a 500 that reads
            // like the database is down.
            if (error instanceof InvalidCursorError) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid cursor',
                    message: `${error.message}. Reload the page to start from the first page.`
                });
                return;
            }

            this.logger.error(
                { error, params: req.params, query: req.query },
                'Failed to fetch document page'
            );

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
     * DELETE /api/admin/database/collections/:name/documents/:id
     *
     * Removes a single document from the collection by _id.
     *
     * Why this endpoint:
     * - Admins need to remove bad/stale records without dropping into a shell
     * - Scoped to a single document — never bulk delete — to keep blast radius small
     * - Admin-authenticated via the parent router's requireAdmin middleware
     *
     * Responses:
     * - 200 with `{ success: true, data: { deletedCount: 1 } }` on success
     * - 404 with `{ success: false, error: 'Document not found', data: { deletedCount: 0 } }`
     *   if the document does not exist
     * - 500 with `{ success: false, error, message }` on unexpected errors
     *
     * @param req - Express request with collection name and document id
     * @param res - Express response
     */
    async deleteDocument(req: Request, res: Response): Promise<void> {
        const { name, id } = req.params;

        try {
            const deletedCount = await this.repository.deleteDocument(name, id);

            if (deletedCount === 0) {
                res.status(404).json({
                    success: false,
                    error: 'Document not found',
                    data: { deletedCount: 0 }
                });
                return;
            }

            this.logger.info({ collection: name, id, deletedCount }, 'Deleted document');
            res.status(200).json({
                success: true,
                data: { deletedCount }
            });
        } catch (error) {
            this.logger.error({ error, params: req.params }, 'Failed to delete document');

            res.status(500).json({
                success: false,
                error: 'Failed to delete document',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * PUT /api/admin/database/collections/:name/documents/:id
     *
     * Replaces a document's contents with the supplied JSON body.
     *
     * Why this endpoint exists: browsing without editing forces an operator to
     * leave for a Mongo shell the moment they need to correct a single field,
     * which is exactly the context switch the browser exists to remove. Replace
     * semantics mirror the UI, which edits the whole document as one JSON blob.
     *
     * Validation:
     * - Body must be a JSON object — arrays and primitives are rejected, since
     *   a MongoDB document is neither and the driver's error would be opaque
     * - `_id` in the body is ignored by the repository; documents are replaced
     *   in place, never re-keyed
     *
     * Responses:
     * - 200 with `{ success: true, data: { matchedCount: 1 } }` on success
     * - 400 when the body is not a JSON object
     * - 404 when no document carries that `_id`
     * - 500 on unexpected errors
     *
     * @param req - Express request with collection name, document id, and body
     * @param res - Express response
     */
    async replaceDocument(req: Request, res: Response): Promise<void> {
        const { name, id } = req.params;

        try {
            const document = req.body;

            if (typeof document !== 'object' || document === null || Array.isArray(document)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid document',
                    message: 'Request body must be a JSON object'
                });
                return;
            }

            const matchedCount = await this.repository.replaceDocument(name, id, document);

            if (matchedCount === 0) {
                res.status(404).json({
                    success: false,
                    error: 'Document not found',
                    data: { matchedCount: 0 }
                });
                return;
            }

            this.logger.info({ collection: name, id, matchedCount }, 'Replaced document');
            res.status(200).json({
                success: true,
                data: { matchedCount }
            });
        } catch (error) {
            this.logger.error({ error, params: req.params }, 'Failed to replace document');

            res.status(500).json({
                success: false,
                error: 'Failed to replace document',
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
