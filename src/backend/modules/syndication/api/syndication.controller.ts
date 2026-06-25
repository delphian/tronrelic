/**
 * @file syndication.controller.ts
 *
 * The operator surface for the syndication outbox: read per-status counts,
 * inspect the dead-letter queue, and manually requeue a dead-lettered leg after
 * fixing the cause. This is the minimal "dead-letter operator surface" the
 * content-routing design calls for — durable delivery is only honest if a human
 * can see what permanently failed and act on it. Read endpoints are cache-free
 * (leg state changes every relay tick); the retry endpoint is the one mutation.
 *
 * @module modules/syndication/api/syndication.controller
 */

import type { Request, Response } from 'express';
import type { ISyndicationService } from '@/types';

/**
 * Thin controller binding the syndication service to admin HTTP. Holds no state
 * of its own — every method reads or mutates through the service.
 */
export class SyndicationController {
    /**
     * @param syndication - The durable delivery service backing every endpoint.
     */
    constructor(private readonly syndication: ISyndicationService) {}

    /**
     * Return per-status leg counts for the operator dashboard.
     *
     * @param _req - Unused.
     * @param res - Receives the {@link import('@/types').ISyndicationStats}.
     */
    public getStats = async (_req: Request, res: Response): Promise<void> => {
        const stats = await this.syndication.getStats();
        res.json({ stats });

        return;
    };

    /**
     * List the dead-lettered legs — permanent failures awaiting attention.
     * Accepts an optional `limit` query (clamped) so the view stays bounded.
     *
     * @param req - Express request; reads optional `limit` query.
     * @param res - Receives `{ deadLettered: ISyndicationLegView[] }`.
     */
    public listDeadLettered = async (req: Request, res: Response): Promise<void> => {
        const raw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : NaN;
        const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 500) : 100;
        const deadLettered = await this.syndication.listDeadLettered(limit);
        res.json({ deadLettered });

        return;
    };

    /**
     * Requeue one dead-lettered leg with a fresh retry budget. Returns 404 when
     * the leg is absent or not dead-lettered, so an operator learns a stale id or
     * an already-recovered leg did nothing rather than assuming success.
     *
     * @param req - Express request; reads the `:legId` path param.
     * @param res - Receives `{ requeued: true }` or a 404.
     */
    public retry = async (req: Request, res: Response): Promise<void> => {
        const legId = req.params.legId;
        const requeued = await this.syndication.retry(legId);
        if (!requeued) {
            res.status(404).json({ error: 'No dead-lettered leg with that id' });
            return;
        }
        res.json({ requeued: true });

        return;
    };
}
