/**
 * @fileoverview Admin controller for widget-type introspection.
 *
 * Serves the registry's snapshot to the `/system/widgets` admin
 * placement editor. The snapshot lists every declared widget type
 * grouped by owning plugin — the placement editor renders this as
 * the type palette an operator picks from when creating a new
 * placement.
 *
 * Read-only — widget types are declared in plugin code, not by
 * operators. The placement *records* are the operator-editable
 * surface; see `placements.controller.ts`.
 *
 * @module backend/modules/widgets/api/widget-types.controller
 */

import type { Request, Response } from 'express';
import type { IWidgetTypeRegistry, ISystemLogService } from '@/types';

/**
 * Admin endpoint controller for widget-type introspection.
 */
export class WidgetTypesController {
    /**
     * Construct the controller.
     *
     * @param registry - Shared process-wide widget-type registry.
     * @param logger - Scoped logger.
     */
    constructor(
        private readonly registry: IWidgetTypeRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Return the current widget-type snapshot.
     *
     * Always succeeds — empty registries return an empty `groups`
     * array so the admin UI can render its palette scaffold
     * unconditionally.
     */
    getSnapshot = (_req: Request, res: Response): void => {
        try {
            const snapshot = this.registry.snapshot();
            res.json(snapshot);
        } catch (err) {
            this.logger.error({ err }, 'Failed to read widget-type snapshot');
            res.status(500).json({ success: false, error: 'Failed to read widget-type snapshot' });
        }
    };
}
