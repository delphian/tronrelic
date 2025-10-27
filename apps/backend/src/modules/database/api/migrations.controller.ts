import type { Request, Response } from 'express';
import { MigrationsService } from '../services/migrations.service.js';
import type { IDatabaseService, ISystemLogService } from '@tronrelic/types';

/**
 * REST API controller for migration management endpoints.
 *
 * Provides HTTP endpoints for:
 * - Getting migration status (pending/completed/running)
 * - Viewing execution history with filtering
 * - Executing specific migrations
 * - Executing all pending migrations
 * - Getting detailed migration information
 *
 * All endpoints require admin authentication (enforced by middleware).
 *
 * @example
 * ```typescript
 * // In route registration
 * const controller = new MigrationsController(database);
 *
 * router.get('/status', controller.getStatus.bind(controller));
 * router.post('/execute', controller.executeOne.bind(controller));
 * ```
 */
export class MigrationsController {
    private readonly service: MigrationsService;
    private readonly logger: ISystemLogService;

    /**
     * Create a new migrations controller.
     *
     * @param database - Database service with migration methods
     * @param logger - System log service for request logging
     */
    constructor(database: IDatabaseService, logger: ISystemLogService) {
        this.service = new MigrationsService(database, logger);
        this.logger = logger;
    }

    /**
     * GET /api/admin/migrations/status
     *
     * Get comprehensive migration system status.
     *
     * **Response:**
     * ```json
     * {
     *   "pending": [...],
     *   "completed": [...],
     *   "isRunning": false,
     *   "totalPending": 3,
     *   "totalCompleted": 10
     * }
     * ```
     */
    public async getStatus(req: Request, res: Response): Promise<void> {
        try {
            const status = await this.service.getStatus();
            res.json(status);
        } catch (error: any) {
            this.logger.error({ error }, 'Failed to get migration status');
            res.status(500).json({
                error: 'Failed to get migration status',
                message: error.message
            });
        }
    }

    /**
     * GET /api/admin/migrations/history
     *
     * Get migration execution history with optional filtering.
     *
     * **Query parameters:**
     * - `limit` (number, default: 100, max: 500) - Maximum records to return
     * - `status` ('completed' | 'failed' | 'all', default: 'all') - Filter by status
     *
     * **Response:**
     * ```json
     * {
     *   "migrations": [...],
     *   "total": 42
     * }
     * ```
     */
    public async getHistory(req: Request, res: Response): Promise<void> {
        try {
            const limit = parseInt(req.query.limit as string) || 100;
            const status = (req.query.status as 'completed' | 'failed' | 'all') || 'all';

            const migrations = await this.service.getHistory(limit, status);

            res.json({
                migrations,
                total: migrations.length
            });
        } catch (error: any) {
            this.logger.error({ error }, 'Failed to get migration history');
            res.status(500).json({
                error: 'Failed to get migration history',
                message: error.message
            });
        }
    }

    /**
     * POST /api/admin/migrations/execute
     *
     * Execute specific migration or all pending migrations.
     *
     * **Request body:**
     * ```json
     * {
     *   "migrationId": "001_create_users"  // Optional, omit to execute all
     * }
     * ```
     *
     * **Response:**
     * ```json
     * {
     *   "success": true,
     *   "executed": ["001_create_users"],
     *   "failed": {  // Only if success=false
     *     "migrationId": "002_add_indexes",
     *     "error": "Index creation failed"
     *   }
     * }
     * ```
     */
    public async execute(req: Request, res: Response): Promise<void> {
        try {
            const { migrationId } = req.body;

            let result;
            if (migrationId) {
                // Execute specific migration
                result = await this.service.executeOne(migrationId);
            } else {
                // Execute all pending migrations
                result = await this.service.executeAll();
            }

            const statusCode = result.success ? 200 : 500;
            res.status(statusCode).json(result);
        } catch (error: any) {
            this.logger.error({ error, body: req.body }, 'Failed to execute migration');

            // Check for specific error types
            if (error.message.includes('already running')) {
                res.status(409).json({
                    error: 'Migration already running',
                    message: error.message
                });
            } else if (error.message.includes('not found')) {
                res.status(404).json({
                    error: 'Migration not found',
                    message: error.message
                });
            } else {
                res.status(500).json({
                    error: 'Failed to execute migration',
                    message: error.message
                });
            }
        }
    }

    /**
     * GET /api/admin/migrations/:id
     *
     * Get detailed information about a specific migration.
     *
     * **Response:**
     * ```json
     * {
     *   "migration": {...},  // Null if already executed
     *   "isPending": true,
     *   "executions": [...]  // Historical execution records
     * }
     * ```
     */
    public async getDetails(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const details = await this.service.getMigrationDetails(id);
            res.json(details);
        } catch (error: any) {
            this.logger.error({ error, migrationId: req.params.id }, 'Failed to get migration details');

            if (error.message.includes('not found')) {
                res.status(404).json({
                    error: 'Migration not found',
                    message: error.message
                });
            } else {
                res.status(500).json({
                    error: 'Failed to get migration details',
                    message: error.message
                });
            }
        }
    }
}
