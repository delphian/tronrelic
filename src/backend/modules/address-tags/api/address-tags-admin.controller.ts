/**
 * @fileoverview Admin HTTP layer for address tags — the mutating surface plus
 * the management-table search, gated to the admin group.
 *
 * Thin wrapper by design: validates only the envelope (arrays present and
 * well-typed), then delegates to the service, which owns all business logic.
 * The `requireAdmin` gate (admin-group session or `ADMIN_API_TOKEN`) is
 * applied at mount time by the module.
 */

import type { Request, Response } from 'express';
import type { IAddressTagPair, IAddressTagRename, IAddressTagService, ISystemLogService } from '@/types';

/**
 * Controller exposing create, rename, delete, and paged search over tag
 * assignments.
 */
export class AddressTagsAdminController {
    /**
     * @param service - The central tag service all handlers delegate to.
     * @param logger - Module-scoped logger for failure diagnostics.
     */
    constructor(
        private readonly service: IAddressTagService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /tags?search=&limit=&skip= — paged assignment search for the
     * `/system/address-tags` table.
     */
    searchTags = async (req: Request, res: Response): Promise<void> => {
        try {
            const search = typeof req.query.search === 'string' ? req.query.search : undefined;
            const limit = req.query.limit ? Number(req.query.limit) : undefined;
            const skip = req.query.skip ? Number(req.query.skip) : undefined;
            res.json({ tags: await this.service.searchTags({ search, limit, skip }) });
        } catch (error) {
            this.fail(res, error, 'Failed to search address tags');
        }
    };

    /**
     * POST /tags — create assignments. Body: `{ tags: IAddressTagPair[] }`.
     */
    createTags = async (req: Request, res: Response): Promise<void> => {
        try {
            const tags = requirePairArray(req.body?.tags, ['address', 'tag']);
            if (!tags) {
                res.status(400).json({ error: 'Body must be { tags: [{ address, tag }] }' });
                return;
            }
            res.status(201).json({ tags: await this.service.createTags(tags as unknown as IAddressTagPair[]) });
        } catch (error) {
            this.fail(res, error, 'Failed to create address tags');
        }
    };

    /**
     * PATCH /tags — rename assignments. Body: `{ renames: IAddressTagRename[] }`.
     */
    updateTags = async (req: Request, res: Response): Promise<void> => {
        try {
            const renames = requirePairArray(req.body?.renames, ['address', 'oldTag', 'newTag']);
            if (!renames) {
                res.status(400).json({ error: 'Body must be { renames: [{ address, oldTag, newTag }] }' });
                return;
            }
            res.json({ tags: await this.service.updateTags(renames as unknown as IAddressTagRename[]) });
        } catch (error) {
            this.fail(res, error, 'Failed to rename address tags');
        }
    };

    /**
     * POST /tags/delete — delete assignments. Body: `{ tags: IAddressTagPair[] }`.
     * A POST rather than DELETE because the operation carries a body payload.
     */
    deleteTags = async (req: Request, res: Response): Promise<void> => {
        try {
            const tags = requirePairArray(req.body?.tags, ['address', 'tag']);
            if (!tags) {
                res.status(400).json({ error: 'Body must be { tags: [{ address, tag }] }' });
                return;
            }
            res.json({ deleted: await this.service.deleteTags(tags as unknown as IAddressTagPair[]) });
        } catch (error) {
            this.fail(res, error, 'Failed to delete address tags');
        }
    };

    /**
     * Map service validation throws to 400 and everything else to 500.
     *
     * @param res - Response to write the failure to.
     * @param error - The thrown error.
     * @param message - Log line describing which handler failed.
     */
    private fail(res: Response, error: unknown, message: string): void {
        const text = error instanceof Error ? error.message : 'Unknown error';
        if (/^Invalid|^Batch exceeds/.test(text)) {
            res.status(400).json({ error: text });
            return;
        }
        this.logger.error({ error }, message);
        res.status(500).json({ error: message });
    }
}

/**
 * Envelope check for mutation bodies: a non-empty array of objects whose
 * required keys are all strings. Field-level validation stays in the service.
 *
 * @param value - Raw body field.
 * @param keys - Keys each element must carry as strings.
 * @returns The array when structurally valid, otherwise null.
 */
function requirePairArray(value: unknown, keys: string[]): Record<string, string>[] | null {
    if (!Array.isArray(value) || value.length === 0) {
        return null;
    }
    for (const item of value) {
        if (typeof item !== 'object' || item === null) {
            return null;
        }
        for (const key of keys) {
            if (typeof (item as Record<string, unknown>)[key] !== 'string') {
                return null;
            }
        }
    }
    return value as Record<string, string>[];
}
