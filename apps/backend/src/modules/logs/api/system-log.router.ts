import { Router } from 'express';
import { SystemLogService } from '../services/system-log.service.js';
import { SystemLogController } from './system-log.controller.js';

/**
 * Create system log router with all log management endpoints.
 *
 * This router handles all operations related to system logs stored in MongoDB:
 * - Querying and filtering logs
 * - Getting statistics
 * - Marking logs as resolved/unresolved
 * - Deleting logs
 *
 * **Mounting:**
 *
 * This router is mounted at `/logs` within the system router, so all routes
 * defined here are accessible at `/api/admin/system/logs/*`.
 *
 * **Authentication:**
 *
 * Admin authentication is enforced by the parent system router. All routes
 * here assume the user is already authenticated with ADMIN_API_TOKEN.
 *
 * @returns Express router with log management routes
 */
export function createSystemLogRouter(): Router {
    const router = Router();
    const logService = SystemLogService.getInstance();
    const controller = new SystemLogController(logService);

    // Get paginated logs with optional filtering
    // GET /api/admin/system/logs
    router.get('/', controller.getLogs);

    // Get log statistics (counts by level, service, resolved status)
    // GET /api/admin/system/logs/stats
    router.get('/stats', controller.getStats);

    // Get a single log entry by ID
    // GET /api/admin/system/logs/:id
    router.get('/:id', controller.getLogById);

    // Mark log as resolved
    // PATCH /api/admin/system/logs/:id/resolve
    router.patch('/:id/resolve', controller.markAsResolved);

    // Mark log as unresolved
    // PATCH /api/admin/system/logs/:id/unresolve
    router.patch('/:id/unresolve', controller.markAsUnresolved);

    // Delete all logs
    // DELETE /api/admin/system/logs
    router.delete('/', controller.deleteAllLogs);

    return router;
}
