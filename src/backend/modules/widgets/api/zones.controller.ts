/**
 * @fileoverview Admin controller for widget-zone introspection.
 *
 * Read-only adapter over `IWidgetsService.listZones()`. The unified
 * widgets service is the single source for snapshot data — the
 * controller never reaches into the underlying registry directly.
 *
 * @module backend/modules/widgets/api/zones.controller
 */

import type { Request, Response } from 'express';
import type { IWidgetsService, ISystemLogService } from '@/types';

/**
 * Admin endpoint controller for widget-zone introspection.
 */
export class ZonesController {
    constructor(
        private readonly widgets: IWidgetsService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Return the current zone snapshot.
     */
    getSnapshot = (_req: Request, res: Response): void => {
        try {
            res.json(this.widgets.listZones());
        } catch (err) {
            this.logger.error({ err }, 'Failed to read zone snapshot');
            res.status(500).json({ success: false, error: 'Failed to read zone snapshot' });
        }
    };
}
