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
import type { IWidgetsService, ISystemLogService, IZoneLayoutConfig } from '@/types';
import { UnknownZoneError } from '../widgets.errors.js';

/** Allowed values per flex field — the body is operator input, never trusted. */
const FLEX_DIRECTIONS = ['row', 'row-reverse', 'column', 'column-reverse'] as const;
const JUSTIFY_CONTENTS = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'] as const;
const ALIGN_ITEMS = ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'] as const;
const FLEX_WRAPS = ['nowrap', 'wrap'] as const;
const GAP_SIZES = ['none', 'sm', 'md', 'lg'] as const;
const LAYOUT_PRESETS = ['row-left', 'row-center', 'row-between', 'row-right', 'row-wrap', 'column', 'custom'] as const;

/**
 * Validate and coerce an operator-supplied layout body into a typed
 * {@link IZoneLayoutConfig}. Returns the config, or an error string the
 * controller surfaces as a 400 — the admin UI sends typed values, but the
 * endpoint must reject anything off-enum since it persists to storage and
 * feeds inline CSS at SSR.
 *
 * @param body - Raw request body.
 * @returns The validated config, or `{ error }` describing the first failure.
 */
function validateLayoutBody(body: unknown): { config?: IZoneLayoutConfig; error?: string } {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return { error: 'Body must be a layout config object.' };
    }
    const b = body as Record<string, unknown>;
    const check = <T extends string>(field: string, allowed: ReadonlyArray<T>): T | null =>
        typeof b[field] === 'string' && (allowed as ReadonlyArray<string>).includes(b[field] as string)
            ? (b[field] as T)
            : null;

    const flexDirection = check('flexDirection', FLEX_DIRECTIONS);
    const justifyContent = check('justifyContent', JUSTIFY_CONTENTS);
    const alignItems = check('alignItems', ALIGN_ITEMS);
    const flexWrap = check('flexWrap', FLEX_WRAPS);
    const gap = check('gap', GAP_SIZES);
    if (!flexDirection) return { error: 'Invalid or missing flexDirection.' };
    if (!justifyContent) return { error: 'Invalid or missing justifyContent.' };
    if (!alignItems) return { error: 'Invalid or missing alignItems.' };
    if (!flexWrap) return { error: 'Invalid or missing flexWrap.' };
    if (!gap) return { error: 'Invalid or missing gap.' };

    const config: IZoneLayoutConfig = { flexDirection, justifyContent, alignItems, flexWrap, gap };
    // preset is optional UI sugar; accept only a known value, else omit.
    if (b.preset !== undefined) {
        const preset = check('preset', LAYOUT_PRESETS);
        if (preset) config.preset = preset;
    }
    return { config };
}

/**
 * Admin endpoint controller for widget-zone introspection and the
 * operator-editable per-zone flexbox layout.
 */
export class ZonesController {
    constructor(
        private readonly widgets: IWidgetsService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Return the current zone snapshot (each zone carries its effective
     * `layoutConfig`).
     */
    getSnapshot = (_req: Request, res: Response): void => {
        try {
            res.json(this.widgets.listZones());
        } catch (err) {
            this.logger.error({ err }, 'Failed to read zone snapshot');
            res.status(500).json({ success: false, error: 'Failed to read zone snapshot' });
        }
    };

    /**
     * Persist an operator's flexbox layout override for a zone. Validates
     * the body against the allowed flex value sets, then writes through
     * the widgets service. 404 when the zone is unknown, 400 on a malformed
     * body.
     */
    setLayout = async (req: Request, res: Response): Promise<void> => {
        const zoneId = req.params.zoneId;
        if (typeof zoneId !== 'string' || zoneId.length === 0) {
            res.status(400).json({ success: false, error: 'A zoneId path parameter is required.' });
            return;
        }
        const { config, error } = validateLayoutBody(req.body);
        if (!config) {
            res.status(400).json({ success: false, error });
            return;
        }
        try {
            const stored = await this.widgets.setZoneLayout(zoneId, config);
            res.json({ success: true, layoutConfig: stored });
        } catch (err) {
            if (err instanceof UnknownZoneError) {
                res.status(404).json({ success: false, error: err.message });
                return;
            }
            this.logger.error({ err, zoneId }, 'Failed to persist zone layout');
            res.status(500).json({ success: false, error: 'Failed to persist zone layout' });
        }
    };
}
