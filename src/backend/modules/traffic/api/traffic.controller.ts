/**
 * Admin controller for ClickHouse `traffic_events` reads and the analytics
 * dashboard at `/system/traffic`.
 *
 * Backs two route groups, both mounted behind `requireAdmin`:
 * - `/api/admin/users/traffic/*` — raw traffic aggregates (bot class, paths,
 *   countries, bot_other UA samples) plus per-user history.
 * - `/api/admin/users/analytics/*` — the dashboard panels re-platformed off the
 *   legacy Mongo `users` aggregations onto `traffic_events` (Phase A of the
 *   Better Auth Phase 6 cutover), plus a BA-derived account/wallet overview and
 *   the Google Search Console integration.
 *
 * The controller is not auth-aware; the parent router applies `requireAdmin`.
 * Account/wallet reads resolve `IAccountDirectoryService` / `IWalletService`
 * from the service registry at request time (the identity module registers
 * them in its `run()`), so the controller never imports identity internals.
 */

import type { Request, Response } from 'express';
import type { IServiceRegistry, IAccountDirectoryService, IWalletService, ISystemLogService } from '@/types';
import type { TrafficService, IConversionFunnelResponse } from '../services/traffic.service.js';
import { resolveAnalyticsRange } from '../services/traffic.service.js';
import type { GscService } from '../services/gsc.service.js';
import { parsePositiveInt, parseNonNegativeInt } from '../../../api/query-params.js';

/** Hard upper bounds on user-supplied query params. Keeps ClickHouse query cost predictable. */
const MAX_SINCE_HOURS = 720; // 30 days
const MAX_LIMIT = 200;
const MAX_HISTORY_LIMIT = 200;
const MAX_GSC_DAYS = 90;
// Max concurrent directory reads when resolving the funnel's active
// accounts. The active set is uncapped (a custom analytics range is not
// window-bounded), so the per-id findOne fan-out is chunked to keep
// concurrent Mongo reads bounded and avoid starving the pool on a large
// window rather than firing the whole set at once.
const ACCOUNT_LOOKUP_BATCH_SIZE = 25;

/**
 * Allow-list for the `botClass` query param on per-bot-class reads. Mirrors
 * the `BotClass` union in `services/bot-classifier.ts` plus the synthetic
 * `'unclassified'` bucket the time-series read folds NULL rows into. The
 * service binds the value as a query parameter, but rejecting unknown values
 * here keeps the API surface self-documenting and 400s typos early.
 */
const KNOWN_BOT_CLASSES = new Set([
    'human',
    'search_engine',
    'ai_crawler',
    'social_unfurler',
    'uptime_probe',
    'scanner',
    'bot_other',
    'unclassified'
]);

/**
 * Parse the optional `bots` query param on the visitor-analytics reads.
 *
 * `bots=exclude` restricts counts to human-classified rows (legacy NULL
 * rows kept); anything else — including the param's absence — keeps the
 * historical include-everything behavior so existing consumers see no
 * change unless they opt in.
 *
 * @param value - Raw `req.query.bots` value.
 * @returns True when bot rows should be excluded.
 */
function parseExcludeBots(value: unknown): boolean {
    return value === 'exclude';
}

/**
 * Controller for the traffic-events and analytics admin surfaces.
 */
export class TrafficController {
    constructor(
        private readonly trafficService: TrafficService,
        private readonly gscService: GscService,
        private readonly serviceRegistry: IServiceRegistry,
        private readonly logger: ISystemLogService
    ) { }

    // ────────────────────────────────────────────────────────────────────────
    // Raw traffic aggregates (/api/admin/users/traffic/*)
    // ────────────────────────────────────────────────────────────────────────

    /**
     * GET /api/admin/users/traffic/summary?sinceHours=24
     * Row counts grouped by `bot_class` plus the total.
     */
    async getSummary(req: Request, res: Response): Promise<void> {
        const sinceHours = parsePositiveInt(req.query.sinceHours, 24, MAX_SINCE_HOURS);
        try {
            const buckets = await this.trafficService.getBotClassBreakdown({ sinceHours, limit: MAX_LIMIT });
            const total = buckets.reduce((sum, b) => sum + b.count, 0);
            res.json({ sinceHours, total, buckets, clickhouseEnabled: this.trafficService.isEnabled() });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch traffic summary');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch summary' });
        }
    }

    /**
     * GET /api/admin/users/traffic/top-paths?sinceHours=24&limit=20
     * Most-hit landing paths over the lookback window.
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
     * Most-active countries (ISO-3166 alpha-2) over the lookback window.
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
     * Most-frequent UAs in the `bot_other` bucket (classifier-gap feedback).
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
     * GET /api/admin/users/traffic/bot-trend?sinceHours=168
     * Daily row counts per `bot_class` — the crawler-trend chart. Defaults to
     * a 7-day window because a single day rarely shows a trend.
     */
    async getBotTrend(req: Request, res: Response): Promise<void> {
        const sinceHours = parsePositiveInt(req.query.sinceHours, 168, MAX_SINCE_HOURS);
        try {
            const points = await this.trafficService.getBotClassTimeSeries({ sinceHours });
            res.json({ sinceHours, points, clickhouseEnabled: this.trafficService.isEnabled() });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch bot trend');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch bot trend' });
        }
    }

    /**
     * GET /api/admin/users/traffic/bot-paths?botClass=ai_crawler&sinceHours=168&limit=20
     * Top paths hit by one bot class — "which pages do AI crawlers fetch".
     */
    async getBotPaths(req: Request, res: Response): Promise<void> {
        const botClass = typeof req.query.botClass === 'string' ? req.query.botClass : '';
        if (!KNOWN_BOT_CLASSES.has(botClass)) {
            res.status(400).json({
                error: 'ValidationError',
                message: `botClass must be one of: ${Array.from(KNOWN_BOT_CLASSES).join(', ')}`
            });
            return;
        }

        const sinceHours = parsePositiveInt(req.query.sinceHours, 168, MAX_SINCE_HOURS);
        const limit = parsePositiveInt(req.query.limit, 20, MAX_LIMIT);
        try {
            const buckets = await this.trafficService.getPathsByBotClass(botClass, { sinceHours, limit });
            res.json({ botClass, sinceHours, limit, buckets, clickhouseEnabled: this.trafficService.isEnabled() });
        } catch (error) {
            this.logger.error({ err: error, botClass }, 'Failed to fetch per-bot-class paths');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch per-bot-class paths' });
        }
    }

    /**
     * GET /api/admin/users/:id/traffic-history?limit=50
     * The candidate UUID's traffic events oldest-first. Does not require a
     * matching Mongo `users` row.
     */
    async getUserHistory(req: Request, res: Response): Promise<void> {
        const userId = req.params.id;
        const limit = parsePositiveInt(req.query.limit, 50, MAX_HISTORY_LIMIT);
        try {
            const events = await this.trafficService.getEventsForUser(userId, { limit });
            res.json({ userId, limit, events, clickhouseEnabled: this.trafficService.isEnabled() });
        } catch (error) {
            this.logger.error({ err: error, userId }, 'Failed to fetch user traffic history');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch traffic history' });
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Analytics dashboard (/api/admin/users/analytics/*)
    // ────────────────────────────────────────────────────────────────────────

    /**
     * GET /api/admin/users/analytics/overview-trend?period=&bots=exclude
     * Unified dashboard headline: current/previous-window KPIs plus the
     * zero-filled visitors/pageviews series (hourly ≤ 48h, daily otherwise).
     */
    async getOverviewTrend(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const excludeBots = parseExcludeBots(req.query.bots);
        try {
            res.json(await this.trafficService.getOverviewTrend(range, excludeBots));
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch overview trend');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch overview trend' });
        }
    }

    /**
     * GET /api/admin/users/analytics/live?bots=exclude
     * Distinct visitors active in the last five minutes.
     */
    async getLiveVisitors(req: Request, res: Response): Promise<void> {
        const excludeBots = parseExcludeBots(req.query.bots);
        try {
            const visitors = await this.trafficService.getLiveVisitorCount(excludeBots);
            res.json({ visitors, windowMinutes: 5, clickhouseEnabled: this.trafficService.isEnabled() });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch live visitors');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch live visitors' });
        }
    }

    /**
     * GET /api/admin/users/analytics/daily-visitors?bots=exclude
     * Distinct analytics visitors (tids) per day.
     */
    async getDailyVisitors(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const excludeBots = parseExcludeBots(req.query.bots);
        try {
            res.json({ data: await this.trafficService.getDailyVisitors(range, excludeBots) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch daily visitors');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch daily visitors' });
        }
    }

    /**
     * GET /api/admin/users/analytics/visitor-origins?limit=&skip=
     * First-touch attribution per tid.
     */
    async getVisitorOrigins(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const limit = parsePositiveInt(req.query.limit, 50, MAX_LIMIT);
        const skip = parseNonNegativeInt(req.query.skip, 0);
        try {
            res.json({ data: await this.trafficService.getVisitorOrigins(range, limit, skip) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch visitor origins');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch visitor origins' });
        }
    }

    /**
     * GET /api/admin/users/analytics/traffic-sources?bots=exclude
     * Referrer-domain breakdown.
     */
    async getTrafficSources(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const excludeBots = parseExcludeBots(req.query.bots);
        try {
            res.json({ data: await this.trafficService.getTrafficSources(range, excludeBots) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch traffic sources');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch traffic sources' });
        }
    }

    /**
     * GET /api/admin/users/analytics/new-users?period=&limit=&skip=&bots=exclude
     * Visitors whose global first-seen falls within the window, newest first.
     * Returns `{ visitors, total }` unwrapped — the client types this as
     * `{ visitors: IVisitorOrigin[]; total }` and reads it directly.
     */
    async getNewUsers(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const limit = parsePositiveInt(req.query.limit, 50, MAX_LIMIT);
        const skip = parseNonNegativeInt(req.query.skip, 0);
        const excludeBots = parseExcludeBots(req.query.bots);
        try {
            res.json(await this.trafficService.getNewVisitors(range, limit, skip, excludeBots));
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch new users');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch new users' });
        }
    }

    /**
     * GET /api/admin/users/analytics/tid-activity?period=&limit=&skip=
     * Per-tid `page`-event clickstream summary for anonymous visitors. Returns
     * `{ rows, total }` unwrapped — the client reads it directly.
     */
    async getTidActivity(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const limit = parsePositiveInt(req.query.limit, 50, MAX_LIMIT);
        const skip = parseNonNegativeInt(req.query.skip, 0);
        try {
            res.json(await this.trafficService.getPageActivity('tid', range, limit, skip));
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch tid activity');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch tid activity' });
        }
    }

    /**
     * GET /api/admin/users/analytics/user-activity?period=&limit=&skip=
     * Per-account `page`-event clickstream summary for registered visitors.
     * Returns `{ rows, total }` unwrapped — the client reads it directly.
     */
    async getUserActivity(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const limit = parsePositiveInt(req.query.limit, 50, MAX_LIMIT);
        const skip = parseNonNegativeInt(req.query.skip, 0);
        try {
            res.json(await this.trafficService.getPageActivity('user', range, limit, skip));
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch user activity');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch user activity' });
        }
    }

    /**
     * GET /api/admin/users/analytics/page-hits?subject=tid|user&id=&period=&limit=
     * The ordered page-hit clickstream for one subject — every page the tid or
     * account hit in the window, newest first.
     */
    async getPageHits(req: Request, res: Response): Promise<void> {
        const rawSubject = req.query.subject;
        const subject = rawSubject === 'user' ? 'user' : rawSubject === 'tid' ? 'tid' : null;
        const id = typeof req.query.id === 'string' ? req.query.id : '';
        if (!subject || !id) {
            res.status(400).json({ error: 'ValidationError', message: "subject ('tid'|'user') and id are required" });
            return;
        }
        const range = resolveAnalyticsRange(req.query);
        const limit = parsePositiveInt(req.query.limit, MAX_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
        try {
            res.json({ data: await this.trafficService.getPageHits(subject, id, range, limit) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch page hits');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch page hits' });
        }
    }

    /**
     * GET /api/admin/users/analytics/traffic-source-details?source=&period=&bots=exclude
     * Drill-down breakdown for one referrer source. Returns the
     * `ITrafficSourceDetails` shape unwrapped — the client reads it directly.
     */
    async getTrafficSourceDetails(req: Request, res: Response): Promise<void> {
        const source = typeof req.query.source === 'string' ? req.query.source : '';
        if (!source) {
            res.status(400).json({ error: 'ValidationError', message: 'source query parameter is required' });
            return;
        }
        const range = resolveAnalyticsRange(req.query);
        const excludeBots = parseExcludeBots(req.query.bots);
        try {
            res.json(await this.trafficService.getTrafficSourceDetails(range, source, excludeBots));
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch traffic source details');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch traffic source details' });
        }
    }

    /**
     * GET /api/admin/users/analytics/top-landing-pages?limit=&bots=exclude
     * Top landing paths by distinct visitors.
     */
    async getTopLandingPages(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const limit = parsePositiveInt(req.query.limit, 20, MAX_LIMIT);
        const excludeBots = parseExcludeBots(req.query.bots);
        try {
            res.json({ data: await this.trafficService.getTopLandingPages(range, limit, excludeBots) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch top landing pages');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch top landing pages' });
        }
    }

    /**
     * GET /api/admin/users/analytics/geo-distribution?limit=&bots=exclude
     * Country distribution (ISO-3166 alpha-2).
     */
    async getGeoDistribution(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const limit = parsePositiveInt(req.query.limit, 30, MAX_LIMIT);
        const excludeBots = parseExcludeBots(req.query.bots);
        try {
            res.json({ data: await this.trafficService.getGeoDistribution(range, limit, excludeBots) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch geo distribution');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch geo distribution' });
        }
    }

    /**
     * GET /api/admin/users/analytics/device-breakdown?bots=exclude
     * Device-category breakdown.
     */
    async getDeviceBreakdown(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const excludeBots = parseExcludeBots(req.query.bots);
        try {
            res.json({ data: await this.trafficService.getDeviceBreakdown(range, excludeBots) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch device breakdown');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch device breakdown' });
        }
    }

    /**
     * GET /api/admin/users/analytics/retention?bots=exclude
     * New-vs-returning visitors per day.
     */
    async getRetention(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const excludeBots = parseExcludeBots(req.query.bots);
        try {
            res.json({ data: await this.trafficService.getRetention(range, excludeBots) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch retention');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch retention' });
        }
    }

    /**
     * GET /api/admin/users/analytics/conversion-funnel?bots=exclude
     * Binary conversion funnel (distinct tids → tids ever logged in), plus
     * the composed acquisition stage (`newAccountVisitors`).
     *
     * The acquisition stage crosses two stores on purpose: ClickHouse knows
     * which accounts appeared logged-in during the window, but only the
     * identity module knows when an account was *created* (Better Auth
     * `createdAt`) — the ground truth a first-login-event proxy cannot
     * match (re-logins after TTL expiry of old rows would re-mint
     * long-standing accounts as "new"). Resolved via the `'accounts'`
     * registry service; when identity is unavailable the stage reads 0
     * rather than failing the funnel.
     */
    async getConversionFunnel(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const excludeBots = parseExcludeBots(req.query.bots);
        try {
            const funnel = await this.trafficService.getBinaryConversionFunnel(range, excludeBots);
            const response: IConversionFunnelResponse = { ...funnel, newAccountVisitors: 0 };
            const accounts = this.serviceRegistry.get<IAccountDirectoryService>('accounts');
            if (accounts && funnel.converted > 0) {
                const activeIds = await this.trafficService.getActiveAccountIds(range, excludeBots);
                const until = range.until ?? new Date();
                // Per-id directory reads, batched to bound concurrency. The
                // active set is the window's logged-in accounts and is uncapped
                // (a custom analytics range is not window-bounded), and the
                // directory exposes no bulk created-between query. Rather than
                // fire one findOne per account all at once — which starves the
                // Mongo pool on a large window — the fan-out is chunked so at
                // most ACCOUNT_LOOKUP_BATCH_SIZE reads are in flight at a time.
                const summaries: Awaited<ReturnType<typeof accounts.getAccount>>[] = [];
                for (let i = 0; i < activeIds.length; i += ACCOUNT_LOOKUP_BATCH_SIZE) {
                    const batch = activeIds.slice(i, i + ACCOUNT_LOOKUP_BATCH_SIZE);
                    summaries.push(...await Promise.all(batch.map(id => accounts.getAccount(id))));
                }
                const newAccountIds = summaries
                    .filter((account): account is NonNullable<typeof account> => account !== null)
                    .filter(account => account.createdAt >= range.since && account.createdAt <= until)
                    .map(account => account.id);
                response.newAccountVisitors = await this.trafficService.countTidsForUsers(range, newAccountIds, excludeBots);
            }
            res.json(response);
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch conversion funnel');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch conversion funnel' });
        }
    }

    /**
     * GET /api/admin/users/analytics/campaign-performance?limit=&bots=exclude
     * UTM-campaign aggregates joined to the binary conversion.
     */
    async getCampaignPerformance(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const limit = parsePositiveInt(req.query.limit, 20, MAX_LIMIT);
        const excludeBots = parseExcludeBots(req.query.bots);
        try {
            res.json({ data: await this.trafficService.getCampaignPerformance(range, limit, excludeBots) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch campaign performance');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch campaign performance' });
        }
    }

    /**
     * GET /api/admin/users/analytics/engagement?bots=exclude
     * Average duration, pages/session, bounce rate (session events).
     */
    async getEngagementMetrics(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const excludeBots = parseExcludeBots(req.query.bots);
        try {
            res.json(await this.trafficService.getEngagementMetrics(range, excludeBots));
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch engagement metrics');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch engagement metrics' });
        }
    }

    /**
     * GET /api/admin/users/analytics/overview
     * BA-derived account count and wallet-adoption rate. Resolves the identity
     * services from the registry at request time.
     */
    async getOverview(_req: Request, res: Response): Promise<void> {
        try {
            const accounts = this.serviceRegistry.get<IAccountDirectoryService>('accounts');
            const wallets = this.serviceRegistry.get<IWalletService>('wallets');
            const totalAccounts = accounts ? await accounts.countAccounts() : 0;
            const accountsWithWallets = wallets ? await wallets.countDistinctOwners() : 0;
            res.json({
                totalAccounts,
                accountsWithWallets,
                walletAdoptionRate: totalAccounts > 0 ? accountsWithWallets / totalAccounts : 0,
                clickhouseEnabled: this.trafficService.isEnabled()
            });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch account overview');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch overview' });
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Google Search Console (/api/admin/users/analytics/gsc/*)
    // ────────────────────────────────────────────────────────────────────────

    /**
     * GET /api/admin/users/analytics/gsc/status
     * GSC configuration status.
     */
    async getGscStatus(_req: Request, res: Response): Promise<void> {
        try {
            res.json(await this.gscService.getStatus());
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch GSC status');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch GSC status' });
        }
    }

    /**
     * POST /api/admin/users/analytics/gsc/credentials
     * Save GSC service-account credentials. Body: { serviceAccountJson, siteUrl }.
     */
    async saveGscCredentials(req: Request, res: Response): Promise<void> {
        const { serviceAccountJson, siteUrl } = req.body ?? {};
        if (typeof serviceAccountJson !== 'string' || typeof siteUrl !== 'string') {
            res.status(400).json({ error: 'ValidationError', message: 'serviceAccountJson and siteUrl are required' });
            return;
        }
        try {
            await this.gscService.saveCredentials(serviceAccountJson, siteUrl);
            // Return the fresh status, not a bare { success } — the client types
            // this call as IGscStatus and stores the result directly in panel
            // state. A success-only body would null out configured/siteUrl/
            // lastFetch until a separate refresh.
            res.json(await this.gscService.getStatus());
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to save GSC credentials');
            res.status(500).json({ error: 'InternalError', message: 'Failed to save GSC credentials' });
        }
    }

    /**
     * DELETE /api/admin/users/analytics/gsc/credentials
     * Remove stored GSC credentials.
     */
    async removeGscCredentials(_req: Request, res: Response): Promise<void> {
        try {
            await this.gscService.removeCredentials();
            res.json({ success: true });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to remove GSC credentials');
            res.status(500).json({ error: 'InternalError', message: 'Failed to remove GSC credentials' });
        }
    }

    /**
     * POST /api/admin/users/analytics/gsc/refresh
     * Trigger an on-demand GSC fetch.
     */
    async refreshGscData(_req: Request, res: Response): Promise<void> {
        try {
            res.json(await this.gscService.fetchAndStore());
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to refresh GSC data');
            res.status(500).json({ error: 'InternalError', message: 'Failed to refresh GSC data' });
        }
    }

    /**
     * GET /api/admin/users/analytics/gsc/keywords?periodHours=168&limit=25
     * Aggregated GSC keywords (clicks/impressions/CTR/position) for the
     * window. Pass-through to the daily-fetched keyword cache; returns an
     * empty array until the `gsc:fetch` job has stored data. The response
     * carries `windowStart`/`windowEnd` — the delay-shifted dates actually
     * covered — so the UI can label the period truthfully.
     */
    async getGscKeywords(req: Request, res: Response): Promise<void> {
        const periodHours = parsePositiveInt(req.query.periodHours, 168, MAX_SINCE_HOURS);
        const limit = parsePositiveInt(req.query.limit, 25, MAX_LIMIT);
        try {
            const result = await this.gscService.getKeywordsForPeriod(periodHours, limit);
            res.json({ periodHours, limit, ...result });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch GSC keywords');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch GSC keywords' });
        }
    }

    /**
     * GET /api/admin/users/analytics/gsc/keywords-by-day?days=14&topN=15
     * Daily GSC keyword buckets (clicks/impressions trend with per-day top
     * keywords). Already offset by the GSC ingestion delay in the service.
     */
    async getGscKeywordsByDay(req: Request, res: Response): Promise<void> {
        const days = parsePositiveInt(req.query.days, 14, MAX_GSC_DAYS);
        const topN = parsePositiveInt(req.query.topN, 15, MAX_LIMIT);
        try {
            res.json(await this.gscService.getKeywordsByDay(days, topN));
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch GSC keywords by day');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch GSC keywords by day' });
        }
    }
}
