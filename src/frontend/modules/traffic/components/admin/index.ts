/**
 * Admin components for the `/system/traffic` dashboard.
 *
 * Traffic analytics, visitor first-touch capture, per-page clickstreams,
 * bot-class aggregates, and the Google Search Console integration. Carved
 * out of the user module to mirror the backend identity/traffic split.
 */

export { VisitorAnalytics } from './VisitorAnalytics';
export { PageActivity } from './PageActivity';
export { AnalyticsDashboard } from './AnalyticsDashboard';
export { GscSettings } from './GscSettings';
export { GscKeywords } from './GscKeywords';
export { TrafficDashboard } from './TrafficDashboard';
export { CrawlerDashboard } from './CrawlerDashboard';
