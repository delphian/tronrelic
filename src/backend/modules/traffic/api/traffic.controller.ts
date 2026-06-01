/**
 * Admin controller for ClickHouse `traffic_events` reads and the analytics
 * dashboard at `/system/users`.
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
import type { TrafficService } from '../services/traffic.service.js';
import { resolveAnalyticsRange } from '../services/traffic.service.js';
import type { GscService } from '../services/gsc.service.js';
import { parsePositiveInt, parseNonNegativeInt } from '../../../api/query-params.js';

/** Hard upper bounds on user-supplied query params. Keeps ClickHouse query cost predictable. */
const MAX_SINCE_HOURS = 720; // 30 days
const MAX_LIMIT = 200;
const MAX_HISTORY_LIMIT = 200;

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
     * GET /api/admin/users/analytics/daily-visitors
     * Distinct analytics visitors (tids) per day.
     */
    async getDailyVisitors(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        try {
            res.json({ data: await this.trafficService.getDailyVisitors(range) });
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
     * GET /api/admin/users/analytics/traffic-sources
     * Referrer-domain breakdown.
     */
    async getTrafficSources(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        try {
            res.json({ data: await this.trafficService.getTrafficSources(range) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch traffic sources');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch traffic sources' });
        }
    }

    /**
     * GET /api/admin/users/analytics/new-users?period=&limit=&skip=
     * Visitors whose global first-seen falls within the window, newest first.
     * Returns `{ visitors, total }` unwrapped — the client types this as
     * `{ visitors: IVisitorOrigin[]; total }` and reads it directly.
     */
    async getNewUsers(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const limit = parsePositiveInt(req.query.limit, 50, MAX_LIMIT);
        const skip = parseNonNegativeInt(req.query.skip, 0);
        try {
            res.json(await this.trafficService.getNewVisitors(range, limit, skip));
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
     * GET /api/admin/users/analytics/traffic-source-details?source=&period=
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
        try {
            res.json(await this.trafficService.getTrafficSourceDetails(range, source));
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch traffic source details');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch traffic source details' });
        }
    }

    /**
     * GET /api/admin/users/analytics/top-landing-pages?limit=
     * Top landing paths by event count.
     */
    async getTopLandingPages(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const limit = parsePositiveInt(req.query.limit, 20, MAX_LIMIT);
        try {
            res.json({ data: await this.trafficService.getTopLandingPages(range, limit) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch top landing pages');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch top landing pages' });
        }
    }

    /**
     * GET /api/admin/users/analytics/geo-distribution?limit=
     * Country distribution (ISO-3166 alpha-2).
     */
    async getGeoDistribution(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const limit = parsePositiveInt(req.query.limit, 30, MAX_LIMIT);
        try {
            res.json({ data: await this.trafficService.getGeoDistribution(range, limit) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch geo distribution');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch geo distribution' });
        }
    }

    /**
     * GET /api/admin/users/analytics/device-breakdown
     * Device-category breakdown.
     */
    async getDeviceBreakdown(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        try {
            res.json({ data: await this.trafficService.getDeviceBreakdown(range) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch device breakdown');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch device breakdown' });
        }
    }

    /**
     * GET /api/admin/users/analytics/retention
     * New-vs-returning visitors per day.
     */
    async getRetention(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        try {
            res.json({ data: await this.trafficService.getRetention(range) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch retention');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch retention' });
        }
    }

    /**
     * GET /api/admin/users/analytics/conversion-funnel
     * Binary conversion funnel (distinct tids → tids ever logged in).
     */
    async getConversionFunnel(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        try {
            res.json(await this.trafficService.getBinaryConversionFunnel(range));
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch conversion funnel');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch conversion funnel' });
        }
    }

    /**
     * GET /api/admin/users/analytics/campaign-performance?limit=
     * UTM-campaign aggregates joined to the binary conversion.
     */
    async getCampaignPerformance(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        const limit = parsePositiveInt(req.query.limit, 20, MAX_LIMIT);
        try {
            res.json({ data: await this.trafficService.getCampaignPerformance(range, limit) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to fetch campaign performance');
            res.status(500).json({ error: 'InternalError', message: 'Failed to fetch campaign performance' });
        }
    }

    /**
     * GET /api/admin/users/analytics/engagement
     * Average duration, pages/session, bounce rate (session events).
     */
    async getEngagementMetrics(req: Request, res: Response): Promise<void> {
        const range = resolveAnalyticsRange(req.query);
        try {
            res.json(await this.trafficService.getEngagementMetrics(range));
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
}
