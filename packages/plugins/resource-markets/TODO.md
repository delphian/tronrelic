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
