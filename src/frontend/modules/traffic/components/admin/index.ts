/**
 * Admin components for the `/system/traffic` dashboard.
 *
 * Traffic analytics, visitor first-touch capture, per-page clickstreams,
 * bot-class aggregates, and the Google Search Console integration. Carved
 * out of the user module to mirror the backend identity/traffic split.
 */

export { VisitorAnalytics } from './VisitorAnalytics';
export { PageActivity } from './PageActivity';
export { VisitorsExplorer } from './VisitorsExplorer';
export type { VisitorsView } from './VisitorsExplorer';
export { AnalyticsDashboard } from './AnalyticsDashboard';
export { GscSettings } from './GscSettings';
export { IgnoredUsers } from './IgnoredUsers';
export { GscKeywords } from './GscKeywords';
export { TrafficDashboard } from './TrafficDashboard';
export { CrawlerDashboard } from './CrawlerDashboard';
export { OverviewTrend } from './OverviewTrend';
export { PeriodPicker, toDateInputValue } from './PeriodPicker';
