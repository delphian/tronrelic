# Resource Explorer Plugin - Whale Detection Roadmap

## Feature Overview

Add whale delegation detection to track large-scale resource delegations on the TRON blockchain. This provides market intelligence, pattern detection, and institutional activity monitoring beyond aggregate network statistics.

## Why Track Whale Delegations?

Unlike simple TRX transfers, resource delegations reveal **market behavior and network usage patterns**:

### 1. Market Intelligence - "Who's Building Positions?"
- **Accumulation Detection**: Track when whales accumulate 50M+ TRX worth of energy to prepare for heavy smart contract usage
- **Pattern Recognition**: Repeated delegations to same address over hours = accumulation phase
- **Alert Value**: "Whale accumulated 75M TRX energy → likely planning significant on-chain activity"

### 2. Institutional Energy Rental Operations
- **Provider Identification**: Addresses consistently delegating 100M+ TRX energy to different receivers
- **Market Mapping**: See actual energy market activity beyond price listings
- **Competitive Analysis**: Track who's servicing large customers, estimate market share

### 3. Lock Period Signals
- **3-day locked delegations** = Short-term speculation or one-time operations
- **14+ day locked delegations** = Institutional relationships, stable energy supply contracts
- **Commitment Indicator**: Locked delegations can't be suddenly reclaimed, shows serious commitment

### 4. Reclaim Events - "When Whales Exit"
- **Operation Completion**: 100M TRX energy reclaimed = major operation finished
- **Market Timing**: Reclaims often precede major TRX price movements (liquidity returning)
- **Lifecycle Pattern**: Accumulate → Use → Reclaim cycle reveals operation duration

### 5. Address Relationship Mapping
- **Repeated Delegations**: Same whale → same address = ongoing business relationship
- **Distribution Patterns**: One whale → many addresses = energy marketplace operation
- **Concentration Patterns**: Many whales → one address = major protocol launching

## Implementation Phases

### ✅ Phase 1: Core Whale Detection (Essential)
**Status**: In Progress

**Objectives**:
- Configurable threshold alerting (default: 1M TRX worth of energy/bandwidth)
- Separate whale delegation persistence (30-day retention)
- Admin settings UI with enable/disable toggle
- Whale delegation feed display (last 50 whales)
- Basic whale delegation table with key fields

**Features**:
1. ✅ Threshold configuration (TRX units, converted to SUN for storage)
2. ✅ Enable/disable toggle for whale detection
3. ✅ Separate `whale-delegations` collection (independent retention)
4. ✅ Observer enhancement with threshold checking
5. ✅ Tabbed admin settings UI (Settings | Whales)
6. ✅ Recent whale delegations display (50 most recent)
7. ✅ RESTful API endpoint: GET `/whales/recent`

**Database Schema** (`whale-delegations` collection):
```typescript
interface IWhaleDelegation {
    txId: string;              // Unique transaction hash
    timestamp: Date;           // Transaction timestamp from blockchain
    fromAddress: string;       // Sender address (resource owner)
    toAddress: string;         // Receiver address (beneficiary)
    resourceType: 0 | 1;       // 0 = BANDWIDTH, 1 = ENERGY
    amountSun: number;         // Amount in SUN (precise storage)
    amountTrx: number;         // Amount in TRX (user-friendly display)
    blockNumber: number;       // Block number
    createdAt: Date;           // Record creation timestamp
}
```

**Indexes**:
- `txId` (unique) - Prevents duplicates
- `timestamp` (descending) - Recent query optimization
- `resourceType + timestamp` (compound) - Filtered queries

**API Endpoints**:
- `GET /plugins/resource-tracking/whales/recent?limit=50&resourceType=0|1`
  - Returns last N whale delegations
  - Optional resource type filter (0=BANDWIDTH, 1=ENERGY)
  - Sorted by timestamp descending

**Configuration** (`IResourceTrackingConfig`):
```typescript
{
    // Existing settings
    detailsRetentionDays: number;
    summationRetentionMonths: number;
    purgeFrequencyHours: number;
    blocksPerInterval: number;

    // New whale settings
    whaleDetectionEnabled: boolean;  // Master toggle (default: false)
    whaleThresholdTrx: number;       // Threshold in TRX (default: 1,000,000)
}
```

**UI Components**:
- Tabbed settings page (Settings | Whales)
- Whale configuration form (threshold input, enable checkbox)
- Recent whale delegations table
- Columns: Timestamp, From Address, To Address, Resource Type, Amount (TRX), Block Number
- Loading/error/empty states

### 🔄 Phase 2: Pattern Intelligence (High Value)
**Status**: Planned

**Objectives**:
- Accumulation detection (3+ delegations to same address in 24h)
- Lock period analysis (short-term vs long-term activity breakdown)
- Top delegators/receivers leaderboards
- Reclaim lifecycle tracking (match delegations to their reclaims)

**Features**:
1. Accumulation pattern detection algorithm
2. Pattern metadata fields (`pattern`, `confidence`, `clusterId`)
3. Lock period distribution charts
4. Top delegators ranking API endpoint
5. Top receivers ranking API endpoint
6. Lifecycle view (delegation → usage → reclaim)
7. Pattern-based filtering in whale feed

**Database Extensions**:
```typescript
interface IWhaleDelegation {
    // Phase 1 fields...

    // Phase 2 additions
    pattern?: 'accumulation' | 'distribution' | 'institutional' | 'single';
    confidence?: number;      // Pattern confidence score (0-1)
    clusterId?: string;       // Group related transactions
    reclaimTxId?: string;    // Link to reclaim transaction (lifecycle)
}
```

**New Endpoints**:
- `GET /whales/top-delegators?period=7d&limit=10`
- `GET /whales/top-receivers?period=7d&limit=10`
- `GET /whales/patterns?type=accumulation`
- `GET /whales/lifecycle/:txId` (show delegation + eventual reclaim)

**UI Enhancements**:
- Pattern badges in whale feed (🔥 Accumulation, 📊 Distribution, 🏢 Institutional)
- Lock period breakdown chart (pie/donut chart)
- Leaderboard tables (top delegators/receivers)
- Lifecycle timeline view

### 🔮 Phase 3: Advanced Intelligence (Nice to Have)
**Status**: Future

**Objectives**:
- Institutional provider identification
- Cross-reference with whale-alerts transfer data
- Address relationship mapping (who delegates to whom)
- Market timing analysis (correlate with TRX price movements)
- WebSocket real-time notifications

**Features**:
1. Institutional provider auto-detection (10+ different receivers in 30 days)
2. Unified whale dashboard (transfers + delegations)
3. Address relationship graph visualization
4. Delegation timing vs TRX price correlation
5. Real-time WebSocket rooms (`whale-delegation-{threshold}`)
6. Telegram integration for whale alerts
7. Custom webhook support

**Cross-Plugin Integration**:
- Merge whale-alerts transfer data with delegation data
- Identify addresses doing both large transfers AND delegations
- Unified "Whale Intelligence" page
- Combined pattern detection (transfer + delegation = institutional signature)

**Advanced Analytics**:
- Implied rental rate calculations (compare delegation amounts to TRX transfers)
- Energy accumulation heatmap (visualize whale positions over time)
- Whale wallet clustering (identify related addresses)
- Predictive alerts (whale behavior that precedes market moves)

**WebSocket Events**:
- `whale-delegation` - Emitted when threshold exceeded
- Configurable subscription thresholds (10M/50M/100M TRX rooms)
- Payload includes full delegation details + pattern metadata

## Technical Architecture

### Observer Enhancement Pattern
```typescript
// In delegation-tracker.observer.ts
protected async process(transaction: ITransaction) {
    // Existing logic: Store all delegations...

    // New whale detection logic
    const config = await this.loadConfig();
    if (!config.whaleDetectionEnabled) return;

    const thresholdSun = config.whaleThresholdTrx * 1_000_000;
    const amountSun = Math.abs(delegation.amountSun);

    if (amountSun >= thresholdSun) {
        await this.storeWhaleDelegation(delegation);
    }
}
```

### Separate Collection Strategy
- **Regular transactions**: 48-hour retention, used for aggregation
- **Whale delegations**: 30-day retention (longer history), independent queries
- **Reasoning**: Whales are rare and valuable, warrant extended retention
- **No aggregation impact**: Whale storage doesn't affect summation job performance

### Configuration Management
- Settings stored in plugin-scoped key-value storage: `database.set('config', config)`
- Validated on save with minimum/maximum bounds
- Reloaded by observer on each transaction (cached in memory)
- Changes take effect immediately (no backend restart needed)

## Testing Checklist

### Phase 1 Testing
- [ ] Settings page loads existing configuration
- [ ] Tab switching between Settings and Whales works
- [ ] Whale threshold input accepts TRX units (1,000,000 = 1M TRX)
- [ ] Enable/disable toggle controls whale detection
- [ ] Settings save successfully updates backend config
- [ ] Observer creates whale records when threshold exceeded
- [ ] Recent whales API returns last 50 delegations
- [ ] Whale delegations table displays correctly
- [ ] Empty state shows when no whale delegations exist
- [ ] Loading state shows during API fetch
- [ ] Error state shows on API failure
- [ ] Whale detection can be disabled (stops creating whale records)
- [ ] Whale records persist in separate collection
- [ ] Indexes created correctly during plugin installation

### Phase 2 Testing
- [ ] Accumulation pattern detected (3+ delegations to same address)
- [ ] Pattern badges appear in whale feed
- [ ] Lock period chart displays distribution correctly
- [ ] Top delegators endpoint returns ranked addresses
- [ ] Top receivers endpoint returns ranked addresses
- [ ] Lifecycle view links delegation to reclaim
- [ ] Pattern filtering works in whale feed

### Phase 3 Testing
- [ ] WebSocket events emitted for whale delegations
- [ ] Telegram notifications triggered correctly
- [ ] Whale-alerts data merged with delegation data
- [ ] Relationship graph renders correctly
- [ ] Price correlation analysis displays trends

## Configuration Reference

### Default Values
```typescript
{
    // Existing defaults
    detailsRetentionDays: 2,
    summationRetentionMonths: 6,
    purgeFrequencyHours: 1,
    blocksPerInterval: 100,

    // Whale defaults
    whaleDetectionEnabled: false,    // Disabled by default
    whaleThresholdTrx: 1_000_000     // 1M TRX minimum
}
```

### Recommended Thresholds
- **Conservative** (more alerts): 500k TRX
- **Balanced** (default): 1M TRX
- **Aggressive** (only mega-whales): 10M TRX

### Resource Type Values
- `0` = BANDWIDTH
- `1` = ENERGY (most common for whale tracking)

## Future Enhancements

### Beyond Phase 3
- **Machine learning pattern detection**: Train models on historical whale behavior
- **Predictive whale alerts**: Notify when whale accumulation matches pre-pump patterns
- **Multi-chain comparison**: Compare TRON whale activity to other chains
- **Whale portfolio tracking**: Follow specific whale addresses over time
- **Energy market maker detection**: Identify addresses providing liquidity
- **Contract deployment correlation**: Link whale delegations to contract deployments

### Integration Opportunities
- **DeFi protocol monitoring**: Alert when whales interact with specific protocols
- **NFT launch detection**: Whale energy accumulation before NFT mints
- **Exchange flow analysis**: Track whale delegations to/from exchange addresses
- **Governance participation**: Link whale stake to voting power

## Performance Considerations

### Database Impact
- Whale detection adds minimal overhead (single threshold check per transaction)
- Separate collection prevents aggregation query slowdown
- Indexes ensure fast recent whale queries
- Purge job handles retention automatically

### API Performance
- Recent whales endpoint limited to 50 results (prevents large payloads)
- Redis caching recommended for high-traffic scenarios
- Compound indexes optimize filtered queries

### Observer Performance
- Config cached in memory (no DB hit per transaction)
- Whale storage is async (doesn't block transaction processing)
- Error handling isolates whale detection from core aggregation

## Documentation Links

- **Plugin System Architecture**: [docs/plugins/plugins.md](../../../docs/plugins/plugins.md)
- **Blockchain Observers**: [docs/plugins/plugins-blockchain-observers.md](../../../docs/plugins/plugins-blockchain-observers.md)
- **Plugin Database Access**: [docs/plugins/plugins-database.md](../../../docs/plugins/plugins-database.md)
- **TRON Delegation Transactions**: [docs/tron/tron.md](../../../docs/tron/tron.md)
