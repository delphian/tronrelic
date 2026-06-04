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
 * └── lib/              # Device icon helper
 * ```
 */

// =============================================================================
// Components — `/system/traffic` admin dashboards
// =============================================================================

export { VisitorAnalytics } from './components';
export { PageActivity } from './components';
export { AnalyticsDashboard } from './components';
export { GscSettings } from './components';
export { GscKeywords } from './components';
export { TrafficDashboard } from './components';
export { CrawlerDashboard } from './components';

// =============================================================================
// API client
// =============================================================================

export * from './api';
