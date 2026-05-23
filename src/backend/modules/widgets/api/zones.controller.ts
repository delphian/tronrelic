/**
 * @fileoverview Admin controller for widget-zone introspection.
 *
 * Serves the registry's snapshot to the `/system/widgets` admin
 * placement editor (forthcoming). The snapshot enumerates every
 * declared zone grouped by host, with ownership and registration
 * metadata — the same shape `HooksController` produces for hooks.
 *
 * @module backend/modules/widgets/api/zones.controller
 */

import type { Request, Response } from 'express';
import type { IZoneRegistry, ISystemLogService } from '@/types';

/**
 * Admin endpoint controller. Read-only — placement CRUD lands in PR 2.
 */
export class ZonesController {
    /**
     * Construct the controller.
     *
     * @param registry - Shared process-wide zone registry.
     * @param logger - Scoped logger.
     */
    constructor(
        private readonly registry: IZoneRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Return the current zone snapshot.
     *
     * Always succeeds — empty registries return tracks with empty zone
     * arrays so the admin UI can render its host scaffold unconditionally.
     *
     * @param _req - Express request (unused).
     * @param res - Express response.
     */
    getSnapshot = (_req: Request, res: Response): void => {
        const snapshot = this.registry.snapshot();
        res.json(snapshot);
    };
}
