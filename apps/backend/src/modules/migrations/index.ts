import { Router } from 'express';
import { MigrationsController } from './migrations.controller.js';
import type { IDatabaseService } from '@tronrelic/types';

/**
 * Create migrations module router with all endpoints.
 *
 * Registers REST API endpoints for migration management:
 * - GET /status - Get migration system status
 * - GET /history - Get execution history
 * - POST /execute - Execute migrations
 * - GET /:id - Get migration details
 *
 * All routes require admin authentication (enforced by parent router).
 *
 * @param database - Database service with migration methods
 * @returns Express router with migration endpoints
 *
 * @example
 * ```typescript
 * // In backend server setup
 * const migrationsRouter = createMigrationsRouter(database);
 * app.use('/api/admin/migrations', adminAuthMiddleware, migrationsRouter);
 * ```
 */
export function createMigrationsRouter(database: IDatabaseService): Router {
    const router = Router();
    const controller = new MigrationsController(database);

    // GET /api/admin/migrations/status
    router.get('/status', (req, res) => controller.getStatus(req, res));

    // GET /api/admin/migrations/history
    router.get('/history', (req, res) => controller.getHistory(req, res));

    // POST /api/admin/migrations/execute
    router.post('/execute', (req, res) => controller.execute(req, res));

    // GET /api/admin/migrations/:id
    router.get('/:id', (req, res) => controller.getDetails(req, res));

    return router;
}

export { MigrationsService } from './migrations.service.js';
export { MigrationsController } from './migrations.controller.js';
