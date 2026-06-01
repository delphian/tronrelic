/**
 * @fileoverview Edge/client traffic-event ingestion controller.
 *
 * Two public, identity-free entry points that both resolve the unsigned
 * `tronrelic_tid` / `tronrelic_ref` cookies, attribute to the logged-in account
 * via `req.authSession` when present, and emit one `traffic_events` row:
 *
 * - `POST /api/user/bootstrap` — the first-touch `bootstrap` event. The Next.js
 *   middleware calls it server-to-server when an inbound page request carries no
 *   `tronrelic_tid` cookie, so even cookieless bots and unfurlers are captured.
 * - `POST /api/user/track` — a `page` event. Fired by the client-side
 *   route-change beacon on every navigation (hard + soft), so it captures the
 *   full clickstream of cookie-running visitors — anonymous (tid) and registered
 *   (`user_id`) alike. Bots that do not run JS never reach it, so the `page`
 *   stream is naturally interactive-traffic-only.
 *
 * Neither endpoint mints an identity, touches MongoDB, or reads the legacy
 * `users` collection — Better Auth owns identity, and `req.authSession` already
 * carries the logged-in account id when present.
 */

import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { ISystemLogService } from '@/types';
import { TrafficService, buildTrafficEvent, type TrafficEventType } from '../services/traffic.service.js';
import {
    UUID_V4_REGEX,
    resolveTid,
    setTidCookie,
    resolveRef,
    setRefCookie,
    normalizeReferralCode
} from './traffic-cookies.js';

/** Maximum stored length for an `originalReferrer` URL. */
const MAX_REFERRER_LENGTH = 500;

/** Maximum stored length for a sanitized landing path. */
const MAX_PATH_LENGTH = 500;

/**
 * Per-field length caps for UTM dimensions written to `traffic_events`.
 * Bound row size on a publicly-callable endpoint that bypasses the 1 KB
 * middleware body cap when hit directly.
 */
const UTM_FIELD_LIMITS: Record<'source' | 'medium' | 'campaign' | 'term' | 'content', number> = {
    source: 200,
    medium: 200,
    campaign: 500,
    term: 200,
    content: 200
};

/**
 * Truncate a request-supplied string to `max` chars, returning `null` when the
 * input is not a string.
 *
 * @param raw - Untrusted candidate value.
 * @param max - Maximum length.
 * @returns The clamped string, or `null`.
 */
function clampString(raw: unknown, max: number): string | null {
    if (typeof raw !== 'string') {
        return null;
    }
    return raw.slice(0, max);
}

/**
 * Apply per-field UTM truncation. Returns `null` when the input isn't an object
 * so callers preserve the "no UTM" semantics `buildTrafficEvent` collapses into
 * all-null columns.
 *
 * @param raw - Untrusted UTM object.
 * @returns The clamped UTM fields, or `null`.
 */
function clampUtm(raw: unknown): {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    term: string | null;
    content: string | null;
} | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const r = raw as Record<string, unknown>;
    return {
        source: clampString(r.source, UTM_FIELD_LIMITS.source),
        medium: clampString(r.medium, UTM_FIELD_LIMITS.medium),
        campaign: clampString(r.campaign, UTM_FIELD_LIMITS.campaign),
        term: clampString(r.term, UTM_FIELD_LIMITS.term),
        content: clampString(r.content, UTM_FIELD_LIMITS.content)
    };
}

/**
 * Sanitize a URL path for storage: require a leading `/`, strip query string
 * and hash, and truncate.
 *
 * @param raw - Raw path string from the request body.
 * @returns Sanitized path, or `undefined` if invalid.
 */
function sanitizePath(raw: unknown): string | undefined {
    if (typeof raw !== 'string') {
        return undefined;
    }
    let path = raw.trim();
    if (!path.startsWith('/')) {
        return undefined;
    }
    const qIdx = path.indexOf('?');
    if (qIdx !== -1) {
        path = path.slice(0, qIdx);
    }
    const hIdx = path.indexOf('#');
    if (hIdx !== -1) {
        path = path.slice(0, hIdx);
    }
    return path.slice(0, MAX_PATH_LENGTH) || undefined;
}

/**
 * Controller for the slim analytics bootstrap endpoint.
 */
export class BootstrapController {
    /**
     * @param trafficService - Sink for the emitted `traffic_events` row.
     * @param logger - Traffic-module child logger.
     */
    constructor(
        private readonly trafficService: TrafficService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * POST /api/user/bootstrap
     *
     * Record the first-touch `bootstrap` event. See {@link record}.
     *
     * @param req - Express request (cookie-parser populated; may carry a
     *   middleware-forwarded body and `?ref=`).
     * @param res - Express response.
     * @returns Resolves once the response has been written.
     */
    async bootstrap(req: Request, res: Response): Promise<void> {
        return this.record('bootstrap', req, res);
    }

    /**
     * POST /api/user/track
     *
     * Record a `page` event for the client-side route-change beacon. Same
     * resolution path as {@link bootstrap} — the only difference is the event
     * type, so the full clickstream and the first-touch row share one shape and
     * one attribution rule.
     *
     * @param req - Express request carrying the beaconed `landingPath` body.
     * @param res - Express response.
     * @returns Resolves once the response has been written.
     */
    async page(req: Request, res: Response): Promise<void> {
        return this.record('page', req, res);
    }

    /**
     * Resolve/mint the traffic id and first-touch referral code, emit one
     * ClickHouse event of `eventType` keyed on the tid (attributed to the Better
     * Auth account when logged in), and return `{ success: true }`. No identity
     * mint, no MongoDB.
     *
     * @param eventType - `'bootstrap'` (first touch) or `'page'` (navigation).
     * @param req - Express request.
     * @param res - Express response.
     * @returns Resolves once the response has been written.
     */
    private async record(eventType: TrafficEventType, req: Request, res: Response): Promise<void> {
        try {
            const { tid, referralCode } = this.resolveTrafficCookies(req, res);

            // Fire-and-forget — never blocks the response, never throws into the
            // request path. No-ops silently when ClickHouse is unconfigured.
            this.trafficService.recordEvent(
                buildTrafficEvent(eventType, tid, req, {
                    ...this.extractEventInputs(req),
                    userId: req.authSession?.user?.id ?? null,
                    referralCode
                })
            );

            res.json({ success: true });
        } catch (error) {
            this.logger.error({ error, eventType }, 'Failed to record analytics traffic event');
            res.status(500).json({
                error: 'Failed to record',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        return;
    }

    /**
     * Pull `landingPath`, `utm`, and `originalReferrer` from the request body
     * and apply storage caps so a hand-rolled direct caller cannot inflate the
     * ClickHouse row. Shared by the bootstrap and page-event paths.
     *
     * @param req - Express request carrying the (optionally middleware-forwarded) body.
     * @returns The capped, sanitized event-builder inputs.
     */
    private extractEventInputs(req: Request): {
        landingPath?: string;
        utm?: NonNullable<ReturnType<typeof clampUtm>>;
        originalReferrer?: string | null;
    } {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result: {
            landingPath?: string;
            utm?: NonNullable<ReturnType<typeof clampUtm>>;
            originalReferrer?: string | null;
        } = {};

        const landingPath = sanitizePath(body.landingPath);
        if (landingPath) {
            result.landingPath = landingPath;
        }
        const originalReferrer = clampString(body.originalReferrer, MAX_REFERRER_LENGTH);
        if (originalReferrer !== null) {
            result.originalReferrer = originalReferrer;
        }
        const utm = clampUtm(body.utm);
        if (utm) {
            result.utm = utm;
        }
        return result;
    }

    /**
     * Resolve the analytics traffic id (`tronrelic_tid`) and first-touch
     * referral code (`tronrelic_ref`), minting and persisting cookies as needed.
     *
     * **tid.** Prefer a forwarded body value (the Next.js middleware mints it on
     * the SSR-first path), then the existing cookie, else mint a fresh UUID.
     * Re-issue the cookie only when the value did not already arrive as a valid
     * cookie.
     *
     * **ref.** First-touch wins: capture an inbound `?ref=` / body `ref` only
     * when no referral cookie is set yet; an existing cookie is never overwritten.
     *
     * @param req - Express request.
     * @param res - Express response the cookies are written to.
     * @returns The resolved `tid` and `referralCode` (or `null`).
     */
    private resolveTrafficCookies(req: Request, res: Response): { tid: string; referralCode: string | null } {
        const body = (req.body ?? {}) as Record<string, unknown>;

        const cookieTid = resolveTid(req);
        const bodyTid = typeof body.tid === 'string' && UUID_V4_REGEX.test(body.tid) ? body.tid : null;
        const tid = bodyTid ?? cookieTid ?? randomUUID();
        if (tid !== cookieTid) {
            setTidCookie(res, tid);
        }

        const existingRef = resolveRef(req);
        const inboundRef =
            normalizeReferralCode(body.ref) ??
            normalizeReferralCode((req.query as Record<string, unknown> | undefined)?.ref);
        let referralCode = existingRef;
        if (!existingRef && inboundRef) {
            referralCode = inboundRef;
            setRefCookie(res, inboundRef);
        }

        return { tid, referralCode };
    }
}
