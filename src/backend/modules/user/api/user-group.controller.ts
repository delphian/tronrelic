import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import type { UserGroupService } from '../services/user-group.service.js';
import {
    UserGroupValidationError,
    UserGroupNotFoundError,
    UserGroupConflictError,
    UserGroupSystemProtectedError,
    UserGroupMemberNotFoundError
} from '../services/user-group.errors.js';

/**
 * Controller for admin user-group endpoints.
 *
 * All routes mounted under `/api/admin/users/groups` are protected by the
 * `requireAdmin` middleware applied at the parent router. The controller
 * translates typed service errors (see `user-group.errors.ts`) into HTTP
 * status codes via `instanceof` checks — error messages are not load-bearing
 * for status selection, so service messages can be reworded without
 * breaking the API contract.
 */
export class UserGroupController {
    constructor(
        private readonly groupService: UserGroupService,
        private readonly logger: ISystemLogService
    ) {}

    /** GET /api/admin/users/groups */
    async listGroups(_req: Request, res: Response): Promise<void> {
        try {
            const groups = await this.groupService.listGroups();
            res.json({ groups });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to list user groups');
            res.status(500).json({ error: 'InternalError', message: 'Failed to list groups' });
        }
    }

    /** GET /api/admin/users/groups/:id */
    async getGroup(req: Request, res: Response): Promise<void> {
        try {
            const group = await this.groupService.getGroup(req.params.id);
            if (!group) {
                res.status(404).json({ error: 'NotFound', message: `Group "${req.params.id}" not found` });
                return;
            }
            res.json({ group });
        } catch (error) {
            this.logger.error({ err: error, id: req.params.id }, 'Failed to get user group');
            res.status(500).json({ error: 'InternalError', message: 'Failed to get group' });
        }
    }

    /** POST /api/admin/users/groups */
    async createGroup(req: Request, res: Response): Promise<void> {
        try {
            const { id, name, description } = req.body ?? {};
            const group = await this.groupService.createGroup({ id, name, description });
            res.status(201).json({ group });
        } catch (error) {
            this.respondWithError(res, error, { id: req.params.id }, 'Failed to create group');
        }
    }

    /** PATCH /api/admin/users/groups/:id */
    async updateGroup(req: Request, res: Response): Promise<void> {
        try {
            const { name, description } = req.body ?? {};
            const group = await this.groupService.updateGroup(req.params.id, { name, description });
            res.json({ group });
        } catch (error) {
            this.respondWithError(res, error, { id: req.params.id }, 'Failed to update group');
        }
    }

    /** DELETE /api/admin/users/groups/:id */
    async deleteGroup(req: Request, res: Response): Promise<void> {
        try {
            await this.groupService.deleteGroup(req.params.id);
            res.status(204).end();
        } catch (error) {
            this.respondWithError(res, error, { id: req.params.id }, 'Failed to delete group');
        }
    }

    /**
     * Map typed service errors to HTTP status codes. Unknown errors are
     * logged and surfaced as 500s so callers don't see internal details.
     */
    private respondWithError(
        res: Response,
        error: unknown,
        logContext: Record<string, unknown>,
        fallbackMessage: string
    ): void {
        if (error instanceof UserGroupValidationError) {
            res.status(400).json({ error: 'BadRequest', message: error.message });
            return;
        }
        if (error instanceof UserGroupNotFoundError || error instanceof UserGroupMemberNotFoundError) {
            res.status(404).json({ error: 'NotFound', message: error.message });
            return;
        }
        if (error instanceof UserGroupConflictError) {
            res.status(409).json({ error: 'Conflict', message: error.message });
            return;
        }
        if (error instanceof UserGroupSystemProtectedError) {
            res.status(403).json({ error: 'Forbidden', message: error.message });
            return;
        }
        this.logger.error({ err: error, ...logContext }, fallbackMessage);
        res.status(500).json({ error: 'InternalError', message: fallbackMessage });
    }
}
