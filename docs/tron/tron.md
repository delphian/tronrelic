# TRON Blockchain Overview

This document introduces TRON blockchain concepts essential for TronRelic development. Understanding TRON's energy system, transaction structure, and network parameters is critical for accurate market pricing, whale tracking, and blockchain synchronization.

## Who This Document Is For

Backend developers implementing blockchain observers, market fetchers requiring energy cost calculations, and maintainers troubleshooting synchronization or pricing accuracy issues.

## Why This Matters

TronRelic's core features depend on accurate TRON blockchain data:

- **Energy market pricing** - Comparing rental costs requires understanding TRON's 24-hour energy regeneration mechanics
- **Whale transaction tracking** - Identifying significant transfers depends on TRX/USD conversions and transaction parsing
- **Cost calculations** - USDT transfer costs vary based on dynamic network parameters, not static values
- **Blockchain synchronization** - Processing blocks requires understanding TRON's transaction structure and contract types

When TRON knowledge is incomplete:

- Energy cost calculations are orders of magnitude incorrect (missing regeneration multipliers shows 7-30x inflated prices)
- Market comparisons fail because different platforms quote prices in incompatible formats (TRX vs SUN, hourly vs daily)
- Whale alerts miss significant transactions due to incorrect value thresholds
- Blockchain sync stalls because observers don't handle all contract types properly

## TRON Fundamentals for TronRelic

### Energy System

TRON transactions consume **energy** instead of TRX fees. Energy can be obtained two ways:

1. **Stake TRX** - Lock TRX to receive energy that regenerates every 24 hours
2. **Rent from markets** - Pay TRX to borrow energy for fixed durations (1 hour to 30 days)

**Critical insight**: Rented energy regenerates daily. A 7-day rental provides 7x the total energy because it refills each day. TronRelic's market system accounts for this regeneration when comparing pricing across different rental durations.

**Common energy costs:**
- USDT transfer (TRC20): ~65,000 energy (dynamically fetched, not hardcoded)
- TRX transfer: 0 energy (native transfers are free)
- Complex contract calls: Variable based on computation

**See [tron-chain-parameters.md](./tron-chain-parameters.md#energy-system) for complete details on:**
- Energy-to-TRX conversion formulas
- Network parameter calculations (`totalEnergyLimit`, `energyPerTrx`)
- Staking vs renting cost comparison
- APY calculations for rental deals

### Transaction Structure

TRON transactions embed full contract data in blocks, eliminating the need for per-transaction API calls. TronRelic leverages this by:

1. Fetching block data with `getBlockByNumber` (includes all transaction details)
2. Parsing embedded contract types (`TransferContract`, `TriggerSmartContract`, etc.)
3. Extracting amounts, addresses, and contract calls from embedded data
4. Enriching with USD values and energy costs before notifying observers

**This design enables 1 API call per block instead of 1,800+ calls** (avoiding per-transaction fetches for transaction-heavy blocks).

**Common contract types:**
- `TransferContract` - Native TRX transfers
- `TriggerSmartContract` - Smart contract calls (including USDT TRC20 transfers)
- `FreezeBalanceV2Contract` - Energy staking operations
- `DelegateResourceContract` - Energy delegation/rentals

### Network Parameters

TRON's energy-to-TRX conversion ratio changes based on network-wide staking activity. TronRelic's Chain Parameters Service polls these values every 10 minutes:

- `totalEnergyLimit` - Total network energy capacity (~180 billion)
- `totalFrozenForEnergy` - Total TRX staked for energy (~32 million TRX)
- `energyFee` - Burn cost when energy is unavailable (100 SUN per unit)
- `energyPerTrx` - Derived ratio for conversions (~5,625 energy per TRX)

**Why this matters:**
- Hardcoded ratios break when network conditions change
- Market fetchers need live ratios for accurate price normalization
- Cost calculators must use current `energyFee` values, not historical approximations

**See [tron-chain-parameters.md](./tron-chain-parameters.md) for complete details on:**
- Chain Parameters Service architecture and caching strategy
- Scheduled fetch workflow and MongoDB storage
- Conversion methods (`getEnergyFromTRX`, `getTRXFromEnergy`, `getAPY`)
- Integration with market fetchers and normalization pipeline
- Fallback behavior when database is empty

### TRX and SUN

TRON uses **SUN** as the smallest denomination:

```
1 TRX = 1,000,000 SUN
```

**Why TronRelic uses both:**
- Market APIs return prices in SUN for precision (avoiding floating-point errors)
- User interfaces display TRX for readability
- Internal calculations use SUN, then convert to TRX before display

**Common conversion scenarios:**
```typescript
// Market fetcher receives price in TRX, converts to SUN for storage
const sunPerUnit = trxPrice * 1_000_000;

// Frontend displays TRX from stored SUN values
const displayTrx = storedSun / 1_000_000;
```

## How TRON Data Flows Through TronRelic

```
┌──────────────────────────────────────────────────────────┐
│ TronGrid API                                              │
│ • /wallet/getchainparameters (every 10 min)              │
│ • /wallet/getblockbynum (every 1 min for new blocks)     │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│ Chain Parameters Service                                  │
│ • Caches energyPerTrx, energyFee                         │
│ • Provides conversion methods to all services             │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│ Blockchain Sync Service                                   │
│ • Parses transaction contracts from blocks                │
│ • Enriches with USD values and energy costs              │
│ • Notifies observers asynchronously                       │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ├──────────────────┬───────────────────┐
                     ▼                  ▼                   ▼
        ┌──────────────────┐  ┌──────────────┐  ┌──────────────┐
        │ Whale Observer   │  │ USDT Observer│  │ Market Fetchers│
        │ • Tracks large   │  │ • Tracks TRC20│ │ • Normalizes  │
        │   transfers      │  │   transfers   │  │   pricing     │
        └──────────────────┘  └──────────────┘  └──────────────┘
```

## Quick Reference

### Energy Cost Calculations

**NEVER hardcode energy costs.** Always use `UsdtParametersService` for USDT transfers and `ChainParametersService` for conversions:

```typescript
// Good - Dynamic energy cost
const usdtEnergyCost = await usdtParamsService.getUsdtTransferEnergyCost();

// Bad - Hardcoded value breaks when network changes
const usdtEnergyCost = 65000;
```

### Common TRON Contract Types

| Contract Type | Purpose | TronRelic Usage |
|--------------|---------|-----------------|
| `TransferContract` | Native TRX transfers | Whale tracking, transaction feed |
| `TriggerSmartContract` | Contract calls (USDT, etc.) | USDT observer, smart contract tracking |
| `FreezeBalanceV2Contract` | Stake TRX for energy | Energy staking analytics |
| `DelegateResourceContract` | Energy rental/delegation | Market activity tracking |

### TRX/SUN Conversions

```typescript
// SUN to TRX (for display)
const trx = sun / 1_000_000;

// TRX to SUN (for calculations)
const sun = trx * 1_000_000;
```

## Pre-Implementation Checklist

Before implementing any TRON-related feature, verify:

- [ ] Uses `ChainParametersService` for energy conversions (no hardcoded ratios)
- [ ] Uses `UsdtParametersService` for USDT transfer costs (no hardcoded 65k)
- [ ] Accounts for 24-hour energy regeneration in multi-day rental pricing
- [ ] Converts between TRX and SUN correctly (1 TRX = 1,000,000 SUN)
- [ ] Parses transaction contracts from block data (not separate API calls)
- [ ] Handles all relevant contract types in blockchain observers
- [ ] Uses live network parameters fetched every 10 minutes
- [ ] Tests with real TronGrid API responses (not mocked data)

## Further Reading

**Detailed documentation:**
- [tron-chain-parameters.md](./tron-chain-parameters.md) - Chain Parameters Service architecture, conversion methods, integration patterns

**Related topics:**
- [system-blockchain-sync-architecture.md](../system/system-blockchain-sync-architecture.md) - How TronRelic fetches and processes TRON blocks
- [market-system-architecture.md](../markets/market-system-architecture.md) - How energy market pricing uses TRON parameters
- [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) - How observers receive enriched TRON transactions
- [environment.md](../environment.md) - TronGrid API key configuration and rate limiting
