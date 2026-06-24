/**
 * @file curation.controller.ts
 *
 * Admin HTTP handlers for the central curation queue: the pending review
 * inbox, the decided-item history, inline edits, and the approve/reject
 * decision. Mounted under `/api/admin/system/curation`. The `/system/curation`
 * dashboard renders these; the endpoints are the provider-neutral source of
 * truth for every reviewable content type held across the platform.
 */

import type { Request, Response } from 'express';
import type { ICurationItem, ICurationDestinationSelection } from '@/types';
import type { CurationService } from '../services/curation-service.js';

/**
 * Serialize a curation envelope for the admin dashboard: dates to ISO strings,
 * and only the fields the queue UI needs (including `ref`, which the type's
 * editor uses to address its own record). Drops the Mongo `_id`.
 *
 * @param item - The stored envelope.
 * @returns A JSON-safe view of the item.
 */
function serializeCurationItem(item: ICurationItem): Record<string, unknown> {
    return {
        id: item.id,
        typeId: item.typeId,
        providerId: item.providerId,
        ref: item.ref,
        preview: item.preview,
        status: item.status,
        source: item.source,
        createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
        decidedAt: item.decidedAt instanceof Date ? item.decidedAt.toISOString() : item.decidedAt,
        decidedBy: item.decidedBy,
        destinations: item.destinations
    };
}

/**
 * Parse and validate the optional `destinations` array on an approve request
 * body. Returns the typed selection when well-formed, `undefined` when the field
 * is absent (a classic approval), or `null` when present but malformed — which
 * the caller turns into a 400. Validates shape only; the service and controller
 * check eligibility against the live router.
 *
 * @param body - The request body.
 * @returns The selection, `undefined` when absent, or `null` when malformed.
 */
function parseDestinations(body: unknown): ICurationDestinationSelection[] | undefined | null {
    const raw = (body as { destinations?: unknown })?.destinations;
    if (raw === undefined) {
        return undefined;
    }
    if (!Array.isArray(raw)) {
        return null;
    }
    const result: ICurationDestinationSelection[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        const sinkId = (entry as { sinkId?: unknown }).sinkId;
        const dest = (entry as { dest?: unknown }).dest;
        if (typeof sinkId !== 'string' || sinkId.length === 0) {
            return null;
        }
        if (dest !== undefined && (dest === null || typeof dest !== 'object' || Array.isArray(dest))) {
            return null;
        }
        result.push({ sinkId, dest: dest as Record<string, unknown> | undefined });
    }
    return result;
}

/**
 * Read the Better Auth admin id `requireAdmin` set on the request, for audit
 * attribution. Undefined when the call authenticated via the service token.
 *
 * @param req - The admin request.
 * @returns The admin user id, or undefined.
 */
function actorId(req: Request): string | undefined {
    return (req as Request & { userId?: string }).userId;
}

/**
 * Handlers for the curation admin API. Methods are bound arrow properties so
 * they can be passed directly to the router.
 */
export class CurationController {
    /**
     * @param curation - The central curation queue backing every endpoint.
     */
    constructor(private readonly curation: CurationService) {}

    /** GET /curations — pending items held across every content type. */
    listCurations = async (_req: Request, res: Response): Promise<void> => {
        const items = await this.curation.listPending();
        res.json({ curations: items.map(serializeCurationItem) });
    };

    /** GET /curations/count — pending curation count for the nav badge. */
    getCurationsCount = async (_req: Request, res: Response): Promise<void> => {
        res.json({ count: await this.curation.countPending() });
    };

    /** GET /curations/history — decided items (approved/rejected), most recent decision first. */
    listCurationHistory = async (_req: Request, res: Response): Promise<void> => {
        const items = await this.curation.listHistory();
        res.json({ curations: items.map(serializeCurationItem) });
    };

    /** GET /curations/:id/destinations — the eligible publish destinations for a pending item. */
    listDestinations = async (req: Request, res: Response): Promise<void> => {
        const destinations = await this.curation.listEligibleDestinations(req.params.id);
        res.json({ destinations });
    };

    /**
     * POST /curations/:id/destinations/defaults — set the standing default
     * destinations for the item's content type, the subset the picker pre-checks.
     */
    setDestinationDefaults = async (req: Request, res: Response): Promise<void> => {
        const id = req.params.id;
        const sinkIds = (req.body as { sinkIds?: unknown })?.sinkIds;
        if (!Array.isArray(sinkIds) || !sinkIds.every((s) => typeof s === 'string')) {
            res.status(400).json({ error: 'Body must include a string[] "sinkIds".' });
            return;
        }
        const item = await this.curation.get(id);
        if (!item) {
            res.status(404).json({ error: 'No curation item matched that id.' });
            return;
        }
        await this.curation.setDestinationDefaults(item.typeId, sinkIds);
        res.json({ success: true, typeId: item.typeId, sinkIds });
    };

    /** POST /curations/:id/approve — approve a held item, fan to selected destinations, commit via its type. */
    approveCuration = async (req: Request, res: Response): Promise<void> => {
        const destinations = parseDestinations(req.body);
        if (destinations === null) {
            res.status(400).json({ error: 'destinations must be an array of { sinkId: string, dest?: object }.' });
            return;
        }
        await this.decideCuration(req, res, 'approve', destinations);
    };

    /** POST /curations/:id/reject — reject a held item and discard it via its type. */
    rejectCuration = async (req: Request, res: Response): Promise<void> => {
        await this.decideCuration(req, res, 'reject');
    };

    /** PATCH /curations/:id — apply an operator's inline edit to a held item. */
    editCuration = async (req: Request, res: Response): Promise<void> => {
        const id = req.params.id;
        const body = (req.body as { body?: unknown })?.body;
        if (typeof body !== 'string') {
            res.status(400).json({ error: 'Body must include a string "body".' });
            return;
        }
        const item = await this.curation.get(id);
        if (!item || item.status !== 'pending') {
            res.status(404).json({ error: 'No pending curation item matched that id.' });
            return;
        }
        if (!this.curation.hasType(item.typeId)) {
            res.status(409).json({ error: 'The owning provider is unavailable; this item cannot be edited until it is re-enabled.' });
            return;
        }
        if (!this.curation.getType(item.typeId)?.applyEdit) {
            res.status(409).json({ error: 'This content type does not support inline editing.' });
            return;
        }
        try {
            // The owning type validates the patch (e.g. tweet length) and may
            // throw; surface that as a 400 the operator can correct from.
            const updated = await this.curation.edit(id, { body }, actorId(req));
            if (!updated) {
                res.status(409).json({ error: 'Curation item could not be edited; it may have just been resolved.' });
                return;
            }
            res.json(serializeCurationItem(updated));
        } catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : 'Edit rejected.' });
        }
    };

    /**
     * Shared approve/reject path. Distinguishes the not-pending case (404) from a
     * blocked decision whose owning provider is disabled (409) so the operator
     * sees why an item cannot be actioned, then delegates to the service.
     *
     * @param req - The admin request (`:id` param, admin actor).
     * @param res - The response.
     * @param action - Which terminal decision to apply.
     * @param destinations - Curator-selected publish destinations (approval only).
     * @returns Resolves once a response is sent.
     */
    private decideCuration = async (
        req: Request,
        res: Response,
        action: 'approve' | 'reject',
        destinations?: ICurationDestinationSelection[]
    ): Promise<void> => {
        const id = req.params.id;
        const item = await this.curation.get(id);
        if (!item || item.status !== 'pending') {
            res.status(404).json({ error: 'No pending curation item matched that id.' });
            return;
        }
        if (!this.curation.hasType(item.typeId)) {
            res.status(409).json({
                error: 'The owning provider is unavailable; this item cannot be decided until it is re-enabled.'
            });
            return;
        }
        // Pre-validate the selection against live eligibility so an ineligible
        // sink is a clean 400 (client error), not the 502 the service's defensive
        // post-decision throw would otherwise surface as.
        if (action === 'approve' && destinations && destinations.length > 0) {
            const eligible = new Set((await this.curation.listEligibleDestinations(id)).map((d) => d.sinkId));
            const invalid = destinations.find((d) => !eligible.has(d.sinkId));
            if (invalid) {
                res.status(400).json({ error: `'${invalid.sinkId}' is not an eligible publish destination for this item.` });
                return;
            }
        }
        try {
            const result = action === 'approve'
                ? await this.curation.approve(id, actorId(req), destinations)
                : await this.curation.reject(id, actorId(req));
            if (!result) {
                res.status(409).json({ error: 'Curation item could not be decided; it may have just been resolved.' });
                return;
            }
            res.json(serializeCurationItem(result));
        } catch (error) {
            // The decision was recorded but the owning type could not complete the
            // effect (publish/cleanup failed). The item has left the pending queue,
            // so surface the failure rather than reporting a false success.
            res.status(502).json({
                error: `Decision recorded, but the provider could not complete it: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    };
}
