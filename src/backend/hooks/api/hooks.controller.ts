/**
 * @fileoverview Controller for the hook-introspection admin endpoint.
 *
 * Exposes a single read-only handler that asks the process-wide hook
 * registry for its snapshot and returns the payload verbatim. The
 * payload shape is defined by `IHookSnapshot` in the types package and
 * is consumed by the `/system/hooks` admin UI to render the bird's-eye
 * lifecycle timeline.
 *
 * @module backend/hooks/api/hooks.controller
 */

import type { Request, Response } from 'express';
import type { IHookRegistry } from '@/types';

/**
 * Read-only controller backing `/api/admin/system/hooks`.
 *
 * The controller is intentionally thin: it carries no caching, no
 * filtering, and no transformation logic. The registry's snapshot is
 * already shaped for the admin UI, and any future filtering belongs in
 * the registry so the JSON contract stays canonical.
 */
export class HooksController {
    /**
     * Construct a controller bound to a hook registry.
     *
     * @param registry - Process-wide hook registry. The controller asks
     *   it for fresh snapshots on every request — there is no caching
     *   because handler tables change at runtime as plugins enable and
     *   disable.
     */
    constructor(private readonly registry: IHookRegistry) {}

    /**
     * Return the current hook-system snapshot.
     *
     * @param _req - Unused.
     * @param res - Express response. Receives the snapshot JSON.
     */
    public getSnapshot = (_req: Request, res: Response): void => {
        const snapshot = this.registry.snapshot();
        res.json(snapshot);

        return;
    };
}
