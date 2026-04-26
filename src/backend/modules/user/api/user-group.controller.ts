import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import type { UserGroupService } from '../services/user-group.service.js';

/**
 * Controller for admin user-group endpoints.
 *
 * All routes mounted under `/api/admin/users/groups` are protected by the
 * `requireAdmin` middleware applied at the parent router. Validation lives
 * in the service; the controller's only job is to translate service errors
 * into HTTP status codes (400 for client validation, 404 for missing rows,
 * 409 for conflicts) and forward unknown errors as 500s.
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
            const message = error instanceof Error ? error.message : 'Failed to create group';
            const status = /already exists/i.test(message) ? 409 : 400;
            res.status(status).json({ error: status === 409 ? 'Conflict' : 'BadRequest', message });
        }
    }

    /** PATCH /api/admin/users/groups/:id */
    async updateGroup(req: Request, res: Response): Promise<void> {
        try {
            const { name, description } = req.body ?? {};
            const group = await this.groupService.updateGroup(req.params.id, { name, description });
            res.json({ group });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update group';
            let status = 400;
            if (/does not exist/i.test(message)) status = 404;
            else if (/system group/i.test(message)) status = 403;
            res.status(status).json({
                error: status === 404 ? 'NotFound' : status === 403 ? 'Forbidden' : 'BadRequest',
                message
            });
        }
    }

    /** DELETE /api/admin/users/groups/:id */
    async deleteGroup(req: Request, res: Response): Promise<void> {
        try {
            await this.groupService.deleteGroup(req.params.id);
            res.status(204).end();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete group';
            let status = 400;
            if (/does not exist/i.test(message)) status = 404;
            else if (/system group/i.test(message)) status = 403;
            res.status(status).json({
                error: status === 404 ? 'NotFound' : status === 403 ? 'Forbidden' : 'BadRequest',
                message
            });
        }
    }
}
