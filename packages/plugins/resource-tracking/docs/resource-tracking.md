# Resource Tracking Plugin

This plugin tracks TRON energy and bandwidth delegation patterns, providing insights into network resource flows, energy rental pool activity, and whale movements.

## Who This Document Is For

Backend developers implementing blockchain analytics features, operations engineers monitoring resource delegation trends, and frontend developers building visualization components for delegation data.

## Why This Matters

TRON's resource delegation system (energy and bandwidth staking) drives a significant portion of network activity. Energy rental pools control billions of TRX in delegated resources, yet this activity is difficult to track without specialized tooling.

Without resource tracking:
- Cannot identify which pools dominate energy rental markets
- Cannot detect whale delegation movements that signal market shifts
- Cannot visualize network-wide delegation trends over time
- Cannot correlate pool activity with energy market pricing

This plugin solves these problems by capturing delegation transactions in real-time, aggregating statistics for trend analysis, and exposing APIs for frontend visualization.

## Core Components

### Delegation Tracker Observer

The observer subscribes to `DelegateResourceContract` and `UnDelegateResourceContract` transaction types, extracting delegation details and persisting them to the plugin database.

**Key behaviors:**
- Stores positive amounts for delegations, negative for reclaims
- Tracks resource type (ENERGY=1, BANDWIDTH=0)
- Captures lock period for rental duration calculations
- Detects pool-controlled delegations via Permission_id >= 3

**Source:** `src/backend/delegation-tracker.observer.ts`

### Pool Tracking System

Delegations with Permission_id >= 3 indicate pool-controlled transactions (custom permissions granted to pool addresses). The plugin tracks these separately to enable pool analytics.

**Data flow:**
1. Observer detects Permission_id >= 3 on delegation transaction
2. Pool membership service looks up controlling pool address
3. Delegation stored in `pool-delegations` collection with pool reference
4. WebSocket broadcasts aggregated pool data to subscribers

**Collections:**
- `pool-delegations` - Individual pool-controlled delegation records (48h retention)
- `pool-delegations-hourly` - Hourly aggregates per pool (long-term retention)
- `pool-members` - Pool-to-account permission mappings

**Source:** `src/backend/pools.service.ts`, `src/backend/pool-membership.service.ts`

### Pool Membership Discovery

When an unknown delegator uses Permission_id >= 3, the plugin queries TronGrid to discover which pool controls that account.

**Process:**
1. Observer queues unknown account for permission lookup
2. Background service processes queue every 30 seconds
3. TronGrid `/wallet/getaccount` reveals active_permission keys
4. Pool addresses extracted and cached in `pool-members` collection

**Rate limiting:** 200ms delay between TronGrid calls, batch size of 10 accounts per cycle.

**Source:** `src/backend/pool-membership.service.ts`

### Summation Job

Aggregates delegation transactions into 5-minute summaries using block-based windows (default: 100 blocks at 3-second block time).

**Key features:**
- Block-based aggregation ensures deterministic, replayable results
- Waits for blockchain sync (N+1 block verification) before processing
- Processes up to 4 tranches per run to catch up when behind
- Emits WebSocket events for real-time chart updates

**Aggregated metrics:**
- Energy delegated/reclaimed amounts (SUN)
- Bandwidth delegated/reclaimed amounts (SUN)
- Net flows (delegated - reclaimed)
- Transaction counts (delegate vs undelegate)

**Source:** `src/backend/summation.job.ts`

### Purge Job

Manages data retention by cleaning old records and aggregating pool data into hourly summaries.

**Retention schedule:**
| Data Type | Retention | Configurable |
|-----------|-----------|--------------|
| Raw transactions | 48 hours | `detailsRetentionDays` |
| Pool delegations | 48 hours | Hardcoded |
| Pool delegations hourly | Long-term | Created from raw before purge |
| Summations | 6 months | `summationRetentionMonths` |

**Hourly aggregation:** Before purging raw pool delegations, the job aggregates them into `pool-delegations-hourly` with per-hour statistics per pool.

**Source:** `src/backend/purge.job.ts`

### Whale Detection

Optional feature that identifies delegations exceeding a configurable threshold.

**Configuration:**
- `whaleDetectionEnabled` - Enable/disable detection (default: false)
- `whaleThresholdTrx` - Minimum TRX amount (default: 2,000,000)

**Whale records include:** txId, timestamp, addresses, amount in TRX, resource type, block number.

**Source:** `src/backend/delegation-tracker.observer.ts` (detectWhale method)

### Address Book

Human-readable names for known addresses (pools, exchanges, notable accounts).

**Categories:** pool, exchange, notable, other

**Seeded data:** Common pool and exchange addresses pre-populated on install.

**Source:** `src/backend/address-book-seed.ts`

## Data Collections

| Collection | Purpose | Retention |
|------------|---------|-----------|
| `transactions` | Raw delegation/reclaim records | 48 hours |
| `summations` | 5-minute aggregated statistics | 6 months |
| `pool-delegations` | Pool-controlled delegation records | 48 hours |
| `pool-delegations-hourly` | Hourly pool aggregates | Long-term |
| `pool-members` | Pool-to-account permission mappings | Permanent |
| `whale-delegations` | High-value delegation records | Permanent |
| `address-book` | Human-readable address names | Permanent |
| `config` | Plugin configuration | Permanent |
| `aggregation-state` | Summation job cursor | Permanent |

## API Endpoints

### Public Routes (`/api/plugins/resource-tracking/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/summations` | Get aggregated delegation statistics |
| GET | `/settings` | Get plugin configuration |
| POST | `/settings` | Update plugin configuration |
| GET | `/whales/recent` | Get recent whale delegations |
| GET | `/pools` | Get all pools with aggregated stats |
| GET | `/pools/:address` | Get specific pool details |
| GET | `/pools/:address/delegations` | Get recent delegations for a pool |
| GET | `/pools/:address/members` | Get pool member accounts |
| GET | `/pools/hourly-volume` | Get hourly pool volume data |
| GET | `/address-book` | Get address book entries |
| GET | `/address-book/:address` | Get specific address entry |

### Admin Routes (`/api/plugins/resource-tracking/system/*`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/cache/clear` | Clear summation cache |

## Frontend Pages

### Resource Explorer (`/tron-resource-explorer`)

Displays network-wide delegation trends with time-series charts.

**Features:**
- Energy/bandwidth delegation flow charts
- Time period selector (1d, 7d, 30d, 6m)
- Real-time updates via WebSocket

**Source:** `src/frontend/ResourceTrackingPage.tsx`

### Energy Pools (`/energy-pools`)

Tracks energy rental pool activity and market share.

**Features:**
- Pool rankings by delegation volume
- Doughnut chart visualization
- Expandable pool details (members, recent delegations)
- Real-time updates via WebSocket

**Source:** `src/frontend/PoolsPage.tsx`

### Settings (`/system/plugins/resource-tracking/settings`)

Admin configuration for retention policies and whale detection.

**Source:** `src/frontend/ResourceTrackingSettingsPage.tsx`

## WebSocket Events

### Subscription Rooms

| Room | Event | Payload |
|------|-------|---------|
| `summation-updates` | `summation-created` | New summation data point |
| `pool-updates` | `pools:updated` | Full aggregated pool data |

### Subscribing from Frontend

```typescript
// Subscribe to pool updates
context.websocket.subscribe('pool-updates');

// Listen for updates
context.websocket.on('pools:updated', (data) => {
    setPools(data.pools);
    setAddressBook(data.addressBook);
});
```

## Configuration Reference

```typescript
interface IResourceTrackingConfig {
    /** Days to retain raw transaction details (default: 2) */
    detailsRetentionDays: number;

    /** Months to retain summation data (default: 6) */
    summationRetentionMonths: number;

    /** Hours between purge job runs (default: 1) */
    purgeFrequencyHours: number;

    /** Blocks per summation interval (default: 100, ~5 minutes) */
    blocksPerInterval: number;

    /** Enable whale detection (default: false) */
    whaleDetectionEnabled: boolean;

    /** TRX threshold for whale detection (default: 2,000,000) */
    whaleThresholdTrx: number;
}
```

## Quick Reference

### File Structure

```
src/
├── manifest.ts                    # Plugin metadata
├── backend/
│   ├── backend.ts                 # Lifecycle hooks, API routes
│   ├── delegation-tracker.observer.ts  # Transaction observer
│   ├── pools.service.ts           # Pool aggregation logic
│   ├── pool-membership.service.ts # TronGrid permission discovery
│   ├── summation.job.ts           # 5-minute aggregation job
│   ├── purge.job.ts               # Data cleanup and hourly aggregation
│   ├── install-indexes.ts         # MongoDB index creation
│   └── address-book-seed.ts       # Known address seed data
├── frontend/
│   ├── frontend.ts                # Page registration, menu items
│   ├── PoolsPage.tsx              # Energy pools dashboard
│   ├── ResourceTrackingPage.tsx   # Network delegation trends
│   └── ResourceTrackingSettingsPage.tsx  # Admin settings
└── shared/
    └── types/                     # Shared TypeScript interfaces
```

### Common Operations

**Check pool membership queue:**
```typescript
const queueLength = poolMembershipService.getQueueLength();
const cacheSize = poolMembershipService.getCacheSize();
```

**Manually trigger summation:**
```typescript
await runSummationJob(database, logger, websocket);
```

**Clear summation cache:**
```bash
curl -X POST -H "X-Admin-Token: $TOKEN" \
  http://localhost:4000/api/plugins/resource-tracking/system/cache/clear
```

## Known Limitations

### 7-Day and 30-Day Pool Views (Not Yet Implemented)

**Status:** The 7d and 30d period selectors on the Energy Pools page have been temporarily disabled.

**Problem:** The `/pools` API endpoint and `aggregatePools()` function query the raw `pool-delegations` collection directly. However, the purge job deletes raw pool delegations older than 48 hours. This means:

- **24h view:** Works correctly (raw data available)
- **7d view:** Would only show ~48 hours of data
- **30d view:** Would only show ~48 hours of data

**Root cause:** The hourly aggregation infrastructure exists (`pool-delegations-hourly` collection, created during purge), but the query layer hasn't been updated to use hourly aggregates for longer time periods.

**Data flow gap:**

```
[Observer] → pool-delegations (raw, 48h retention)
                    ↓
[Purge Job] → pool-delegations-hourly (aggregated, long-term)
                    ↓
[API /pools] → queries pool-delegations only ❌
               (should query hourly for 7d/30d)
```

**Impact on unique counts:** Hourly aggregates store `uniqueDelegators` and `uniqueRecipients` as counts per hour, not address sets. Summing these across hours would overcount addresses that appear in multiple hours (e.g., Alice delegating in hour 1 and hour 11 counts as 2 instead of 1).

**Resolution path:**
1. Modify `aggregatePools()` to detect when `hours > 48`
2. Query `pool-delegations-hourly` for longer periods
3. Accept approximate unique counts for 7d/30d views, or hide the metric
4. Re-enable period selectors in `PoolsPage.tsx`

**Tracking:** The period selector code contains a comment marking this limitation:
```typescript
{/* Period selector - 7d/30d temporarily disabled until hourly aggregate queries are implemented */}
```

## Further Reading

**Plugin system documentation:**
- [plugins.md](../../../../docs/plugins/plugins.md) - Plugin architecture overview
- [plugins-blockchain-observers.md](../../../../docs/plugins/plugins-blockchain-observers.md) - Observer pattern details
- [plugins-websocket-subscriptions.md](../../../../docs/plugins/plugins-websocket-subscriptions.md) - WebSocket integration

**Related topics:**
- [tron.md](../../../../docs/tron/tron.md) - TRON blockchain concepts
- [system-scheduler-operations.md](../../../../docs/system/system-scheduler-operations.md) - Background job management
