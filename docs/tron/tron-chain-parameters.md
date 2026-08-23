# Chain Parameters Service

`ChainParametersService` keeps TRON network parameters fresh for energy/TRX conversions and APY math. Polls TronGrid every 10 minutes, persists to MongoDB, caches in memory for 1 minute.

## Why This Matters

TRON's energy-to-TRX ratio drifts daily with total staked TRX and network energy limits. Cost calculators, APY math, and any feature pricing energy in TRX consume this ratio — hardcoding it produces wrong prices the moment the network shifts.

## How It Works

A scheduled fetcher polls TronGrid, derives `energyPerTrx`, and writes a snapshot to MongoDB. The service reads the latest snapshot, caches it in memory for 1 minute, and exposes conversion methods.

### Cached Fields

<a id="energy-system"></a>

| Field | Source | Purpose | Refresh |
|---|---|---|---|
| `totalEnergyLimit` | `getTotalEnergyLimit` chain param | Network energy capacity (~180B) | 10 min |
| `totalEnergyCurrentLimit` | `getTotalEnergyCurrentLimit` | Current adjusted limit | 10 min |
| `totalFrozenForEnergy` | Conservative estimate (32M TRX in SUN) | Denominator for `energyPerTrx` | 10 min |
| `energyPerTrx` | Derived: `totalEnergyLimit / (totalFrozenForEnergy / 1_000_000)` | Conversion ratio (~5,625 energy/TRX) | 10 min |
| `energyFee` | `getEnergyFee` chain param | Burn cost when no staked energy (100 SUN/unit) | 10 min |
| `totalBandwidthLimit` | `TotalNetLimit` from network state | Network bandwidth capacity | 10 min |
| `totalFrozenForBandwidth` | `TotalNetWeight`, converted to SUN | Denominator for `bandwidthPerTrx` | 10 min |
| `bandwidthPerTrx` | Derived: `TotalNetLimit / TotalNetWeight` | Conversion ratio | 10 min |

`totalFrozenForEnergy` currently uses a 32M TRX estimate; precise calculation from validator account resources is a known follow-up. Until then `energyPerTrx` slightly overestimates TRX cost — safe for pricing.

### Why 10 Minutes

Chain parameters drift over hours, not seconds. 10 minutes balances freshness against TronGrid quota and pairs with the 1-minute in-memory cache (9 cache hits per refresh). Fetch completes in 200–500ms.

### MongoDB Caching and Fallback

Snapshots persist to the `chainParameters` collection (indexed `{ network, fetchedAt: -1 }`) so parameters survive restarts and can be shared across instances. If the collection is empty (fresh install, dropped collection, DB error), the service returns a hardcoded fallback (`energyPerTrx: 5625`, `energyFee: 100`) and logs `WARN: No chain parameters found in database, using fallback`. Fallback prevents startup failure while the scheduler catches up.

The scheduled `chain-parameters:fetch` job pushes the snapshot it just wrote into the service's in-memory cache by calling `primeCache(parameters)`. Without that push the cache is only ever rewritten inside `getParameters()`, and the synchronous converters read the cache directly rather than awaiting a reload — so on a process where nothing calls `getParameters()`, they would keep converting against the snapshot warmed at startup while the database already held a current one.

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
| `getBandwidthFromTRX(trx)` | `trx × bandwidthPerTrx` | Bandwidth units, or 0 when no usable ratio is cached |
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

## Rules

- Never hardcode `energyPerTrx`, `bandwidthPerTrx`, `energyFee`, or `5625` / `100` / `65000` literals — call the service.
- Both `getEnergyFromTRX` and `getBandwidthFromTRX` are synchronous so a caller on the block path can use them, and both return 0 rather than throwing when no usable ratio is cached. A caller that must tell "no resource" apart from "ratio not known" has to test the result — the two are the same number.
- **A conversion belongs at the moment being described, not at the moment being computed.** Both ratios drift with network-wide staking, so converting a past transaction's staked amount later describes a different network than the one the transaction happened on. Where a caller stores the result, convert when the transaction is in hand and store the figure; do not recompute it on a later pass.
- Never bypass the in-memory cache; one method call per conversion is fine, the cache absorbs it.
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
        totalBandwidthLimit: number;
        totalFrozenForBandwidth: number;
        bandwidthPerTrx: number;
    };
    fetchedAt: Date;
    createdAt: Date;
}

interface IChainParametersService {
    getParameters(): Promise<IChainParameters>;
    getEnergyFromTRX(trx: number): number;
    getBandwidthFromTRX(trx: number): number;
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
| `src/backend/modules/chain-parameters/chain-parameters.service.ts` | Cached service + conversion methods + fallback |
| `src/backend/modules/chain-parameters/chain-parameters-fetcher.ts` | Polls TronGrid, derives ratio, writes snapshot |
| `src/backend/database/models/chain-parameters-model.ts` | Mongoose schema + indexes |
| `src/backend/modules/scheduler/jobs/core-jobs.ts` | Registers `chain-parameters:fetch` cron `*/10 * * * *` and primes the service cache with each fetched snapshot |
| `packages/types/src/chain-parameters/` | `IChainParameters`, `IChainParametersService`, `IChainParametersFetcher` |

## Related

- [environment.md](../environment.md) — TronGrid API keys and rate limiting
