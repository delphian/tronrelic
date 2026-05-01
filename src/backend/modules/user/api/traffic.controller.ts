/**
 * Admin controller for ClickHouse `traffic_events` reads.
 *
 * Backs the Phase 5 admin UI tracked in PLAN-traffic-events.md. All
 * routes are mounted behind `requireAdmin` at the parent router; the
 * controller itself is not auth-aware.
 *
 * ## Why a Separate Controller
 *
 * `UserController` already exposes a `MongoDB users` analytics surface
 * (`getDailyVisitors`, `getTrafficSources`, etc.). The ClickHouse
 * traffic-events surface is conceptually parallel but reads from a
 * different store with different freshness semantics (append-only,
 * 18-month TTL, no Mongo backfill). Splitting them keeps either side
 * replaceable without surgery on the other.
 *
 * The controller does not import `UserService`. Per-user history takes
 * a UUID from the URL and queries ClickHouse by `candidate_uid`, which
 * is the same UUID — the lookup does not require materializing the
 * Mongo user. Endpoints under `/api/admin/users/:id/traffic-history`
 * therefore work for cookie holders that never advanced past the
 * ephemeral-user state (no Mongo row at all), which is exactly what the
 * Phase 5 dashboard needs to investigate "who is this candidate UUID?"
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import type { TrafficService } from '../services/traffic.service.js';

/** Hard upper bounds on user-supplied query params. Keeps ClickHouse query cost predictable. */
const MAX_SINCE_HOURS = 720; // 30 days
const MAX_LIMIT = 200;
const MAX_HISTORY_LIMIT = 200;

/**
 * Parse a positive integer query param with a default and ceiling. Returns
 * the default for missing or unparseable values; otherwise clamps to
 * `[1, max]`. Mirrors the helper in `user-group.controller.ts`.
 */
function parsePositiveInt(raw: unknown, defaultVal: number, max: number): number {
    if (typeof raw !== 'string') return defaultVal;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return defaultVal;
    return Math.min(Math.max(1, n), max);
}

/**
 * Controller for `/api/admin/users/traffic/*` and the per-user
 * `/api/admin/users/:id/traffic-history` endpoint.
 */
export class TrafficController {
    constructor(
        private readonly trafficService: TrafficService,
        private readonly logger: ISystemLogService
    ) { }

    /**
     * GET /api/admin/users/traffic/summary?sinceHours=24
     *
     * Returns row counts grouped by `bot_class` over the lookback window
     * plus the total count. Drives the dashboard's headline panel.
     */
    async getSummary(req: Request, res: Response): Promise<void> {
        const sinceHours = parsePositiveInt(req.query.sinceHours, 24, MAX_SINCE_HOURS);

        try {
            const buckets = await this.trafficService.getBotClassBreakdown({ sinceHours, limit: MAX_LIMIT });
            const total = buckets.reduce((sum, b) => sum + b.count, 0);
            res.json({
                sinceHours,
                total,
                buckets,
                clickhouseEnabled: this.trafficService.isEnabled()
            });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch traffic summary');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch summary' });
        }
    }

    /**
     * GET /api/admin/users/traffic/top-paths?sinceHours=24&limit=20
     *
     * Returns the most-hit landing paths over the lookback window.
     */
    async getTopPaths(req: Request, res: Response): Promise<void> {
        const sinceHours = parsePositiveInt(req.query.sinceHours, 24, MAX_SINCE_HOURS);
        const limit = parsePositiveInt(req.query.limit, 20, MAX_LIMIT);

        try {
            const buckets = await this.trafficService.getTopPaths({ sinceHours, limit });
            res.json({ sinceHours, limit, buckets });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch top paths');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch top paths' });
        }
    }

    /**
     * GET /api/admin/users/traffic/top-countries?sinceHours=24&limit=20
     *
     * Returns the most-active countries (ISO-3166 alpha-2) over the lookback window.
     */
    async getTopCountries(req: Request, res: Response): Promise<void> {
        const sinceHours = parsePositiveInt(req.query.sinceHours, 24, MAX_SINCE_HOURS);
        const limit = parsePositiveInt(req.query.limit, 20, MAX_LIMIT);

        try {
            const buckets = await this.trafficService.getTopCountries({ sinceHours, limit });
            res.json({ sinceHours, limit, buckets });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch top countries');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch top countries' });
        }
    }

    /**
     * GET /api/admin/users/traffic/bot-other-samples?sinceHours=24&limit=20
     *
     * Returns the most-frequent UAs in the `bot_other` bucket. Each row
     * is a candidate for promotion to an explicit rule in
     * `bot-classifier.ts`. The classifier-gap feedback loop only works
     * if operators see the raw UAs.
     */
    async getBotOtherSamples(req: Request, res: Response): Promise<void> {
        const sinceHours = parsePositiveInt(req.query.sinceHours, 24, MAX_SINCE_HOURS);
        const limit = parsePositiveInt(req.query.limit, 20, MAX_LIMIT);

        try {
            const buckets = await this.trafficService.getBotOtherUserAgents({ sinceHours, limit });
            res.json({ sinceHours, limit, buckets });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch bot_other UA samples');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch UA samples' });
        }
    }

    /**
     * GET /api/admin/users/:id/traffic-history?limit=50
     *
     * Returns the candidate UUID's traffic events oldest-first. Mirrors
     * the shape Phase 3 already uses for first-touch backfill, just with
     * a larger default window. The endpoint does not require a matching
     * Mongo `users` row — pre-`startSession` cookie holders have rows
     * here long before they ever exist in Mongo, and that's the case
     * the dashboard cares about.
     */
    async getUserHistory(req: Request, res: Response): Promise<void> {
        const userId = req.params.id;
        const limit = parsePositiveInt(req.query.limit, 50, MAX_HISTORY_LIMIT);

        // No UUID validation here — the underlying ClickHouse parameter
        // is `UUID` so a malformed value will fail the query gracefully
        // and surface as a 500 with logs. Strict validation would be
        // duplicative since the cookie issuer already only mints UUIDv4.
        try {
            const events = await this.trafficService.getEventsForUser(userId, { limit });
            res.json({
                userId,
                limit,
                events,
                clickhouseEnabled: this.trafficService.isEnabled()
            });
        } catch (error) {
            this.logger.error({ err: error, userId }, 'Failed to fetch user traffic history');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch traffic history' });
        }
    }
}
