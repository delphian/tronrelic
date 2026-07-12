import { Router } from 'express';
import type { TrafficController } from './traffic.controller.js';

/**
 * Create Express router for admin traffic-events endpoints.
 *
 * Mounted at `/api/admin/users/traffic` with `requireAdmin` applied at
 * the parent. Mounted BEFORE `/api/admin/users` so the more-specific
 * prefix wins over the `:id` catch — same pattern as
 * `createAdminUserGroupRouter`.
 *
 * The per-user history endpoint lives on the user router under
 * `/api/admin/users/:id/traffic-history`; it shares the controller
 * because the data source is the same and the UUID is a pure URL
 * parameter, not a body shape.
 */
export function createAdminTrafficRouter(controller: TrafficController): Router {
    const router = Router();

    router.get('/summary', controller.getSummary.bind(controller));
    router.get('/top-paths', controller.getTopPaths.bind(controller));
    router.get('/top-countries', controller.getTopCountries.bind(controller));
    router.get('/bot-other-samples', controller.getBotOtherSamples.bind(controller));
    router.get('/bot-trend', controller.getBotTrend.bind(controller));
    router.get('/bot-paths', controller.getBotPaths.bind(controller));

    return router;
}

/**
 * Create the admin analytics dashboard router.
 *
 * Mounted at `/api/admin/users/analytics` with `requireAdmin` at the parent,
 * ahead of the legacy `/api/admin/users` router so its paths win. Backs the
 * `/system/traffic` dashboard panels re-platformed onto `traffic_events`, the
 * BA-derived account/wallet overview, and the GSC integration.
 *
 * @param controller - The traffic controller.
 * @returns Configured analytics router.
 */
export function createAdminAnalyticsRouter(controller: TrafficController): Router {
    const router = Router();

    router.get('/overview-trend', controller.getOverviewTrend.bind(controller));
    router.get('/live', controller.getLiveVisitors.bind(controller));
    router.get('/daily-visitors', controller.getDailyVisitors.bind(controller));
    router.get('/new-users', controller.getNewUsers.bind(controller));
    router.get('/flagged-subnets', controller.getFlaggedSubnets.bind(controller));
    router.get('/tid-activity', controller.getTidActivity.bind(controller));
    router.get('/user-activity', controller.getUserActivity.bind(controller));
    router.get('/page-hits', controller.getPageHits.bind(controller));
    router.get('/traffic-sources', controller.getTrafficSources.bind(controller));
    router.get('/traffic-source-details', controller.getTrafficSourceDetails.bind(controller));
    router.get('/top-landing-pages', controller.getTopLandingPages.bind(controller));
    router.get('/geo-distribution', controller.getGeoDistribution.bind(controller));
    router.get('/device-breakdown', controller.getDeviceBreakdown.bind(controller));
    router.get('/retention', controller.getRetention.bind(controller));
    router.get('/conversion-funnel', controller.getConversionFunnel.bind(controller));
    router.get('/campaign-performance', controller.getCampaignPerformance.bind(controller));
    router.get('/engagement', controller.getEngagementMetrics.bind(controller));
    router.get('/overview', controller.getOverview.bind(controller));

    router.get('/ignored-users', controller.getIgnoredUsers.bind(controller));
    router.post('/ignored-users', controller.addIgnoredUser.bind(controller));
    router.delete('/ignored-users/:userId', controller.removeIgnoredUser.bind(controller));
    router.get('/account-search', controller.searchAccounts.bind(controller));

    router.get('/gsc/status', controller.getGscStatus.bind(controller));
    router.post('/gsc/credentials', controller.saveGscCredentials.bind(controller));
    router.delete('/gsc/credentials', controller.removeGscCredentials.bind(controller));
    router.post('/gsc/refresh', controller.refreshGscData.bind(controller));
    router.get('/gsc/keywords', controller.getGscKeywords.bind(controller));
    router.get('/gsc/keywords-by-day', controller.getGscKeywordsByDay.bind(controller));

    return router;
}
