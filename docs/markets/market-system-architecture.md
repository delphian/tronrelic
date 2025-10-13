# Market System Architecture

This document explains how TronRelic captures, normalizes, and displays TRON energy market data. It covers the backend fetcher architecture, pricing calculations, and frontend presentation logic.

## Why This Matters

Energy markets on TRON quote prices in wildly different ways. Some markets sell energy by the hour, others by the day or week. Some quote prices for 32k energy chunks, others for 1M units. This inconsistency makes comparison impossible without normalization.

Without a unified pricing model, users cannot answer critical questions:

- Which market offers the cheapest USDT transfer right now?
- How does a 3-day rental at 64k energy compare to a 1-hour rental at 1M energy?
- What's the real cost difference between platform fees and P2P marketplace orders?

The market system solves this by:

1. Capturing raw data from diverse market APIs (GraphQL, REST, custom formats)
2. Normalizing all prices to a common baseline (TRX per USDT transfer)
3. **Accounting for TRON's energy regeneration** (critical for accurate multi-day pricing)
4. Separating platform pricing from peer-to-peer orders
5. Presenting data in a scannable leaderboard with expandable details

## TRON Energy Regeneration

Understanding TRON's energy regeneration mechanism is **critical** for accurate cost calculations across the entire market system.

### How Energy Regeneration Works

When you rent energy on TRON, it regenerates completely every 24 hours:

- Rent 65k energy for **1 day** → Use it **once** (65k available)
- Rent 65k energy for **7 days** → Use it **7 times** (65k available each day)
- Rent 65k energy for **30 days** → Use it **30 times** (65k available each day)

### Impact on USDT Transfer Costs

A single USDT transfer requires 65,000 energy. Energy regeneration means:

| Rental Duration | Total Cost | Energy Refills | USDT Transfers Possible | Cost per Transfer |
|----------------|------------|----------------|------------------------|-------------------|
| 1 hour | 35 TRX | 0 | 1 | 35.00 TRX |
| 1 day | 35 TRX | 1 | 1 | 35.00 TRX |
| 3 days | 35 TRX | 3 | 3 | **11.67 TRX** |
| 7 days | 35 TRX | 7 | 7 | **5.00 TRX** |
| 30 days | 35 TRX | 30 | 30 | **1.17 TRX** |

**Key insight:** The same 35 TRX investment yields dramatically different per-transfer costs depending on duration. A 30-day rental is **30x more cost-effective** than a 1-day rental!

### Why This Wasn't Obvious

Many energy markets quote prices as "X TRX for Y energy for Z duration" without explicitly mentioning regeneration. A naive calculation would treat a 7-day rental as a single-use purchase, overstating costs by 7x. Our system correctly accounts for regeneration to show the true per-transfer cost.

## How Data Flows

The market system transforms diverse pricing formats into a single normalized structure. Every market goes through the same pipeline, from raw API data to comparable pricing.

### Automatic Normalization Pipeline

Every market goes through the same automatic pipeline. **Fetchers only provide raw data** — all normalization, regeneration calculations, and price matrix generation happen automatically.

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Market Fetcher (e.g., Brutus Finance)                       │
│    Returns: { fees: [...raw pricing...], orders: [...] }       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Market Aggregator                                            │
│    Calls: MarketNormalizer.normalize(snapshot)                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Market Normalizer                                            │
│    Calls: computePricingDetail(fees, orders)                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Pricing Matrix Calculator                                    │
│    • Calls calculateUsdtTransferCost() for each duration       │
│    • Accounts for energy regeneration (divides by days)        │
│    • Builds price matrices with standard buckets               │
│    • Computes min/max/summary values                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Result: MarketDocument                                       │
│    {                                                            │
│      fees: [...raw data...],                                   │
│      pricingDetail: {                                           │
│        usdtTransferCosts: [...with regeneration...],           │
│        minUsdtTransferCost: 0.49,                              │
│        summary: { minPrice, maxPrice, ... }                    │
│      }                                                          │
│    }                                                            │
└─────────────────────────────────────────────────────────────────┘
```

**Key insight:** Fetchers are simple. They just grab data from APIs. The normalization pipeline does all the complex work automatically.

### 1. Data Capture (Fetchers)

Each market has a dedicated fetcher that extends `BaseMarketFetcher` and implements the `pull()` method. Fetchers run on a schedule (default: every 10 minutes) and return a `MarketSnapshot` containing raw market data.

**Architecture pattern:**

```
BaseMarketFetcher (abstract base)
├── fetch() - Orchestrates pull() → transform() → error handling
├── pull() - Abstract method for fetching raw data from market API
├── transform() - Validates raw data against MarketSnapshotSchema
└── shouldDeactivateMarket() - Detects fatal errors (SSL expiry, DNS failure)
```

**Key insight:** `fee.sun` represents the price **per unit of energy**, not a total price. If a market quotes 57 SUN for 1M energy, then `fee.sun = 57` and `fee.energyAmount = 1_000_000`. This means each energy unit costs 57 SUN. For guidance on distinguishing total bundle prices from per-unit prices when working with new market APIs, see [market-fetcher-discovery.md](./market-fetcher-discovery.md#total-price-vs-per-unit-price).

**Example: TronSave fetcher** (`/apps/backend/src/modules/markets/fetchers/implementations/tron-save.fetcher.ts`)

```typescript
async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    // Fetch from GraphQL endpoint
    const overview = await this.loadMarketOverview(context);
    const price1h = await this.loadEstimateMinPrice(context, 60 * 60);
    const price1d = await this.loadEstimateMinPrice(context, 60 * 60 * 24);
    const orders = await this.loadOrders(context);

    // Build fee schedule
    const fees = [
        { minutes: 60, sun: price1h.market.estimateMinPrice, energyAmount: 1_000_000 },
        { minutes: 1440, sun: price1d.market.estimateMinPrice, energyAmount: 1_000_000 }
    ];

    // Return normalized snapshot
    return {
        guid: 'tron-save',
        name: 'Tron Save 能量 租赁',
        priority: 1,
        energy: { total: overview.totalLimitEnergy, available: overview.totalAvailableEnergy },
        fees,
        orders: orderSnapshots,
        isActive: true
    };
}
```

**Fetcher context** (`MarketFetcherContext`) provides:

- `http` - Axios instance with retry logic
- `logger` - Pino logger for structured logs
- `cacheTtlSeconds` - TTL for cached responses
- `chainParameters` - Chain Parameters Service for calculating TRX-to-energy conversions and APY (see [/docs/tron/tron-chain-parameters.md](/docs/tron/tron-chain-parameters.md))

For detailed guidance on API discovery techniques (network inspection, JavaScript bundle analysis, common path testing) and data structure modeling, see [market-fetcher-discovery.md](./market-fetcher-discovery.md#discovery-workflow).

**Difference between site fees and marketplace orders:**

- **Site fees** (`fees` array) - Platform-controlled pricing tiers. Fixed rates offered directly by the market operator (e.g., "64k energy for 1 hour = 3.2 TRX").
- **Marketplace orders** (`orders` array) - Peer-to-peer listings where sellers post their own prices. Dynamic and market-driven (e.g., "I'll sell 256k energy for 3 days for 8.5 TRX").

Some markets (like Tronify) only have orders. Others (like TronSave) have both.

### 2. Data Normalization

**In plain English:** After a fetcher returns raw pricing data, the system automatically processes it through three layers. Each layer adds more intelligence: converting prices to standard units, accounting for energy regeneration, and building comparison matrices. The fetcher doesn't do any of this work—it just provides the raw numbers.

Raw market snapshots flow through three normalization layers before reaching the frontend:

**Layer 1: USDT Transfer Calculator** (`/apps/backend/src/modules/markets/usdt-transfer-calculator.ts`)

Converts arbitrary energy amounts into real-world USDT transfer costs. The calculator uses **dynamically fetched energy costs from the blockchain** via the USDT Parameters Service (updated every 10 minutes):

- **~64,285 energy** - Standard transfer to wallet that already holds USDT (fetched from blockchain, not hardcoded)
- **~128,570 energy** - First-time transfer to empty wallet (2x standard, estimated)

**Important:** These values are NOT hardcoded. The system queries the TRON blockchain via `triggerconstantcontract` every 10 minutes to get the actual energy cost of a USDT transfer. This ensures accuracy as the USDT contract implementation may change over time.

**Critical feature: Energy Regeneration**

TRON's energy system regenerates every 24 hours. This has a profound impact on calculating the true cost per USDT transfer:

- When you rent 65k energy for **1 day**, you can make **1 USDT transfer**
- When you rent 65k energy for **7 days**, you can make **7 USDT transfers** (energy refills daily)
- When you rent 65k energy for **30 days**, you can make **30 USDT transfers**

This means longer rental durations provide dramatically better value per transfer, because the energy you rent is available repeatedly throughout the rental period.

```typescript
export async function calculateUsdtTransferCost(
    feeSun: number,           // Price per unit of energy (e.g., 57 SUN per 1 energy)
    energyAmount: number,     // Not used; kept for API compatibility
    useFirstTime = false,
    durationMinutes?: number  // NEW: Accounts for energy regeneration cycles
): Promise<number> {
    // Fetch dynamic energy cost from blockchain (updated every 10 minutes)
    const requiredEnergy = useFirstTime
        ? await usdtService.getFirstTimeTransferEnergy()
        : await usdtService.getStandardTransferEnergy();

    // Calculate total rental cost
    const totalSun = feeSun * requiredEnergy;
    const totalCostTrx = totalSun / 1_000_000;

    // Account for energy regeneration: energy refills every 24 hours
    // If renting for multiple days, you can use the energy multiple times
    if (durationMinutes && durationMinutes > 0) {
        const durationDays = durationMinutes / (24 * 60);

        // For durations >= 1 day, divide by number of days to get cost per transfer
        // For durations < 1 day (e.g., 1 hour), no regeneration benefit (divisor = 1)
        const regenerationCycles = Math.max(1, Math.floor(durationDays));

        return totalCostTrx / regenerationCycles;
    }

    // If no duration provided, return total cost (backward compatibility)
    return totalCostTrx;
}
```

**Why this matters:** Markets quote prices for arbitrary energy amounts (32k, 1M, 10M), but users care about practical costs. "How much does it cost to send USDT?" is the question users actually ask.

**Layer 2: Pricing Matrix Calculator** (`/apps/backend/src/modules/markets/pricing-matrix-calculator.ts`)

Generates a standardized pricing grid across predefined energy buckets and duration buckets:

- **Energy buckets:** 32k, 64k, 256k, 1M, 10M
- **Duration buckets:** 1h, 3h, 1d, 3d, 7d, 30d

Each price point is normalized to "TRX per 32k energy per day" for consistent comparison:

```typescript
function normalizePricePerUnit(priceInTrx: number, energyAmount: number, durationSeconds: number): number {
    const daysCount = durationSeconds / 86400;
    const energyUnits = energyAmount / 32_000;

    // Normalize to price per 32k energy per day
    return priceInTrx / (energyUnits * daysCount);
}
```

**Example:** A market charges 8.5 TRX for 256k energy for 3 days.

- Energy units: 256,000 / 32,000 = 8 units
- Days: 3
- Price per unit: 8.5 / (8 × 3) = **0.354 TRX per 32k energy per day**

The pricing matrix separates site fees from marketplace orders:

```typescript
export function computePricingDetail(
    fees: MarketFee[] | undefined,
    orders: MarketOrder[] | undefined
): MarketPricingDetail | undefined {
    const siteFees = computeSiteFeeMatrix(fees);
    const marketplaceOrders = computeMarketplaceOrderMatrix(orders);

    return {
        siteFees,
        marketplaceOrders,
        usdtTransferCosts: calculateUsdtTransferCostsForAllDurations(fees),
        minUsdtTransferCost: getMinUsdtTransferCost(fees),
        summary: {
            minPrice: Math.min(siteFees?.minPrice, marketplaceOrders?.minPrice),
            maxPrice: Math.max(siteFees?.maxPrice, marketplaceOrders?.maxPrice),
            energyRange: '32k-10M',
            durationRange: '1h-30d'
        }
    };
}
```

**Layer 3: Market Normalizer** (`/apps/backend/src/modules/markets/market-normalizer.ts`)

This is where the magic happens: **every market automatically gets normalized pricing data**. When a fetcher returns raw data, the Market Normalizer processes it through all the layers and produces a complete `MarketDocument` with fully computed pricing details.

**How it works:**

Individual market fetchers don't need to worry about normalization, energy regeneration calculations, or creating price matrices. They just return raw data in whatever format their API provides:

- Brutus Finance: "5.0 TRX per 100K energy for 5 minutes"
- TronSave: "57 SUN per unit for 1 hour"
- Tron Energy Market: Different format entirely

The `MarketNormalizer.normalize()` method automatically:
1. Takes the raw `fees` and `orders` arrays from the snapshot
2. Calls `computePricingDetail()` to process them through Layers 1 and 2
3. Returns a `MarketDocument` with complete `pricingDetail` field

```typescript
export class MarketNormalizer {
    static normalize(snapshot: MarketSnapshot, reliability?: number): MarketDocument {
        const availabilityPercent = snapshot.availabilityPercent
            ?? this.calculateAvailability(snapshot);

        // THIS is where every market gets its normalized pricing
        const pricingDetail = computePricingDetail(snapshot.fees, snapshot.orders);

        return {
            guid: snapshot.guid,
            name: snapshot.name,
            energy: snapshot.energy,
            fees: snapshot.fees,           // Original raw data preserved
            orders: snapshot.orders,       // Original raw data preserved
            pricingDetail,                 // ← Fully normalized pricing!
            availabilityPercent,
            lastUpdated: new Date().toISOString(),
            isActive: snapshot.isActive
        };
    }
}
```

**The result:** Every `MarketDocument` contains:

```typescript
{
    guid: 'brutus-finance',
    fees: [...],                    // Raw data from fetcher
    orders: [...],                  // Raw data from fetcher
    pricingDetail: {                // ← Automatically computed!
        siteFees: {
            points: [...],          // Price matrix for platform fees
            minPrice: 0.49,
            maxPrice: 3.58
        },
        marketplaceOrders: { ... }, // Price matrix for P2P orders (if any)
        usdtTransferCosts: [        // Real-world transfer costs
            { durationMinutes: 5, costTrx: 3.25 },
            { durationMinutes: 1440, costTrx: 4.92 },
            { durationMinutes: 10080, costTrx: 0.98 }  // ← With regeneration!
        ],
        minUsdtTransferCost: 0.49,  // Cheapest option across all durations
        summary: {
            minPrice: 0.49,
            maxPrice: 3.58,
            energyRange: "64k-1M",
            durationRange: "5m-14d"
        }
    }
}
```

**Key benefits:**

✅ **Consistent** - All markets use identical normalization logic
✅ **Automatic** - Fetchers don't implement any pricing calculations
✅ **Regeneration-aware** - `usdtTransferCosts` already accounts for daily energy refills
✅ **Comparable** - All prices normalized to standard buckets and units
✅ **Complete** - Both platform fees and marketplace orders in one structure

### 3. Frontend Display

The frontend receives fully normalized `MarketDocument` objects and displays them in a leaderboard table with expandable row details.

**Main table columns** (`/apps/frontend/features/markets/components/MarketTable.tsx`):

| Column | Description | Calculation |
|--------|-------------|-------------|
| **Market** | Market name and supported regions | Direct from `market.name` |
| **TRX per USDT TX** | Minimum cost to send 1 USDT transfer | `market.pricingDetail.minUsdtTransferCost` |
| **Price Range** | Best and worst deals across all durations | Shows lowest and highest `usdtTransferCosts` with durations |
| **Availability** | Percentage of total energy currently available | `(available / total) * 100` |
| **Open Orders** | Count of active P2P marketplace orders | `market.orders.length` |
| **Updated** | Time of last market data fetch | `market.lastUpdated` formatted as time |

**Price Range column logic:**

```typescript
// Sort by duration, then by price
const sorted = [...market.pricingDetail.usdtTransferCosts].sort((a, b) => {
    if (a.durationMinutes !== b.durationMinutes) {
        return a.durationMinutes - b.durationMinutes;
    }
    return a.costTrx - b.costTrx;
});

// Find lowest and highest cost
const lowestCost = sorted.reduce((min, c) => c.costTrx < min.costTrx ? c : min, sorted[0]);
const highestCost = sorted.reduce((max, c) => c.costTrx > max.costTrx ? c : max, sorted[0]);

// Display:
// 3.45 TRX/tx @ 1h
// 8.20 TRX/tx @ 3d
```

**Expandable row details:**

Clicking a row reveals two sections (when data is available):

1. **USDT Transfer Cost (65k energy)** - Shows the cost for a single USDT transfer at each available duration:
   ```
   1 USDT transfer @ 1h    3.45000000 TRX
   1 USDT transfer @ 1d    5.60000000 TRX
   1 USDT transfer @ 3d    8.20000000 TRX
   ```

2. **Platform Pricing** - Shows sample pricing for different energy amounts normalized to "TRX per transfer":
   ```
   1 USDT tx @ 1h      3.4500 TRX/tx
   2 USDT tx @ 1h      3.3000 TRX/tx (bulk discount)
   15 USDT tx @ 1h     2.9500 TRX/tx (larger bulk discount)
   ```

**Why some markets show N/A:**

Markets like Tronify only provide P2P orders without fixed site fees. Without `fees` data, the calculator cannot compute `minUsdtTransferCost`, so the table shows "N/A" for those columns. The "Open Orders" column will still show order counts.

## Energy Amount Context in Calculations

The `energyAmount` field in `MarketFee` provides critical context for pricing calculations:

```typescript
interface MarketFee {
    minutes?: number;        // Duration
    sun?: number;           // Price PER UNIT of energy
    energyAmount?: number;  // Energy amount this fee applies to (e.g., 1_000_000)
}
```

**Why energyAmount matters:**

Markets quote prices at specific energy amounts. TronSave quotes "57 SUN for 1M energy at 1 hour." This means:

- `fee.sun = 57` (price per unit)
- `fee.energyAmount = 1_000_000` (quoted amount)
- `fee.minutes = 60` (1 hour)

To calculate the cost for a USDT transfer (65k energy):

```typescript
const totalSun = fee.sun * 65_000;  // 57 * 65,000 = 3,705,000 SUN
const costTrx = totalSun / 1_000_000;  // 3.705 TRX
```

The `energyAmount` field is primarily metadata showing what bundle size the market typically sells. It does **not** affect USDT transfer calculations because `fee.sun` is already normalized to per-unit pricing.

## Error Handling and Resilience

The market system includes multiple layers of error handling to ensure reliable operation despite upstream API failures:

### Fetcher-Level Error Handling

**BaseMarketFetcher** provides automatic error handling for all market fetchers:

```typescript
async fetch(): Promise<MarketSnapshot | null> {
    try {
        const snapshot = await this.pull(context);

        if (!snapshot) {
            logger.warn(`Fetcher ${this.name} returned null snapshot`);
            return null;
        }

        // Validate snapshot structure
        const validation = MarketSnapshotSchema.safeParse(snapshot);
        if (!validation.success) {
            logger.error(`Invalid snapshot from ${this.name}:`, validation.error);
            return null;
        }

        return validation.data;
    } catch (error) {
        // Check if error is fatal (SSL expiry, DNS failure)
        if (this.shouldDeactivateMarket(error)) {
            logger.error(`Fatal error for ${this.name}, deactivating market`);
            return { ...lastSnapshot, isActive: false };
        }

        logger.error(`Fetch error for ${this.name}:`, error);
        return null;
    }
}
```

**Key behaviors:**
- **Null handling** - Fetchers return `null` on error, preserving last known good data
- **Validation** - Zod schema validation catches malformed data before storage
- **Fatal error detection** - SSL/DNS failures automatically deactivate markets
- **Structured logging** - All errors include market name and context for debugging

### HTTP Retry Logic

All fetchers use exponential backoff for upstream API calls:

- **3 retry attempts** with delays: 500ms, 1s, 2s
- **Automatic backoff** doubles delay on each retry
- **Prometheus metrics** track retry counts per market (`tronrelic_market_fetch_retry_total`)
- **Request timeouts** configurable per fetcher (default: 10 seconds)

**Example from retry implementation:**
```typescript
async function executeWithRetry<T>(
    fn: () => Promise<T>,
    retries = 3,
    delayMs = 500
): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === retries) throw error;

            await sleep(delayMs);
            delayMs *= 2;  // Exponential backoff
        }
    }
}
```

### Graceful Degradation

When fetchers fail, the system degrades gracefully:

1. **Preserve last known data** - MongoDB retains previous snapshot until new fetch succeeds
2. **Mark as stale** - `lastUpdated` timestamp allows frontend to warn users about old data
3. **Continue serving** - API responses include stale data with warnings rather than failing completely
4. **Automatic reactivation** - Next successful fetch reactivates deactivated markets

### Monitoring and Alerting

Prometheus metrics enable proactive error detection:

**Key metrics:**
- `tronrelic_market_fetch_retry_total` - Retry count per market (high values indicate API instability)
- `tronrelic_market_availability_percent` - Market availability (drops indicate capacity issues)
- `tronrelic_market_reliability_score` - Computed reliability metric (tracks uptime)

**Alert thresholds (from `ops/observability/alert.rules.yml`):**
- Fetcher failure spike: > 10 failures in 5 minutes
- Sustained availability drop: < 60% for 15 minutes
- Stalled scheduler: No fetches for 20 minutes

See [market-system-operations.md](./market-system-operations.md#troubleshooting) for incident response procedures.

## Technical Reference

### Key Backend Files

- `/apps/backend/src/modules/markets/fetchers/base/base-fetcher.ts` - Abstract fetcher base class
- `/apps/backend/src/modules/markets/fetchers/types.ts` - Fetcher interfaces and context
- `/apps/backend/src/modules/markets/usdt-transfer-calculator.ts` - USDT transfer cost calculations
- `/apps/backend/src/modules/markets/pricing-matrix-calculator.ts` - Pricing grid generation
- `/apps/backend/src/modules/markets/market-normalizer.ts` - Snapshot to document transformation
- `/apps/backend/src/modules/markets/dtos/market-snapshot.dto.ts` - Zod validation schema
- `/apps/backend/src/modules/markets/fetchers/implementations/` - Individual market fetchers

**Implementation guides:**

- [market-fetcher-discovery.md](./market-fetcher-discovery.md) - Step-by-step guide for discovering and implementing new market fetchers

### Key Frontend Files

- `/apps/frontend/features/markets/components/MarketTable.tsx` - Main leaderboard display
- `/apps/frontend/features/markets/slice.ts` - Redux state management

### Shared Type Definitions

- `/packages/shared/src/types/market.ts` - Core market interfaces
- `/packages/shared/src/types/market-pricing-matrix.ts` - Pricing grid types and constants

## Example: Full Data Flow

### Example 1: Short Duration (No Regeneration)

**1. Fetcher captures raw data (TronSave - 1 hour rental):**

```typescript
// API returns: 1M energy for 1 hour = 57 SUN per unit
{ minutes: 60, sun: 57, energyAmount: 1_000_000 }
```

**2. USDT transfer calculator normalizes to practical cost:**

```typescript
calculateUsdtTransferCost(57, 1_000_000, false, 60)
// Total cost: 57 SUN/unit × 65,000 units = 3,705,000 SUN = 3.705 TRX
// Duration: 60 minutes = 0.04 days (< 1 day, so regenerationCycles = 1)
// Cost per transfer: 3.705 TRX / 1 = 3.705 TRX
```

**Result:** 3.705 TRX per USDT transfer (no regeneration benefit)

### Example 2: Multi-Day Rental (With Regeneration)

**1. Fetcher captures raw data (7-day rental):**

```typescript
// API returns: 65k energy for 7 days = 538.46 SUN per unit
{ minutes: 10080, sun: 538.46, energyAmount: 65_000 }
```

**2. USDT transfer calculator accounts for regeneration:**

```typescript
calculateUsdtTransferCost(538.46, 65_000, false, 10080)
// Total cost: 538.46 SUN/unit × 65,000 units = 35,000,000 SUN = 35 TRX
// Duration: 10,080 minutes = 7 days
// Regeneration cycles: floor(7) = 7 transfers possible
// Cost per transfer: 35 TRX / 7 = 5.0 TRX
```

**Result:** 5.0 TRX per USDT transfer (7x better value due to energy regeneration!)

### Why Energy Regeneration Matters

**Without accounting for regeneration:**
- 7-day rental at 35 TRX total → Incorrectly calculated as 35 TRX per transfer

**With regeneration accounting:**
- 7-day rental at 35 TRX total → Correctly calculated as 5 TRX per transfer (7 transfers possible)

This is why longer-duration rentals appear much cheaper in the market leaderboard—they truly are more cost-effective because you can use the energy multiple times as it regenerates daily.

**3. Pricing matrix calculates normalized unit price:**

```typescript
normalizePricePerUnit(3.705, 65_000, 3600)
// 3.705 / ((65,000 / 32,000) × (3600 / 86400)) = 1.86 TRX per 32k energy per day
```

**4. Frontend displays:**

- **TRX per USDT TX:** 3.705
- **Price Range:** "3.705 TRX/tx @ 1h" (if only one duration available)
- **Expandable details:** "1 USDT transfer @ 1h → 3.70500000 TRX"

## Adding a New Market Fetcher

For complete guidance on adding a new market, see [market-fetcher-discovery.md](./market-fetcher-discovery.md), which covers:

- API discovery techniques (network inspection, JavaScript analysis, Playwright automation)
- Data structure analysis and interface design
- Transformation logic with correct duration and price normalization
- Verification procedures and common pitfalls

The normalization pipeline automatically handles regeneration calculations, price conversions, and leaderboard integration once the fetcher provides raw data.
