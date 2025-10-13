# Chain Parameters Service

TronRelic's Chain Parameters Service maintains fresh TRON network parameters for accurate energy/TRX conversions. This service polls the blockchain every 10 minutes and provides cached conversion methods used throughout the application.

## Why This Matters

Market fetchers and other features need to convert between TRX amounts and energy values based on current network conditions. The TRON network's energy-to-TRX ratio is not fixed—it fluctuates based on:

- Total energy available on the network (`totalEnergyLimit`)
- Total TRX frozen/staked for energy across all accounts (`totalFrozenForEnergy`)
- Current energy burn fee (`energyFee`)

**Risk of ignoring this system:**

Without fresh chain parameters, the application would use stale or inaccurate conversion ratios. This leads to:

- Incorrect market pricing comparisons (showing wrong TRX costs for energy rentals)
- Inaccurate APY calculations for energy rental deals
- Misleading cost estimates for USDT transfers
- Poor user experience when comparing energy marketplace options

**Why the old system was replaced:**

The legacy `TrEnergyAdapter` used hardcoded approximations from a JavaScript configuration file. Network conditions change daily, making static values unreliable. The new service fetches live data from the blockchain and stores it in MongoDB for fast cached access.

## How It Works

The Chain Parameters Service follows a scheduled fetch → store → serve pattern:

```
┌──────────────────────────────────────────────────────────┐
│ Every 10 minutes: Scheduler triggers fetch job           │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│ ChainParametersFetcher                                    │
│ • Polls TronGrid /wallet/getchainparameters              │
│ • Extracts totalEnergyLimit, energyFee                   │
│ • Calculates energyPerTrx ratio                          │
│ • Saves to MongoDB chainParameters collection            │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│ ChainParametersService                                    │
│ • Reads latest parameters from MongoDB                   │
│ • Caches in memory for 1 minute                          │
│ • Provides conversion methods:                           │
│   - getEnergyFromTRX(trx)                                │
│   - getTRXFromEnergy(energy)                             │
│   - getAPY(energy, sun, days)                            │
│   - getEnergyFee()                                       │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│ Market Fetchers / Other Consumers                        │
│ • Access via MarketFetcherContext.trEnergy               │
│ • Convert prices between TRX and energy                  │
│ • Calculate APY for rental deals                         │
└──────────────────────────────────────────────────────────┘
```

### Workflow Details

**1. Scheduled Fetch (Every 10 Minutes)**

The scheduler registers a cron job that triggers the fetcher:

```typescript
// apps/backend/src/jobs/index.ts
scheduler.register('chain-parameters:fetch', '*/10 * * * *', async () => {
    await chainParametersFetcher.fetch();
});
```

**2. Fetcher Polls TronGrid API**

`ChainParametersFetcher` makes a POST request to TronGrid's chain parameters endpoint:

- **Endpoint**: `https://api.trongrid.io/wallet/getchainparameters`
- **Returns**: Array of `{ key: string, value: number }` parameter objects
- **Extracted values**: `getTotalEnergyLimit`, `getTotalEnergyCurrentLimit`, `getEnergyFee`

**3. Calculate Derived Ratio**

The fetcher calculates `energyPerTrx` using the formula:

```
energyPerTrx = totalEnergyLimit / (totalFrozenForEnergy / 1_000_000)
```

Where:
- `totalEnergyLimit` - Total network energy available (e.g., 180 billion)
- `totalFrozenForEnergy` - Total TRX staked for energy in SUN (e.g., 32 million TRX = 32,000,000,000,000 SUN)
- Result: Energy units per 1 TRX when staking (typically ~5,625 energy/TRX)

**Note**: `totalFrozenForEnergy` currently uses a conservative network-wide estimate of 32 million TRX. A future enhancement could query validator account resources for a more precise calculation.

**4. Store in MongoDB**

Parameters are saved to the `chainParameters` collection:

```typescript
{
    network: 'mainnet',
    parameters: {
        totalEnergyLimit: 180_000_000_000,
        totalEnergyCurrentLimit: 180_000_000_000,
        totalFrozenForEnergy: 32_000_000_000_000_000,  // 32M TRX in SUN
        energyPerTrx: 5625,
        energyFee: 100
    },
    fetchedAt: new Date(),
    createdAt: new Date()
}
```

The collection maintains a time series of parameter snapshots indexed by `network` and `fetchedAt` for efficient querying.

**5. Service Layer Caches and Serves**

`ChainParametersService` provides a cached interface:

- **Cache TTL**: 1 minute (balances freshness vs database load)
- **Query pattern**: Finds latest mainnet parameters sorted by `fetchedAt` descending
- **Fallback**: Returns conservative estimates if database is empty (e.g., during first boot)

## Using the Service

The Chain Parameters Service implements `IChainParametersService` and provides four primary methods.

### Getting Latest Parameters

```typescript
import { ChainParametersService } from '../chain-parameters/chain-parameters.service.js';

const chainParams = new ChainParametersService();
const params = await chainParams.getParameters();

console.log(params);
// {
//   network: 'mainnet',
//   parameters: {
//     totalEnergyLimit: 180000000000,
//     energyPerTrx: 5625,
//     energyFee: 100,
//     ...
//   },
//   fetchedAt: 2025-10-11T12:30:00.000Z,
//   createdAt: 2025-10-11T12:30:05.123Z
// }
```

### Converting TRX to Energy

Used when you know how much TRX a user is spending and need to calculate equivalent energy:

```typescript
const trxAmount = 10; // User has 10 TRX to spend
const energy = chainParams.getEnergyFromTRX(trxAmount);

console.log(energy);
// 56250 energy (10 TRX × 5625 energy/TRX)
```

**Use case**: Validating market pricing quotes where markets specify "X TRX buys Y energy."

### Converting Energy to TRX

Used when you know the energy requirement and need to calculate TRX cost:

```typescript
const requiredEnergy = 65_000; // USDT transfer requires 65k energy
const trxCost = chainParams.getTRXFromEnergy(requiredEnergy);

console.log(trxCost);
// 11.56 TRX (65,000 energy / 5625 energy/TRX)
```

**Use case**: Showing users how much TRX they would need to stake to obtain specific energy amounts.

### Calculating Rental APY

Used to compare the cost-effectiveness of renting energy vs staking TRX:

```typescript
const energyRented = 1_000_000;  // 1M energy
const rentalPrice = 57;          // 57 SUN per energy unit
const rentalDays = 7;            // 7-day rental

const apy = chainParams.getAPY(energyRented, rentalPrice, rentalDays);

console.log(apy);
// 15.5 (representing 15.5% APY)
```

**How APY is calculated:**

1. Calculate TRX equivalent of rented energy: `trx = energy / energyPerTrx`
2. Calculate total rental cost in TRX: `cost = (energy × sun) / 1_000_000`
3. Calculate daily return rate: `dailyReturn = cost / days / trx`
4. Annualize: `APY = dailyReturn × 365 × 100`

**Use case**: Displaying APY percentages next to market rental offers so users can compare deals.

### Getting Current Energy Fee

Used to determine the SUN cost per energy unit when burning energy (no staking):

```typescript
const energyFee = chainParams.getEnergyFee();

console.log(energyFee);
// 100 (SUN per energy unit)
```

**Use case**: Calculating the cost of transactions when users don't have staked energy and must burn TRX directly.

## Integration with Market Fetchers

Market fetchers receive the Chain Parameters Service via `MarketFetcherContext`:

```typescript
// apps/backend/src/modules/markets/fetchers/types.ts
export interface MarketFetcherContext {
    http: AxiosInstance;
    logger: Logger;
    cacheTtlSeconds: number;
    trEnergy: IChainParametersService | null;  // ← Chain Parameters Service
}
```

**Example usage in a market fetcher:**

```typescript
async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    const response = await context.http.get('https://market-api.com/pricing');

    // Market quotes "100 TRX for 7 days"
    const trxPrice = 100;
    const durationDays = 7;

    // Convert to energy amount
    const energyAmount = context.trEnergy?.getEnergyFromTRX(trxPrice) ?? 0;

    // Calculate APY to display alongside pricing
    const apy = context.trEnergy?.getAPY(
        energyAmount,
        response.data.sunPerUnit,
        durationDays
    ) ?? 0;

    return {
        guid: this.guid,
        name: this.name,
        fees: [{
            minutes: durationDays * 1440,
            sun: response.data.sunPerUnit,
            energyAmount,
            apy  // Include APY in snapshot
        }],
        isActive: true
    };
}
```

**Why market fetchers need this:**

- Markets quote prices in wildly different formats (TRX, SUN, per-hour, per-day, per-million-energy)
- Normalization requires converting all quotes to a common baseline
- Accurate conversions depend on real-time network conditions
- APY calculations help users compare rental value vs staking value

## Database Schema

The `chainParameters` collection stores parameter snapshots over time:

```typescript
// apps/backend/src/database/models/chain-parameters-model.ts
{
    network: 'mainnet' | 'testnet',  // Indexed for filtering
    parameters: {
        totalEnergyLimit: number,           // Network energy capacity
        totalEnergyCurrentLimit: number,    // Current adjusted limit
        totalFrozenForEnergy: number,       // Total TRX staked (SUN)
        energyPerTrx: number,              // Derived ratio for conversions
        energyFee: number                  // Burn cost (SUN per energy)
    },
    fetchedAt: Date,    // When polled from blockchain (indexed)
    createdAt: Date     // When saved to DB (auto-generated)
}
```

**Indexes:**

- `{ network: 1, fetchedAt: -1 }` - Efficiently retrieves latest parameters for a network
- `{ network: 1 }` - Filters by network type
- `{ fetchedAt: 1 }` - Orders by fetch time for time-series queries

**Data retention:**

The system currently keeps all historical snapshots. A future enhancement could implement cleanup logic to prune records older than 30 days, retaining only daily snapshots for historical analysis.

## Caching Strategy

The service uses a two-tier caching strategy:

### Tier 1: In-Memory Cache (1-Minute TTL)

- **Purpose**: Avoid repeated database queries during the same scheduler cycle
- **Implementation**: Simple timestamp-based expiry in `ChainParametersService`
- **Benefit**: Market fetchers can call conversion methods hundreds of times per run without database load

```typescript
private cachedParams: IChainParameters | null = null;
private cacheExpiry: number = 0;
private readonly CACHE_TTL_MS = 60_000;  // 1 minute

async getParameters(): Promise<IChainParameters> {
    if (this.cacheExpiry < Date.now()) {
        this.cachedParams = await ChainParametersModel.findOne({ network: 'mainnet' })
            .sort({ fetchedAt: -1 })
            .lean();
        this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
    }
    return this.cachedParams!;
}
```

### Tier 2: Database Storage (10-Minute Refresh)

- **Purpose**: Persist parameters across service restarts and share between instances
- **Implementation**: MongoDB collection updated by scheduled fetcher job
- **Benefit**: Fast queries via indexed lookups, supports future multi-instance deployments

**Why two tiers?**

- **Freshness vs performance**: 10-minute blockchain polls keep data current without overwhelming TronGrid API
- **Read optimization**: In-memory cache prevents database queries on every conversion (which happen thousands of times per market refresh cycle)
- **Fault tolerance**: Database persists parameters if service crashes, avoiding fallback to stale estimates

## Fallback Behavior

When the database is empty (e.g., first boot before the fetcher runs), the service returns conservative fallback parameters:

```typescript
{
    network: 'mainnet',
    parameters: {
        totalEnergyLimit: 180_000_000_000,           // 180B energy
        totalEnergyCurrentLimit: 180_000_000_000,
        totalFrozenForEnergy: 32_000_000_000_000_000, // 32M TRX in SUN
        energyPerTrx: 5625,                          // Approximate ratio
        energyFee: 100
    },
    fetchedAt: new Date(),
    createdAt: new Date()
}
```

**When fallback is used:**

- Fresh installation before first scheduled fetch completes
- Database connection failure
- MongoDB collection accidentally dropped

**Why these specific values:**

- Based on historical TRON network averages over the past year
- Conservative estimates that slightly overestimate TRX costs (safe for pricing calculations)
- Prevents service failures while scheduler catches up

**Observability:**

Fallback usage is logged at `WARN` level so operators can monitor for persistent database issues:

```
WARN: No chain parameters found in database, using fallback
```

## Scheduler Configuration

Chain parameters fetching is registered in the main scheduler:

```typescript
// apps/backend/src/jobs/index.ts
scheduler.register('chain-parameters:fetch', '*/10 * * * *', async () => {
    await chainParametersFetcher.fetch();
});
```

**Schedule**: `*/10 * * * *` (every 10 minutes)

**Why 10 minutes:**

- **Network stability**: TRON chain parameters change gradually over hours/days, not seconds
- **API conservation**: Reduces load on TronGrid API while maintaining adequate freshness
- **Cache alignment**: Works well with the 1-minute in-memory cache (9 cache hits before database refresh)
- **Monitoring window**: Provides time to detect and alert on fetch failures before stale data impacts users

**Fetch execution time**: Typically completes in 200-500ms including API call, calculation, and database write.

## Key Interfaces

### IChainParameters

Core data model representing TRON network state:

```typescript
// packages/types/src/chain-parameters/IChainParameters.ts
interface IChainParameters {
    network: 'mainnet' | 'testnet';
    parameters: {
        totalEnergyLimit: number;
        totalEnergyCurrentLimit: number;
        totalFrozenForEnergy: number;
        energyPerTrx: number;          // Derived ratio
        energyFee: number;
    };
    fetchedAt: Date;
    createdAt: Date;
}
```

### IChainParametersService

Service contract for accessing parameters and performing conversions:

```typescript
// packages/types/src/chain-parameters/IChainParametersService.ts
interface IChainParametersService {
    getParameters(): Promise<IChainParameters>;
    getEnergyFromTRX(trx: number): number;
    getTRXFromEnergy(energy: number): number;
    getAPY?(energy: number, sun: number, days: number): number;
    getEnergyFee(): number;
}
```

### IChainParametersFetcher

Fetcher contract for polling blockchain:

```typescript
// packages/types/src/chain-parameters/IChainParametersFetcher.ts
interface IChainParametersFetcher {
    fetch(): Promise<IChainParameters>;
}
```

**Type location rationale:**

All interfaces live in `@tronrelic/types` because they are framework-independent core models that can be shared across frontend, backend, and plugins without circular dependencies.

## Technical Reference

### Backend Implementation Files

- **Service**: `/apps/backend/src/modules/chain-parameters/chain-parameters.service.ts`
  - Provides cached access to parameters
  - Implements conversion methods
  - Handles fallback logic

- **Fetcher**: `/apps/backend/src/modules/chain-parameters/chain-parameters-fetcher.ts`
  - Polls TronGrid API
  - Calculates derived ratios
  - Saves to MongoDB

- **Database Model**: `/apps/backend/src/database/models/chain-parameters-model.ts`
  - Mongoose schema and indexes
  - MongoDB collection structure

- **Scheduler Registration**: `/apps/backend/src/jobs/index.ts`
  - Cron job configuration
  - Fetcher instantiation

### Type Definitions

- **Interfaces**: `/packages/types/src/chain-parameters/`
  - `IChainParameters.ts` - Core data model
  - `IChainParametersService.ts` - Service contract
  - `IChainParametersFetcher.ts` - Fetcher contract

- **Exports**: `/packages/types/src/index.ts`
  - Re-exports all chain parameter types for easy importing

### Integration Points

- **Market Fetcher Context**: `/apps/backend/src/modules/markets/fetchers/types.ts`
  - Provides `trEnergy: IChainParametersService` to all market fetchers
  - Legacy alias `TrEnergyAdapter` for backward compatibility

- **Market Aggregator**: `/apps/backend/src/modules/markets/market-aggregator.ts`
  - Instantiates `ChainParametersService`
  - Passes to fetcher context during market refresh cycles

## Example: Complete Workflow

**Scenario**: A market fetcher needs to normalize pricing from an API that quotes "100 TRX for 1 million energy for 7 days."

**1. Scheduled fetch updates parameters (runs automatically every 10 minutes):**

```typescript
// Scheduler triggers ChainParametersFetcher
const params = await chainParametersFetcher.fetch();
// Saves to MongoDB: { energyPerTrx: 5625, energyFee: 100, ... }
```

**2. Market fetcher runs (triggered by separate market scheduler every 5 minutes):**

```typescript
async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    // Fetch from market API
    const response = await context.http.get('https://market.com/api/pricing');
    // Returns: { trx: 100, energy: 1_000_000, days: 7 }

    // Verify conversion matches market's claim
    const expectedEnergy = context.trEnergy?.getEnergyFromTRX(100) ?? 0;
    // 100 TRX × 5625 energy/TRX = 562,500 energy

    if (expectedEnergy !== response.data.energy) {
        context.logger.warn(
            { expected: expectedEnergy, actual: response.data.energy },
            'Market energy claim does not match network conversion ratio'
        );
    }

    // Calculate price per energy unit for normalization
    const sunPerUnit = (response.data.trx * 1_000_000) / response.data.energy;
    // (100 TRX × 1,000,000 SUN/TRX) / 1,000,000 energy = 100 SUN per energy

    // Calculate APY for display
    const apy = context.trEnergy?.getAPY(
        response.data.energy,
        sunPerUnit,
        response.data.days
    ) ?? 0;

    return {
        guid: this.guid,
        name: 'Example Market',
        fees: [{
            minutes: response.data.days * 1440,  // 7 days = 10,080 minutes
            sun: sunPerUnit,                      // 100 SUN per energy unit
            energyAmount: response.data.energy    // 1,000,000 energy
        }],
        isActive: true
    };
}
```

**3. Normalization pipeline converts to USDT transfer cost:**

The market snapshot flows through the normalization layers (see [market-system-architecture.md](../markets/market-system-architecture.md) for details):

```typescript
// USDT transfer calculator uses fee.sun and fee.minutes
calculateUsdtTransferCost(100, 1_000_000, false, 10080);
// Total cost: 100 SUN/unit × 65,000 units = 6,500,000 SUN = 6.5 TRX
// Regeneration: 10,080 minutes = 7 days
// Cost per transfer: 6.5 TRX / 7 = 0.93 TRX per USDT transfer
```

**4. Frontend displays normalized pricing:**

```
Market Name: Example Market
TRX per USDT TX: 0.93 TRX
Price Range: 0.93 TRX/tx @ 7d
APY: 15.5%
```

**Why this works:**

- Fresh chain parameters ensure `energyPerTrx` reflects current network state
- Market fetcher validates that API claims match blockchain reality
- Normalization pipeline uses accurate ratios to calculate per-transfer costs
- Users see comparable pricing across all markets regardless of original quote format

## Migration from Legacy System

**Previous implementation:**

The legacy `TrEnergyAdapter` used hardcoded values from a JavaScript configuration file:

```javascript
// OLD: packages/shared/src/tr-energy.ts
class TrEnergyAdapter {
    getEnergyFromTRX(trx: number): number {
        return Math.floor(trx * 5625);  // Hardcoded ratio
    }
}
```

**Problems with legacy approach:**

- No automatic updates when network conditions changed
- Required manual code deployments to update ratios
- No historical tracking of parameter changes
- Single point of failure (incorrect hardcoded value affected all markets)

**Migration path:**

The new system maintains backward compatibility via type aliasing:

```typescript
// apps/backend/src/modules/markets/fetchers/types.ts
export type TrEnergyAdapter = IChainParametersService;

export interface MarketFetcherContext {
    trEnergy: IChainParametersService | null;  // Same property name as legacy
}
```

**Migration steps completed:**

1. Created `@tronrelic/types` interfaces for chain parameters
2. Implemented `ChainParametersService` with same method signatures as legacy adapter
3. Added `ChainParametersFetcher` with TronGrid API integration
4. Registered scheduler job for automatic updates
5. Updated `MarketAggregator` to instantiate new service
6. Maintained `trEnergy` property name in fetcher context for drop-in replacement

**Result:** All market fetchers continue to work without modification, now using live blockchain data instead of static configuration.

## Future Enhancements

### Precise Frozen TRX Calculation

**Current limitation**: The fetcher uses an estimated 32 million TRX for `totalFrozenForEnergy`.

**Enhancement**: Query actual staked amounts from validator account resources:

```typescript
// Proposed enhancement
async calculateTotalFrozenForEnergy(): Promise<number> {
    const validators = await this.getValidatorList();
    let totalFrozen = 0;

    for (const validator of validators) {
        const account = await this.getAccountResource(validator.address);
        totalFrozen += account.frozenBalanceForEnergy || 0;
    }

    return totalFrozen;
}
```

**Benefit**: More accurate `energyPerTrx` ratio for conversions.

### Historical Parameter Tracking

**Current limitation**: Database stores all snapshots indefinitely without cleanup.

**Enhancement**: Implement retention policy with downsampling:

```typescript
// Proposed enhancement
scheduler.register('chain-parameters:cleanup', '0 2 * * *', async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Keep daily snapshots, delete the rest
    await ChainParametersModel.deleteMany({
        fetchedAt: { $lt: thirtyDaysAgo },
        // Keep one snapshot per day (implementation details omitted)
    });
});
```

**Benefit**: Reduced database size while retaining historical trend data for analytics.

### Parameter Change Alerts

**Current limitation**: No notification when parameters change significantly.

**Enhancement**: Add threshold-based alerting:

```typescript
// Proposed enhancement
async fetch(): Promise<IChainParameters> {
    const newParams = await this.fetchFromBlockchain();
    const previousParams = await this.getLatestParams();

    // Alert if energyPerTrx changes by more than 5%
    const ratioChange = Math.abs(
        (newParams.parameters.energyPerTrx - previousParams.parameters.energyPerTrx)
        / previousParams.parameters.energyPerTrx
    );

    if (ratioChange > 0.05) {
        await alertService.notify({
            level: 'warning',
            message: `Energy ratio changed by ${(ratioChange * 100).toFixed(1)}%`,
            data: { previous: previousParams, current: newParams }
        });
    }

    return newParams;
}
```

**Benefit**: Operators can investigate unexpected parameter shifts that might indicate network issues.

## Related Documentation

- **[market-system-architecture.md](../markets/market-system-architecture.md)** - How market fetchers use chain parameters for price normalization
- **[plugins.md](../plugins/plugins.md)** - General plugin architecture (if future plugins need chain parameters)
- **[environment.md](../environment.md)** - TronGrid API configuration and rate limiting
