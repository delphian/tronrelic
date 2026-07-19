/**
 * HTTP controller for admin-managed URL redirects.
 *
 * Exposes one public read (`GET /api/redirects`) that the Next.js edge
 * middleware polls to learn the active redirect map, plus the admin CRUD the
 * `/system/traffic` management UI drives. The public read is deliberately
 * unauthenticated: the middleware fetches it server-to-server before any auth
 * context exists, exactly like the public bootstrap ingestion endpoint.
 *
 * Handlers mirror the traffic module's conventions — try/catch every handler,
 * log failures via `this.logger.error({ err }, '...')`, and translate service
 * errors into precise status codes (400 validation, 404 missing, 409 duplicate
 * pattern, 500 unexpected).
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import {
    RedirectService,
    RedirectValidationError,
    RedirectNotFoundError
} from '../services/redirect.service.js';
import {
    TrafficService,
    resolveAnalyticsRange,
    type IAnalyticsRangeQuery,
    type IRedirectHitInput
} from '../services/traffic.service.js';
import { classifyTrafficRequest } from '../services/bot-classifier.js';

/**
 * Seconds any intermediary (CDN) may cache the public redirect feed. Matches
 * the middleware's own refresh cadence, so a freshly-added rule goes live in at
 * most this long regardless of caching layer.
 */
const PUBLIC_FEED_MAX_AGE_SECONDS = 60;

/**
 * Per-field storage cap for the public redirect-hit endpoint. The beacon is
 * unauthenticated, so bound the strings a hand-rolled direct caller could
 * persist into `redirect_events`. Generous — rule patterns and destinations are
 * short root-relative paths.
 */
const MAX_REDIRECT_FIELD_LENGTH = 512;

/**
 * Coalesce a possibly-multivalued Express header to its first string value.
 * `classifyTrafficRequest` and the country read want a single string or
 * undefined, never the `string[]` form Node produces for repeated headers.
 *
 * @param raw - The raw `req.headers[name]` value.
 * @returns The single header value, or undefined when absent.
 */
function headerValue(raw: string | string[] | undefined): string | undefined {
    return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Truncate a request-supplied string to `max` chars, returning `null` for any
 * non-string so callers can treat missing and malformed identically.
 *
 * @param raw - Untrusted candidate value.
 * @param max - Maximum length.
 * @returns The clamped string, or null.
 */
function clampString(raw: unknown, max: number): string | null {
    if (typeof raw !== 'string') {
        return null;
    }
    return raw.slice(0, max);
}

/**
 * Sanitize the beacon's reported request path: require a leading `/`, drop the
 * query string and hash, and cap the length. The path feeds both the stored
 * `path` column and the scanner-probe heuristics in `classifyTrafficRequest`, so
 * a well-formed value matters.
 *
 * @param raw - Raw path string from the beacon body.
 * @returns Sanitized path, or null when invalid.
 */
function sanitizeHitPath(raw: unknown): string | null {
    if (typeof raw !== 'string') {
        return null;
    }
    let path = raw.trim();
    if (!path.startsWith('/')) {
        return null;
    }
    const qIdx = path.indexOf('?');
    if (qIdx !== -1) {
        path = path.slice(0, qIdx);
    }
    const hIdx = path.indexOf('#');
    if (hIdx !== -1) {
        path = path.slice(0, hIdx);
    }
    return path.slice(0, MAX_REDIRECT_FIELD_LENGTH) || null;
}

/**
 * Normalize the Cloudflare edge country header (`CF-IPCountry`) into a storable
 * ISO-3166 alpha-2 code or null. This endpoint is unauthenticated, so a
 * hand-rolled caller can forge arbitrary `CF-IPCountry` values; accepting them
 * unvalidated would let unbounded distinct strings land in the
 * `LowCardinality(String)` `country` column and bloat its dictionary. Accept
 * only a 2-letter uppercase code and drop Cloudflare's non-country sentinels
 * (`XX` unknown, `T1` Tor), matching `normalizeCfCountry` in `traffic.service.ts`.
 *
 * @param raw - The forwarded `cf-ipcountry` header value.
 * @returns The uppercase alpha-2 code, or null for sentinels/malformed input.
 */
function clampCountry(raw: string | undefined): string | null {
    if (typeof raw !== 'string') {
        return null;
    }
    const code = raw.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1') {
        return code;
    }
    return null;
}

/**
 * Routes redirect reads/writes to `RedirectService`.
 */
export class RedirectsController {
    /**
     * @param redirectService - The redirect storage/validation service.
     * @param trafficService - ClickHouse-backed store for redirect-hit ingestion
     *   and windowed analytics reads; the analytics live in `redirect_events`.
     * @param logger - Scoped logger for handler-level failure diagnostics.
     */
    constructor(
        private readonly redirectService: RedirectService,
        private readonly trafficService: TrafficService,
        private readonly logger: ISystemLogService
    ) { }

    /**
     * Public ingestion the edge middleware beacons when it serves a redirect.
     * Unauthenticated (the middleware fires it server-to-server before any auth
     * context), so provenance is proven by matching, not a shared secret: the
     * beaconed `pattern` must name a currently-enabled redirect rule, and the
     * middleware only fires after serving one. Unmatched (forged) patterns are
     * dropped, and `destination`/`permanent` are sourced from the matched rule
     * rather than the caller — so all three `LowCardinality` columns
     * (`pattern`/`destination`/`country`) carry only trusted values, closing
     * both the fabricated-breakdown-row and the dictionary-bloat vectors an
     * arbitrary caller would otherwise open. Fire-and-forget: the write never
     * blocks or throws into the response.
     *
     * @param req - Express request; body carries `{ pattern, path }` (plus the
     *   ignored `destination`/`permanent` the middleware forwards) and client
     *   headers (UA, referer, sec-fetch-site, cf-ipcountry).
     * @param res - Express response carrying `{ success: true }` — the beacon
     *   always 200s (an unknown pattern records nothing but is not an error, so
     *   the endpoint leaks nothing about which patterns are valid).
     */
    async recordHit(req: Request, res: Response): Promise<void> {
        try {
            const body = (req.body ?? {}) as Record<string, unknown>;
            const pattern = clampString(body.pattern, MAX_REDIRECT_FIELD_LENGTH);
            if (!pattern) {
                res.status(400).json({ error: 'ValidationError', message: 'pattern is required' });
                return;
            }

            // Provenance-by-matching: record only hits whose pattern is a live
            // enabled rule (what the middleware actually serves). An unknown
            // pattern is a forged/stale beacon — drop it silently (still 200,
            // since the beacon is fire-and-forget).
            const rule = (await this.redirectService.getActiveRules()).find(r => r.pattern === pattern);
            if (!rule) {
                res.json({ success: true });
                return;
            }

            const path = sanitizeHitPath(body.path) ?? rule.pattern;
            const botClass = classifyTrafficRequest({
                userAgent: headerValue(req.headers['user-agent']),
                path,
                referer: headerValue(req.headers['referer']),
                secFetchSite: headerValue(req.headers['sec-fetch-site'])
            });
            const country = clampCountry(headerValue(req.headers['cf-ipcountry']));

            // destination/permanent come from the matched rule, never the caller.
            const hit: IRedirectHitInput = {
                pattern: rule.pattern,
                path,
                destination: rule.destination,
                permanent: rule.permanent,
                botClass,
                country
            };
            this.trafficService.recordRedirectHit(hit);

            res.json({ success: true });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to record redirect hit');
            res.status(500).json({ error: 'InternalError', message: 'Failed to record redirect hit' });
        }
    }

    /**
     * Admin windowed redirect analytics for the Redirects tab. Accepts the same
     * `period`/`startDate`/`endDate` and `bots=exclude` query vocabulary as the
     * traffic dashboard reads.
     *
     * @param req - Express request; `req.query` carries the window + bot filter.
     * @param res - Express response carrying the `IRedirectAnalytics` payload.
     */
    async getRedirectAnalytics(req: Request, res: Response): Promise<void> {
        try {
            const range = resolveAnalyticsRange(req.query as IAnalyticsRangeQuery, '30d');
            const excludeBots = (req.query as Record<string, unknown>).bots === 'exclude';
            const analytics = await this.trafficService.getRedirectAnalytics(range, excludeBots);
            res.json(analytics);
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to load redirect analytics');
            res.status(500).json({ error: 'InternalError', message: 'Failed to load redirect analytics' });
        }
    }

    /**
     * Public read consumed by the edge middleware. Emits only enabled rules in
     * the minimal four-field shape, with a short cache window so a CDN in front
     * of the origin cannot pin a stale map longer than the middleware would.
     *
     * @param _req - Unused; the feed is identical for every caller.
     * @param res - Express response carrying `{ rules }`.
     */
    async getPublicRedirects(_req: Request, res: Response): Promise<void> {
        try {
            const rules = await this.redirectService.getActiveRules();
            res.set('Cache-Control', `public, max-age=${PUBLIC_FEED_MAX_AGE_SECONDS}`);
            res.json({ rules });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to serve public redirect feed');
            res.status(500).json({ error: 'InternalError', message: 'Failed to load redirects' });
        }
    }

    /**
     * Admin list of every rule (enabled and disabled) for the management table.
     *
     * @param _req - Unused.
     * @param res - Express response carrying `{ rules }` in admin shape.
     */
    async listRedirects(_req: Request, res: Response): Promise<void> {
        try {
            const rules = await this.redirectService.listRules();
            res.json({ rules });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to list redirect rules');
            res.status(500).json({ error: 'InternalError', message: 'Failed to list redirects' });
        }
    }

    /**
     * Create a rule from the admin form. Requires string `pattern` and
     * `destination`; the service applies the deeper same-site/loop validation.
     *
     * @param req - Express request; body carries the rule fields.
     * @param res - Express response carrying the created rule (201).
     */
    async createRedirect(req: Request, res: Response): Promise<void> {
        const { pattern, destination, isPrefix, permanent, enabled, notes } = req.body ?? {};
        if (typeof pattern !== 'string' || typeof destination !== 'string') {
            res.status(400).json({ error: 'ValidationError', message: 'pattern and destination are required strings' });
            return;
        }
        try {
            const rule = await this.redirectService.createRule({ pattern, destination, isPrefix, permanent, enabled, notes });
            res.status(201).json(rule);
        } catch (error) {
            this.respondError(res, error, 'create');
        }
    }

    /**
     * Patch an existing rule. Only supplied fields change; the service
     * re-validates the merged result.
     *
     * @param req - Express request; `params.id` selects the rule, body carries changes.
     * @param res - Express response carrying the updated rule.
     */
    async updateRedirect(req: Request, res: Response): Promise<void> {
        const { id } = req.params;
        const { pattern, destination, isPrefix, permanent, enabled, notes } = req.body ?? {};
        try {
            const rule = await this.redirectService.updateRule(id, { pattern, destination, isPrefix, permanent, enabled, notes });
            res.json(rule);
        } catch (error) {
            this.respondError(res, error, 'update');
        }
    }

    /**
     * Delete a rule.
     *
     * @param req - Express request; `params.id` selects the rule.
     * @param res - Express response (204 on success).
     */
    async deleteRedirect(req: Request, res: Response): Promise<void> {
        const { id } = req.params;
        try {
            await this.redirectService.deleteRule(id);
            res.status(204).end();
        } catch (error) {
            this.respondError(res, error, 'delete');
        }
    }

    /**
     * Translate a thrown service error into the right status code. Validation
     * problems are 400, a missing rule 404, a duplicate `pattern` (Mongo
     * E11000) 409, and anything unexpected 500 with the failure logged.
     *
     * @param res - Express response to write.
     * @param error - The thrown value from the service call.
     * @param action - Verb for the log line (create/update/delete).
     */
    private respondError(res: Response, error: unknown, action: string): void {
        if (error instanceof RedirectValidationError) {
            res.status(400).json({ error: 'ValidationError', message: error.message });
            return;
        }
        if (error instanceof RedirectNotFoundError) {
            res.status(404).json({ error: 'NotFound', message: error.message });
            return;
        }
        if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) {
            res.status(409).json({ error: 'Conflict', message: 'A redirect for this pattern already exists' });
            return;
        }
        this.logger.error({ err: error }, `Failed to ${action} redirect rule`);
        res.status(500).json({ error: 'InternalError', message: `Failed to ${action} redirect` });
    }
}
