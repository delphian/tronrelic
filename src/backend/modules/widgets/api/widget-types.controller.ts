/**
 * @fileoverview Admin controller for widget-type introspection.
 *
 * Read-only adapter over `IWidgetsService.listTypes()`. Plugin code is
 * the source of widget types; the operator-editable surface is the
 * placement records (see `placements.controller.ts`).
 *
 * @module backend/modules/widgets/api/widget-types.controller
 */

import type { Request, Response } from 'express';
import type { IWidgetsService, ISystemLogService } from '@/types';

/**
 * Admin endpoint controller for widget-type introspection.
 */
export class WidgetTypesController {
    constructor(
        private readonly widgets: IWidgetsService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Return the current widget-type snapshot.
     */
    getSnapshot = (_req: Request, res: Response): void => {
        try {
            res.json(this.widgets.listTypes());
        } catch (err) {
            this.logger.error({ err }, 'Failed to read widget-type snapshot');
            res.status(500).json({ success: false, error: 'Failed to read widget-type snapshot' });
        }
    };
}
