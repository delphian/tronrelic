import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import type { UserGroupService } from '../services/user-group.service.js';
import { getClientIP } from '../services/geo.service.js';
import {
    UserGroupValidationError,
    UserGroupNotFoundError,
    UserGroupConflictError,
    UserGroupSystemProtectedError,
    UserGroupMemberNotFoundError
} from '../services/user-group.errors.js';

/**
 * Parse a positive integer query param with a default and ceiling. Returns
 * the default for missing or unparseable values; otherwise clamps to
 * `[1, max]`. Used by the members listing endpoint to bound page size.
 */
function parsePositiveInt(raw: unknown, defaultVal: number, max: number): number {
    if (typeof raw !== 'string') return defaultVal;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return defaultVal;
    return Math.min(Math.max(1, n), max);
}

/**
 * Parse a non-negative integer query param. Used for pagination offsets
 * where 0 is valid but negatives must be clamped.
 */
function parseNonNegativeInt(raw: unknown, defaultVal: number): number {
    if (typeof raw !== 'string') return defaultVal;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return defaultVal;
    return Math.max(0, n);
}

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
     * GET /api/admin/users/groups/:id/members
     *
     * Paginated user-id list for a single group. Supports `limit` (default
     * 100, max 500) and `skip` query params. Returns `{ userIds: string[],
     * total: number }`. Excludes merged tombstones at the service layer.
     */
    async listGroupMembers(req: Request, res: Response): Promise<void> {
        try {
            const limit = parsePositiveInt(req.query.limit, 100, 500);
            const skip = parseNonNegativeInt(req.query.skip, 0);
            const result = await this.groupService.getMembers(req.params.id, { limit, skip });
            res.json(result);
        } catch (error) {
            this.respondWithError(res, error, { id: req.params.id }, 'Failed to list group members');
        }
    }

    /**
     * PUT /api/admin/users/:id/groups
     *
     * Replace the user's complete group membership. Audit-logs a single
     * info entry tagged with `req.adminVia` ('user' for cookie+verified+
     * admin-group, 'service-token' for the shared-token path) plus the
     * requester UUID when human-attributed, the requester IP, the target
     * user id, and the before/after arrays. The dual-track auth model
     * means service-token calls remain shared; the path tag is the
     * forensic record that distinguishes them. Service layer is the
     * source of truth: validation (unknown groups, missing user) and
     * cache invalidation happen there.
     */
    async setUserGroups(req: Request, res: Response): Promise<void> {
        const userId = req.params.id;
        try {
            const body = req.body ?? {};
            if (!Array.isArray(body.groups)) {
                res.status(400).json({
                    error: 'BadRequest',
                    message: 'Body must include "groups" as an array of group ids'
                });
                return;
            }

            const before = await this.groupService.getUserGroups(userId);
            const after = await this.groupService.setUserGroups(userId, body.groups);

            this.logger.info(
                {
                    adminVia: req.adminVia ?? 'unknown',
                    requesterUserId: req.adminVia === 'user' ? req.userId : null,
                    ip: getClientIP(req),
                    userId,
                    before,
                    after
                },
                'Admin replaced user group membership'
            );

            res.json({ groups: after });
        } catch (error) {
            this.respondWithError(res, error, { userId }, 'Failed to update user group membership');
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
