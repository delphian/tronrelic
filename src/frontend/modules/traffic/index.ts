/**
 * Traffic Module
 *
 * Frontend surface for the backend traffic module: the `/system/traffic`
 * admin dashboards (visitor analytics, per-page clickstreams, bot-class
 * aggregates, Google Search Console) and their API client. Carved out of
 * the user module to mirror the backend identity/traffic split — account
 * identity stays in `modules/user`; cookieless analytics live here.
 *
 * ## Directory Structure
 *
 * ```
 * modules/traffic/
 * ├── index.ts          # Barrel exports (this file)
 * ├── api/              # Admin analytics + GSC client
 * ├── components/       # admin/* dashboard panels
 * ├── hooks/            # Shared dashboard hooks (auto-refresh clock)
 * └── lib/              # Device icon helper
 * ```
 */

// =============================================================================
// Components — `/system/traffic` admin dashboards
// =============================================================================

export { VisitorAnalytics } from './components';
export { PageActivity } from './components';
export { VisitorsExplorer } from './components';
export type { VisitorsView } from './components';
export { AnalyticsDashboard } from './components';
export { GscSettings } from './components';
export { IgnoredUsers } from './components';
export { GscKeywords } from './components';
export { RedirectsManager } from './components';
export { TrafficDashboard } from './components';
export { CrawlerDashboard } from './components';
export { OverviewTrend } from './components';
export { PeriodPicker, toDateInputValue } from './components';

// =============================================================================
// Hooks — shared dashboard behavior
// =============================================================================

export { useAutoRefresh } from './hooks/useAutoRefresh';

// =============================================================================
// API client
// =============================================================================

export * from './api';
