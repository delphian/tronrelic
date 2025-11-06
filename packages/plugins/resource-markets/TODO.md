# Resource Markets Plugin TODO

## Affiliate Tracking Analytics Dashboard

### Current State

The plugin currently tracks affiliate link impressions and clicks in the `affiliate_tracking` collection:

- **Backend tracking (implemented):**
  - `MarketAffiliateService` records impressions and clicks via POST endpoints
  - Database stores: `impressions`, `clicks`, `lastClickAt`, `trackingCode` per market
  - Tracking data accumulates but is not surfaced to admins

- **Missing component:**
  - No admin interface to view accumulated tracking analytics
  - No API endpoint to retrieve aggregated tracking data
  - No visualization of click-through rates or conversion metrics

### Requirement

**Admin users need visibility into affiliate link performance to:**
- Evaluate which markets generate the most engagement
- Calculate click-through rates (CTR) for commission optimization
- Identify underperforming affiliate links that need updating
- Track revenue attribution and conversion patterns
- Make data-driven decisions about affiliate partnerships

### Proposed Implementation

Add an **Analytics tab** to the `ResourceMarketsAdminPage` component that displays affiliate tracking metrics.

#### Backend Changes

**1. New API endpoint** (`src/backend/api/admin.routes.ts`):

```typescript
/**
 * GET /plugins/resource-markets/system/analytics
 *
 * Returns affiliate tracking analytics for all markets.
 *
 * Response includes per-market metrics:
 * - Market name and GUID
 * - Affiliate link URL
 * - Total impressions
 * - Total clicks
 * - Click-through rate (CTR = clicks / impressions)
 * - Last click timestamp
 * - Days since last click (staleness indicator)
 */
{
    method: 'GET',
    path: '/analytics',
    handler: async (req, res, next) => {
        // Join affiliate_tracking with markets collection
        // Calculate CTR and staleness metrics
        // Return sorted by highest CTR or most recent activity
    }
}
```

**2. Service method** (optional, in `MarketAffiliateService`):

```typescript
/**
 * Retrieves aggregated analytics across all markets.
 *
 * @returns Array of market analytics with CTR calculations
 */
async getAnalytics(): Promise<MarketAnalytics[]> {
    // Fetch all affiliate_tracking records
    // Join with markets collection for names
    // Calculate derived metrics (CTR, staleness)
    // Sort by engagement or recency
}
```

#### Frontend Changes

**1. New component** (`src/frontend/system/components/AffiliateAnalytics.tsx`):

```typescript
/**
 * Affiliate Analytics Component.
 *
 * Displays affiliate link performance metrics in a tabular format.
 *
 * Features:
 * - Sortable columns (impressions, clicks, CTR)
 * - Color-coded CTR indicators (green = high, red = low)
 * - Staleness warnings (no clicks in 30+ days)
 * - Export to CSV functionality
 * - Auto-refresh every 60 seconds
 *
 * Columns:
 * - Market Name
 * - Affiliate Link (truncated with tooltip)
 * - Impressions
 * - Clicks
 * - CTR (%)
 * - Last Click (relative time)
 * - Status (active/stale badge)
 */
export function AffiliateAnalytics({ context }: { context: IFrontendPluginContext }) {
    // Fetch from /plugins/resource-markets/system/analytics
    // Render table with ui.Table component
    // Add sorting, filtering, refresh controls
}
```

**2. Update admin page** (`src/frontend/system/pages/ResourceMarketsAdminPage.tsx`):

Add tabbed interface with:
- **Configuration tab** (existing: MarketConfigSettings)
- **Scheduler tab** (existing: SchedulerJobControl)
- **Monitoring tab** (existing: MarketMonitor)
- **Analytics tab** (new: AffiliateAnalytics)

Use `ui.Tabs` component for navigation between sections.

#### Data Structure

**API Response** (`GET /plugins/resource-markets/system/analytics`):

```typescript
{
    success: true,
    analytics: [
        {
            marketGuid: string,
            marketName: string,
            affiliateLink: string | null,
            impressions: number,
            clicks: number,
            ctr: number,              // Click-through rate percentage (0-100)
            lastClickAt: string | null,  // ISO timestamp
            daysSinceLastClick: number | null,
            status: 'active' | 'stale' | 'inactive'  // Based on recent activity
        }
    ],
    totalImpressions: number,
    totalClicks: number,
    averageCTR: number,
    timestamp: number
}
```

#### UI Mockup

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Resource Markets Settings                                               │
├─────────────────────────────────────────────────────────────────────────┤
│ [ Configuration ] [ Scheduler ] [ Monitoring ] [ Analytics ]            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ Affiliate Link Performance                                              │
│ ────────────────────────────────────────────────────────────────────    │
│                                                                          │
│ Total Impressions: 12,450    Total Clicks: 342    Avg CTR: 2.75%       │
│                                                                          │
│ ┌─────────────────────────────────────────────────────────────────────┐│
│ │ Market      │ Link        │ Impr.  │ Clicks │ CTR ↓  │ Last Click ││
│ ├─────────────────────────────────────────────────────────────────────┤│
│ │ TronSave    │ tronsave... │ 3,421  │ 156    │ 4.56%  │ 2 hours    ││
│ │ MeFree      │ mefree...   │ 2,890  │ 89     │ 3.08%  │ 5 hours    ││
│ │ LexStake    │ lexstake... │ 1,956  │ 45     │ 2.30%  │ 1 day      ││
│ │ TronNRG     │ tronnrg...  │ 1,234  │ 28     │ 2.27%  │ 3 days     ││
│ │ TRON.Save   │ null        │ 2,949  │ 0      │ 0.00%  │ Never      ││
│ └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│ [ Refresh ] [ Export CSV ]                              Last update: Now│
└─────────────────────────────────────────────────────────────────────────┘
```

#### Visual Indicators

- **CTR color coding:**
  - `> 3%` - Green (high performance)
  - `1-3%` - Yellow (moderate performance)
  - `< 1%` - Red (low performance)
  - `0%` - Gray (no clicks)

- **Staleness badges:**
  - `< 7 days` - Green "Active" badge
  - `7-30 days` - Yellow "Stale" badge
  - `> 30 days` - Red "Inactive" badge
  - No affiliate link - Gray "Not Configured" badge

### Files to Create/Modify

**Backend:**
- `src/backend/api/admin.routes.ts` - Add GET /analytics endpoint
- `src/backend/services/market-affiliate.service.ts` - Add getAnalytics() method (optional)

**Frontend:**
- `src/frontend/system/components/AffiliateAnalytics.tsx` - New component
- `src/frontend/system/components/AffiliateAnalytics.module.css` - Styling
- `src/frontend/system/pages/ResourceMarketsAdminPage.tsx` - Add tabbed interface

### Testing Checklist

- [ ] Backend endpoint returns correct aggregated data
- [ ] CTR calculations are accurate (clicks / impressions * 100)
- [ ] Staleness calculations use correct date math
- [ ] Markets without affiliate links show "Not Configured"
- [ ] Table sorting works for all columns
- [ ] Auto-refresh updates data without full page reload
- [ ] Export to CSV includes all visible columns
- [ ] Color indicators match documented thresholds
- [ ] Component handles empty state (no analytics data)
- [ ] Component handles loading and error states

### Future Enhancements

**Phase 2 (Post-MVP):**
- Historical trend charts (impressions/clicks over time)
- Date range filtering (last 7 days, 30 days, all time)
- Per-market drill-down with hourly breakdown
- A/B testing support (multiple affiliate links per market)
- Revenue tracking integration (if conversion webhooks implemented)
- Alerting (notify when CTR drops below threshold)
- Geographic breakdown (if IP geolocation added)

**Phase 3 (Advanced):**
- Commission calculator (estimated revenue based on affiliate terms)
- ROI analysis (compare affiliate commissions to platform subscription costs)
- Automated link rotation (disable underperforming affiliates)
- Integration with external analytics platforms (Google Analytics, Plausible)

### Priority

**Medium** - This feature improves admin visibility but doesn't block core functionality. Current workaround is querying MongoDB directly. Implement after critical path items (market fetching, normalization, public leaderboard display) are stable.

### Related Documentation

- [market-system-architecture.md](../../docs/markets/market-system-architecture.md) - Market data pipeline
- [plugins-api-registration.md](../../docs/plugins/plugins-api-registration.md) - Admin endpoint patterns
- [ui-component-styling.md](../../docs/frontend/ui/ui-component-styling.md) - Table styling guidelines

---

## Prometheus Metrics Support

### Current State

The plugin currently tracks market reliability and performance metrics in MongoDB:

- **MarketReliabilityService** stores success/failure counts, reliability scores, and EMA availability in `reliability` collection
- **MarketService** stores effective prices, availability percentages, and staleness indicators in `markets` collection
- **REST API monitoring endpoints** expose this data as JSON via:
  - `GET /plugins/resource-markets/system/platforms` - Platform status and reliability
  - `GET /plugins/resource-markets/system/freshness` - Data age metrics

**Missing component:**
- No Prometheus metrics export for time-series monitoring
- No Grafana dashboard integration for historical trend analysis
- No alerting integration with Prometheus Alertmanager

### Background

Prior to plugin migration, the legacy markets module (`apps/backend/src/modules/markets/`) exposed 7 Prometheus metrics:

| Metric Name | Type | Purpose |
|-------------|------|---------|
| `tronrelic_market_fetch_duration_seconds` | Histogram | Fetch execution time |
| `tronrelic_market_fetch_success_total` | Counter | Total successful fetches |
| `tronrelic_market_fetch_failure_total` | Counter | Total failed fetches |
| `tronrelic_market_fetch_retry_total` | Counter | Total retry attempts |
| `tronrelic_market_availability_percent` | Gauge | Latest availability % |
| `tronrelic_market_reliability_score` | Gauge | Latest reliability (0-1) |
| `tronrelic_market_effective_price_trx` | Gauge | Latest effective price |

These metrics were removed during legacy module retirement to avoid duplicating metrics infrastructure.

### Requirement

**Monitoring teams need Prometheus metrics export to:**
- Visualize market reliability trends in Grafana dashboards
- Set up alerting rules for market failures (e.g., reliability drops below 50%)
- Correlate market performance with blockchain sync and transaction volumes
- Track SLA compliance for third-party market API uptime
- Monitor effective price changes over time for anomaly detection

### Proposed Implementation

Add optional Prometheus metrics export to the resource-markets plugin while maintaining REST API monitoring as the primary interface.

#### Option A: Plugin-Native Prometheus Registry (Recommended)

**Architecture:**
- Plugin maintains its own Prometheus `Registry` instance
- Exposes `/plugins/resource-markets/metrics` endpoint (admin-only)
- Core `/metrics` endpoint aggregates all plugin registries

**Implementation:**

**1. Add Prometheus dependency** (`package.json`):
```json
{
  "dependencies": {
    "prom-client": "^15.1.0"
  }
}
```

**2. Create metrics service** (`src/backend/services/market-metrics.service.ts`):
```typescript
import { Registry, Counter, Gauge, Histogram } from 'prom-client';
import type { IPluginContext } from '@tronrelic/types';

/**
 * Prometheus metrics service for resource markets plugin.
 *
 * Exposes market fetcher performance and reliability metrics in Prometheus format
 * for Grafana dashboards and Alertmanager integration.
 */
export class MarketMetricsService {
    private readonly registry: Registry;
    private readonly fetchDuration: Histogram<string>;
    private readonly fetchSuccess: Counter<string>;
    private readonly fetchFailure: Counter<string>;
    private readonly availabilityGauge: Gauge<string>;
    private readonly reliabilityGauge: Gauge<string>;
    private readonly effectivePriceGauge: Gauge<string>;

    constructor(private readonly context: IPluginContext) {
        this.registry = new Registry();

        // Initialize metrics with same names as legacy module
        this.fetchDuration = new Histogram({
            name: 'tronrelic_market_fetch_duration_seconds',
            help: 'Duration of market fetcher executions in seconds',
            labelNames: ['market'],
            registers: [this.registry]
        });

        // ... initialize other metrics
    }

    // Expose methods: observeDuration(), incrementSuccess(), etc.
}
```

**3. Integrate into fetcher workflow** (`src/backend/jobs/refresh-markets.job.ts`):
```typescript
// Instrument fetcher execution
const startTime = process.hrtime.bigint();
try {
    const result = await fetcher.fetch(context);
    metricsService.incrementSuccess(fetcher.guid);
} catch (error) {
    metricsService.incrementFailure(fetcher.guid);
} finally {
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    metricsService.observeDuration(fetcher.guid, duration);
}
```

**4. Add metrics endpoint** (`src/backend/api/monitoring.routes.ts`):
```typescript
{
    method: 'GET',
    path: '/metrics',  // Results in /plugins/resource-markets/system/metrics
    handler: async (req, res, next) => {
        const metrics = await metricsService.collectMetrics();
        res.setHeader('Content-Type', 'text/plain; version=0.0.4');
        res.send(metrics);
    }
}
```

**5. Core backend aggregates plugin metrics** (`apps/backend/src/loaders/express.ts`):
```typescript
app.get('/metrics', async (req, res) => {
    // Collect from all plugins
    const pluginMetrics = await PluginRegistry.collectAllMetrics();

    // Merge with core metrics
    const combined = coreMetrics + '\n' + pluginMetrics;
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(combined);
});
```

#### Option B: Core Metrics Bridge (Alternative)

**Architecture:**
- Core backend queries plugin MongoDB collections
- Exposes metrics at core `/metrics` endpoint
- Plugin remains unmodified

**Pros:**
- No plugin code changes required
- Centralized metrics management

**Cons:**
- Tight coupling to plugin database schema
- Adds latency to `/metrics` scraping
- Cannot capture real-time counters (only current state)

**Decision:** Option A preferred for cleaner separation of concerns and real-time metric accuracy.

#### Metrics Mapping

**From MongoDB to Prometheus:**

| MongoDB Collection | Field | Prometheus Metric | Type |
|-------------------|-------|-------------------|------|
| `reliability` | `successCount` | `tronrelic_market_fetch_success_total` | Counter |
| `reliability` | `failureCount` | `tronrelic_market_fetch_failure_total` | Counter |
| `reliability` | `reliability` | `tronrelic_market_reliability_score` | Gauge |
| `markets` | `availabilityPercent` | `tronrelic_market_availability_percent` | Gauge |
| `markets` | `effectivePrice` | `tronrelic_market_effective_price_trx` | Gauge |
| Instrumentation | Fetch timing | `tronrelic_market_fetch_duration_seconds` | Histogram |

### Files to Create/Modify

**Plugin files:**
- `src/backend/services/market-metrics.service.ts` - New Prometheus metrics service
- `src/backend/jobs/refresh-markets.job.ts` - Instrument fetcher execution
- `src/backend/api/monitoring.routes.ts` - Add `/metrics` endpoint
- `src/backend/backend.ts` - Initialize and expose metrics service
- `package.json` - Add `prom-client` dependency

**Core backend files (for aggregation):**
- `apps/backend/src/loaders/express.ts` - Aggregate plugin metrics into `/metrics` endpoint
- `apps/backend/src/services/plugin-registry.ts` - Add `collectAllMetrics()` method

### Testing Checklist

- [ ] Metrics endpoint returns valid Prometheus format
- [ ] Counter increments are accurate (success/failure)
- [ ] Histogram buckets capture fetch duration correctly
- [ ] Gauge values sync from MongoDB state
- [ ] Plugin metrics appear in core `/metrics` endpoint
- [ ] Prometheus scraper successfully ingests metrics
- [ ] Grafana dashboard queries render correctly
- [ ] Alerting rules trigger on reliability drops

### Grafana Dashboard Example

**Resource Markets Health Dashboard:**
```
┌─────────────────────────────────────────────────────────────┐
│ Market Reliability                                           │
│ ──────────────────────────────────────────────────────────  │
│ [Line graph: tronrelic_market_reliability_score over time]  │
│                                                              │
│ Fetch Success Rate                                           │
│ ──────────────────────────────────────────────────────────  │
│ [Line graph: rate(tronrelic_market_fetch_success_total)]    │
│                                                              │
│ Effective Price Trends                                       │
│ ──────────────────────────────────────────────────────────  │
│ [Line graph: tronrelic_market_effective_price_trx]          │
└─────────────────────────────────────────────────────────────┘
```

**Alerting Rule Example:**
```yaml
groups:
  - name: resource_markets
    rules:
      - alert: MarketReliabilityLow
        expr: tronrelic_market_reliability_score < 0.5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Market {{ $labels.market }} reliability below 50%"
          description: "{{ $labels.market }} has {{ $value }}% reliability"
```

### Priority

**Low** - This feature improves operational observability but doesn't block core functionality. REST API monitoring endpoints (`/platforms`, `/freshness`) provide equivalent data for manual inspection. Implement when Grafana dashboards become critical for production monitoring.

### Related Documentation

- [system-api.md](../../docs/system/system-api.md) - Core `/metrics` endpoint reference
- [PROMETHEUS_METRICS_GAP_ANALYSIS.md](../../PROMETHEUS_METRICS_GAP_ANALYSIS.md) - Decision rationale for removing legacy metrics
