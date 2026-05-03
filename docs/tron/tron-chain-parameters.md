# Chain Parameters Service

`ChainParametersService` keeps TRON network parameters fresh for energy/TRX conversions and APY math. Polls TronGrid every 10 minutes, persists to MongoDB, caches in memory for 1 minute.

## Why This Matters

TRON's energy-to-TRX ratio drifts daily with total staked TRX and network energy limits. Market fetchers, cost calculators, and APY displays all consume this ratio — hardcoding it produces wrong prices the moment the network shifts. Replaced the legacy static `TrEnergyAdapter` for this reason.

## How It Works

A scheduled fetcher polls TronGrid, derives `energyPerTrx`, and writes a snapshot to MongoDB. The service reads the latest snapshot, caches it in memory for 1 minute, and exposes conversion methods. Market fetchers receive the service via `MarketFetcherContext.trEnergy`.

### Cached Fields

<a id="energy-system"></a>

| Field | Source | Purpose | Refresh |
|---|---|---|---|
| `totalEnergyLimit` | `getTotalEnergyLimit` chain param | Network energy capacity (~180B) | 10 min |
| `totalEnergyCurrentLimit` | `getTotalEnergyCurrentLimit` | Current adjusted limit | 10 min |
| `totalFrozenForEnergy` | Conservative estimate (32M TRX in SUN) | Denominator for `energyPerTrx` | 10 min |
| `energyPerTrx` | Derived: `totalEnergyLimit / (totalFrozenForEnergy / 1_000_000)` | Conversion ratio (~5,625 energy/TRX) | 10 min |
| `energyFee` | `getEnergyFee` chain param | Burn cost when no staked energy (100 SUN/unit) | 10 min |

`totalFrozenForEnergy` currently uses a 32M TRX estimate; precise calculation from validator account resources is a known follow-up. Until then `energyPerTrx` slightly overestimates TRX cost — safe for pricing.

### Why 10 Minutes

Chain parameters drift over hours, not seconds. 10 minutes balances freshness against TronGrid quota and pairs with the 1-minute in-memory cache (9 cache hits per refresh). Fetch completes in 200–500ms.

### MongoDB Caching and Fallback

Snapshots persist to the `chainParameters` collection (indexed `{ network, fetchedAt: -1 }`) so parameters survive restarts and can be shared across instances. If the collection is empty (fresh install, dropped collection, DB error), the service returns a hardcoded fallback (`energyPerTrx: 5625`, `energyFee: 100`) and logs `WARN: No chain parameters found in database, using fallback`. Fallback prevents startup failure while the scheduler catches up.

The in-memory cache is a simple TTL guard inside the service:

```typescript
private cachedParams: IChainParameters | null = null;
private cacheExpiry: number = 0;
private readonly CACHE_TTL_MS = 60_000;

async getParameters(): Promise<IChainParameters> {
    if (this.cacheExpiry < Date.now()) {
        this.cachedParams = await ChainParametersModel
            .findOne({ network: 'mainnet' })
            .sort({ fetchedAt: -1 })
            .lean();
        this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
    }
    return this.cachedParams!;
}
```

## Conversion Math

Never hardcode any of these formulas — call the service. All inputs/outputs are plain numbers; SUN-vs-TRX is the caller's responsibility.

| Method | Formula | Returns |
|---|---|---|
| `getEnergyFromTRX(trx)` | `trx × energyPerTrx` | Energy units |
| `getTRXFromEnergy(energy)` | `energy / energyPerTrx` | TRX |
| `getEnergyFee()` | (cached) | SUN per energy unit |
| `getAPY(energy, sun, days)` | see below | Percent (e.g. `15.5`) |

`getAPY` derivation:

1. `trx = energy / energyPerTrx` — TRX equivalent of the energy being rented.
2. `cost = (energy × sun) / 1_000_000` — total rental cost in TRX.
3. `dailyReturn = cost / days / trx` — daily return rate.
4. `APY = dailyReturn × 365 × 100`.

## USDT Parameters Service

`UsdtParametersService` is the parallel cache for USDT TRC20 transfer energy cost (`~65,000` units, dynamic). Always call `usdtParamsService.getUsdtTransferEnergyCost()` — never hardcode `65000`. USDT cost is fetched on its own scheduler (see `usdt-parameters:fetch`) and combines with `ChainParametersService` for transfer-cost normalization.

## Market Fetcher Integration

Fetchers receive the service through context:

```typescript
// src/backend/src/modules/markets/fetchers/types.ts
export interface MarketFetcherContext {
    http: AxiosInstance;
    logger: Logger;
    cacheTtlSeconds: number;
    trEnergy: IChainParametersService | null;
}
```

Markets quote prices in inconsistent units (TRX, SUN, per-hour, per-day, per-million-energy). The fetcher uses `trEnergy` to convert quotes to a common baseline (`sun` per energy unit, `minutes` of regeneration) and to compute APY for display:

```typescript
async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    const response = await context.http.get('https://market.com/api/pricing');
    const sunPerUnit = (response.data.trx * 1_000_000) / response.data.energy;
    const apy = context.trEnergy?.getAPY(
        response.data.energy,
        sunPerUnit,
        response.data.days
    ) ?? 0;
    return {
        guid: this.guid,
        name: this.name,
        fees: [{
            minutes: response.data.days * 1440,
            sun: sunPerUnit,
            energyAmount: response.data.energy,
            apy
        }],
        isActive: true
    };
}
```

The normalized snapshot then flows through the USDT transfer cost calculator (see [market-system-architecture.md](../markets/market-system-architecture.md)), which uses `fee.sun`, `fee.minutes`, and `usdtTransferEnergyCost` to produce per-transfer TRX cost across all markets.

## Rules

- Never hardcode `energyPerTrx`, `energyFee`, or `5625` / `100` / `65000` literals — call the service.
- Never bypass the in-memory cache; one method call per conversion is fine, the cache absorbs it.
- Treat `trEnergy` as nullable in fetcher contexts (`context.trEnergy?.getAPY(...) ?? 0`); the field is null until the first successful fetch on fresh installs.
- `IChainParametersService`, `IChainParameters`, `IChainParametersFetcher` live in `@/types` so frontend, backend, and plugins consume them without circular deps.

## Key Interfaces

```typescript
// packages/types/src/chain-parameters/
interface IChainParameters {
    network: 'mainnet' | 'testnet';
    parameters: {
        totalEnergyLimit: number;
        totalEnergyCurrentLimit: number;
        totalFrozenForEnergy: number;
        energyPerTrx: number;
        energyFee: number;
    };
    fetchedAt: Date;
    createdAt: Date;
}

interface IChainParametersService {
    getParameters(): Promise<IChainParameters>;
    getEnergyFromTRX(trx: number): number;
    getTRXFromEnergy(energy: number): number;
    getAPY?(energy: number, sun: number, days: number): number;
    getEnergyFee(): number;
}

interface IChainParametersFetcher {
    fetch(): Promise<IChainParameters>;
}
```

## Implementation Files

| File | Role |
|---|---|
| `src/backend/src/modules/chain-parameters/chain-parameters.service.ts` | Cached service + conversion methods + fallback |
| `src/backend/src/modules/chain-parameters/chain-parameters-fetcher.ts` | Polls TronGrid, derives ratio, writes snapshot |
| `src/backend/src/database/models/chain-parameters-model.ts` | Mongoose schema + indexes |
| `src/backend/src/jobs/index.ts` | Registers `chain-parameters:fetch` cron `*/10 * * * *` |
| `src/backend/src/modules/markets/fetchers/types.ts` | `MarketFetcherContext.trEnergy` injection point |
| `src/backend/src/modules/markets/market-aggregator.ts` | Instantiates service, passes to fetcher context |
| `packages/types/src/chain-parameters/` | `IChainParameters`, `IChainParametersService`, `IChainParametersFetcher` |

## Related

- [market-system-architecture.md](../markets/market-system-architecture.md) — how fetchers consume `trEnergy` for normalization
- [environment.md](../environment.md) — TronGrid API keys and rate limiting
