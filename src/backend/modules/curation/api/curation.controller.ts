/**
 * @file curation.controller.ts
 *
 * Admin HTTP handlers for the central curation queue: the pending review
 * inbox, what a pending item changes, the decided-item history, inline edits,
 * and the approve/reject decision. Mounted under `/api/admin/system/curation`. The `/system/curation`
 * dashboard renders these; the endpoints are the provider-neutral source of
 * truth for every reviewable content type held across the platform.
 */

import type { Request, Response } from 'express';
import type { CurationDecision, ICurationHistoryListOptions, ICurationItem, ICurationSinkSelection } from '@/types';
import { CURATION_DECISIONS } from '@/types';
import type { CurationService } from '../services/curation-service.js';

/** History items per page when the request names no `limit`; the History tab's page size. */
const HISTORY_DEFAULT_LIMIT = 25;

/** Most history items one request may ask for. */
const HISTORY_MAX_LIMIT = 100;

/** Longest `typeId` the history filter accepts; registered type ids are far shorter. */
const HISTORY_TYPE_ID_MAX_LENGTH = 200;

/** A whole number written in plain digits, the only form `limit` and `skip` accept. */
const WHOLE_NUMBER = /^\d+$/;

/** The validated history request, or the reason it was refused. */
type HistoryQueryResult = { options: ICurationHistoryListOptions } | { error: string };

/**
 * Read one paging number from the query string. Absent means the default; any
 * other form than plain digits in range is refused rather than guessed at, so
 * a caller learns its request was wrong instead of silently getting another page.
 *
 * @param raw - The query value, which Express gives as an array when repeated.
 * @param fallback - The value an absent parameter takes.
 * @param min - The smallest value allowed.
 * @param max - The largest value allowed.
 * @returns The number, or null when the value is malformed or out of range.
 */
function parseWholeNumber(raw: unknown, fallback: number, min: number, max: number): number | null {
    let value: number | null = null;
    if (raw === undefined) {
        value = fallback;
    } else if (typeof raw === 'string' && WHOLE_NUMBER.test(raw)) {
        const parsed = Number(raw);
        value = parsed >= min && parsed <= max ? parsed : null;
    }
    return value;
}

/**
 * Validate the history query string: `limit` (1–100, default 25), `skip`
 * (zero or more, default 0), `decision` (one of {@link CURATION_DECISIONS}),
 * and `typeId` (an exact content type id, at most 200 characters). A blank
 * `decision` or `typeId` means no filter, which is what an "All" option sends.
 *
 * @param query - The request's parsed query string.
 * @returns The list options, or the message a 400 answer carries.
 */
function parseHistoryQuery(query: Request['query']): HistoryQueryResult {
    const limit = parseWholeNumber(query.limit, HISTORY_DEFAULT_LIMIT, 1, HISTORY_MAX_LIMIT);
    const skip = parseWholeNumber(query.skip, 0, 0, Number.MAX_SAFE_INTEGER);
    const decision = query.decision ?? '';
    const typeId = query.typeId ?? '';
    let result: HistoryQueryResult;
    if (limit === null) {
        result = { error: `limit must be a whole number from 1 to ${HISTORY_MAX_LIMIT}.` };
    } else if (skip === null) {
        result = { error: 'skip must be a whole number of zero or more.' };
    } else if (typeof decision !== 'string' || (decision !== '' && !CURATION_DECISIONS.includes(decision as CurationDecision))) {
        result = { error: `decision must be one of ${CURATION_DECISIONS.join(', ')}.` };
    } else if (typeof typeId !== 'string' || typeId.length > HISTORY_TYPE_ID_MAX_LENGTH) {
        result = { error: `typeId must be a single content type id of at most ${HISTORY_TYPE_ID_MAX_LENGTH} characters.` };
    } else {
        result = {
            options: {
                limit,
                skip,
                ...(decision ? { decision: decision as CurationDecision } : {}),
                ...(typeId ? { typeId } : {})
            }
        };
    }
    return result;
}

/**
 * Serialize a curation envelope for the admin dashboard: dates to ISO strings,
 * and only the fields the queue UI needs (including `ref`, which the type's
 * editor uses to address its own record). Drops the Mongo `_id`.
 *
 * @param item - The stored envelope.
 * @param ownerAvailable - Whether the item's owning type is registered. Sent
 *        only for pending items, so the dashboard can offer Dismiss instead of
 *        Approve and Reject when the owner is gone. Omit for decided items.
 * @returns A JSON-safe view of the item.
 */
function serializeCurationItem(item: ICurationItem, ownerAvailable?: boolean): Record<string, unknown> {
    return {
        id: item.id,
        typeId: item.typeId,
        providerId: item.providerId,
        ref: item.ref,
        preview: item.preview,
        changes: item.changes,
        status: item.status,
        source: item.source,
        createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
        decidedAt: item.decidedAt instanceof Date ? item.decidedAt.toISOString() : item.decidedAt,
        decidedBy: item.decidedBy,
        dismissReason: item.dismissReason,
        sinks: item.sinks,
        ownerAvailable
    };
}

/**
 * Parse and validate the optional `sinks` array on an approve request body.
 * Returns the typed selection when well-formed, `undefined` when the field is
 * absent (a classic approval), or `null` when present but malformed — which the
 * caller turns into a 400. Validates shape only; the service and controller
 * check eligibility against the live router.
 *
 * @param body - The request body.
 * @returns The selection, `undefined` when absent, or `null` when malformed.
 */
function parseSinks(body: unknown): ICurationSinkSelection[] | undefined | null {
    const raw = (body as { sinks?: unknown })?.sinks;
    if (raw === undefined) {
        return undefined;
    }
    if (!Array.isArray(raw)) {
        return null;
    }
    const result: ICurationSinkSelection[] = [];
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
        res.json({
            curations: items.map((item) => serializeCurationItem(item, this.curation.hasType(item.typeId)))
        });
    };

    /** GET /curations/count — pending curation count for the nav badge. */
    getCurationsCount = async (_req: Request, res: Response): Promise<void> => {
        res.json({ count: await this.curation.countPending() });
    };

    /**
     * GET /curations/history — one page of closed items (approved, rejected, or
     * dismissed), most recent decision first. Query: `limit` (1–100, default
     * 25), `skip` (default 0), `decision`, and `typeId`; see
     * {@link parseHistoryQuery}. Answers `{ curations, total, types }`, where
     * `total` counts the items the filters match across every page and `types`
     * lists every decided content type for the type filter, or 400 with
     * `{ error }` for a malformed or out-of-range parameter.
     *
     * @param req - Carries the paging and filter parameters.
     * @param res - Receives the page or the 400.
     */
    listCurationHistory = async (req: Request, res: Response): Promise<void> => {
        const parsed = parseHistoryQuery(req.query);
        if ('error' in parsed) {
            res.status(400).json({ error: parsed.error });
        } else {
            const page = await this.curation.listHistory(parsed.options);
            res.json({
                curations: page.items.map((item) => serializeCurationItem(item)),
                total: page.total,
                types: page.types
            });
        }
    };

    /**
     * GET /curations/:id/changes — what a pending item changes compared with
     * the live version. Answers `{ changes: null }` for a type that cannot
     * compare, so the dashboard shows the content alone, and 404 when the item
     * does not exist.
     */
    getChanges = async (req: Request, res: Response): Promise<void> => {
        const id = req.params.id;
        const item = await this.curation.get(id);
        if (!item) {
            res.status(404).json({ error: 'No curation item matched that id.' });
            return;
        }
        res.json({ changes: await this.curation.getChanges(id) });
    };

    /** GET /curations/:id/sinks — the eligible publish sinks for a pending item. */
    listSinks = async (req: Request, res: Response): Promise<void> => {
        const sinks = await this.curation.listEligibleSinks(req.params.id);
        res.json({ sinks });
    };

    /**
     * POST /curations/:id/sinks/defaults — set the standing default sinks for the
     * item's content type, the subset the picker pre-checks.
     */
    setSinkDefaults = async (req: Request, res: Response): Promise<void> => {
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
        await this.curation.setSinkDefaults(item.typeId, sinkIds);
        res.json({ success: true, typeId: item.typeId, sinkIds });
    };

    /** POST /curations/:id/approve — approve a held item, fan to selected sinks, commit via its type. */
    approveCuration = async (req: Request, res: Response): Promise<void> => {
        const sinks = parseSinks(req.body);
        if (sinks === null) {
            res.status(400).json({ error: 'sinks must be an array of { sinkId: string, dest?: object }.' });
            return;
        }
        await this.decideCuration(req, res, 'approve', sinks);
    };

    /** POST /curations/:id/reject — reject a held item and discard it via its type. */
    rejectCuration = async (req: Request, res: Response): Promise<void> => {
        await this.decideCuration(req, res, 'reject');
    };

    /**
     * POST /curations/:id/dismiss — close a pending item whose owning provider
     * is not registered. Approve and reject return 409 for such an item, so
     * without this route it would stay in the queue forever. Returns 404 when
     * the item is not pending, and 409 when the owner is registered, because an
     * item with a live owner must be approved or rejected so the owner can act.
     */
    dismissCuration = async (req: Request, res: Response): Promise<void> => {
        const id = req.params.id;
        const item = await this.curation.get(id);
        if (!item || item.status !== 'pending') {
            res.status(404).json({ error: 'No pending curation item matched that id.' });
            return;
        }
        if (this.curation.hasType(item.typeId)) {
            res.status(409).json({ error: 'The owning provider is available; approve or reject this item instead.' });
            return;
        }
        const reason = `Owning provider '${item.providerId}' is not registered`;
        const result = await this.curation.dismiss(id, actorId(req), reason);
        if (!result) {
            res.status(409).json({ error: 'Curation item could not be dismissed; it may have just been resolved.' });
            return;
        }
        res.json(serializeCurationItem(result));
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
        // Body-editability is signalled by the descriptor's `editable` flag, not by
        // `applyEdit` presence (now required on every curation type, so a presence
        // check would always pass). `get()` re-derived a live preview above, so this
        // reflects the type's current descriptor.
        if (item.preview?.editable !== true) {
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
     * @param sinks - Curator-selected publish sinks (approval only).
     * @returns Resolves once a response is sent.
     */
    private decideCuration = async (
        req: Request,
        res: Response,
        action: 'approve' | 'reject',
        sinks?: ICurationSinkSelection[]
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
        // Pre-validate the selection against live eligibility so a client error is
        // a clean 400, not the 502 the service's defensive post-decision throw
        // would otherwise surface as. Two client errors: an item with eligible
        // publish sinks approved with no selection (would publish nowhere), and any
        // selected sink that is not eligible — which covers every selection against
        // an item with zero eligible sinks, since none can be valid. Zero eligible
        // sinks with no selection approves to nowhere, the only available outcome.
        if (action === 'approve') {
            const eligible = await this.curation.listEligibleSinks(id);
            if (eligible.length > 0 && (!sinks || sinks.length === 0)) {
                res.status(400).json({ error: 'This item publishes to sinks; select at least one before approving.' });
                return;
            }
            if (sinks && sinks.length > 0) {
                const eligibleIds = new Set(eligible.map((d) => d.sinkId));
                const invalid = sinks.find((d) => !eligibleIds.has(d.sinkId));
                if (invalid) {
                    res.status(400).json({ error: `'${invalid.sinkId}' is not an eligible publish sink for this item.` });
                    return;
                }
            }
        }
        try {
            const result = action === 'approve'
                ? await this.curation.approve(id, actorId(req), sinks)
                : await this.curation.reject(id, actorId(req));
            if (!result) {
                res.status(409).json({ error: 'Curation item could not be decided; it may have just been resolved.' });
                return;
            }
            res.json(serializeCurationItem(result));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // A throw can land on either side of the queue's atomic decision gate.
            // The service's pre-decision guards — an empty selection, or a sink gone
            // ineligible in the race between this handler's eligibility pre-check and
            // the service's decide-time recheck — throw before the item leaves the
            // pending queue, so nothing was recorded: surface that as a correctable
            // 400 carrying the validation message. Only a no-longer-pending item means
            // the decision committed and the provider-side effect (publish/cleanup)
            // failed, the true 502. Re-read to tell them apart, and default to 502 if
            // that read is inconclusive so a not-recorded decision is never reported
            // as recorded.
            let stillPending = false;
            try {
                const current = await this.curation.get(id);
                stillPending = current?.status === 'pending';
            } catch {
                stillPending = false;
            }
            if (stillPending) {
                res.status(400).json({ error: message });
                return;
            }
            res.status(502).json({
                error: `Decision recorded, but the provider could not complete it: ${message}`
            });
        }
    };
}
