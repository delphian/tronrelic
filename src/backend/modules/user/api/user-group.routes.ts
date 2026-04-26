import { Router } from 'express';
import type { UserGroupController } from './user-group.controller.js';

/**
 * Create Express router for admin user-group endpoints.
 *
 * Mounted at `/api/admin/users/groups` with `requireAdmin` applied at the
 * parent. The service enforces reserved-admin slug rules and protects
 * system rows; the controller only maps thrown errors to HTTP status.
 */
export function createAdminUserGroupRouter(controller: UserGroupController): Router {
    const router = Router();

    router.get('/', controller.listGroups.bind(controller));
    router.post('/', controller.createGroup.bind(controller));
    router.get('/:id', controller.getGroup.bind(controller));
    router.patch('/:id', controller.updateGroup.bind(controller));
    router.delete('/:id', controller.deleteGroup.bind(controller));

    return router;
}
