# Market System Overview

This document provides a high-level summary of TronRelic's market data system. For detailed guidance on specific topics, refer to the specialized documentation linked throughout.

## Who This Document Is For

Backend developers and operations engineers who need to quickly understand how TronRelic captures, normalizes, and displays TRON energy market pricing before implementing new market integrations or troubleshooting production issues.

## Why This System Matters

TRON energy markets quote prices in wildly inconsistent formats—some sell by the hour, others by the day or week; some quote 32k energy chunks, others 1M units. Without normalization, comparing markets is impossible.

TronRelic's market system solves this by:

- **Capturing diverse API formats** - GraphQL, REST, custom endpoints all normalize to a single structure
- **Accounting for energy regeneration** - TRON energy refills every 24 hours, making 30-day rentals 30x more cost-effective than 1-day rentals for the same upfront cost
- **Normalizing to practical costs** - Users see "TRX per USDT transfer" instead of arbitrary energy amounts
- **Separating platform fees from peer-to-peer orders** - Fixed pricing tiers versus marketplace listings presented distinctly
- **Providing real-time comparisons** - Markets refresh every 10 minutes with automated reliability tracking

Following these patterns ensures accurate pricing data flows from diverse upstream APIs through normalization pipelines to a unified leaderboard display.

## Core System Components

### Market Fetchers

Each energy market has a dedicated fetcher that extends `BaseMarketFetcher` and implements a simple `pull()` method. Fetchers run every 10 minutes and return raw market data—no normalization logic required. The fetcher's only job is to grab data from the upstream API and structure it according to the `MarketSnapshot` interface.

**Key architectural principle:** Fetchers remain simple. They don't calculate regeneration costs, normalize pricing, or build comparison matrices. All of that happens automatically in the normalization pipeline.

**See [market-fetcher-discovery.md](./market-fetcher-discovery.md) for complete details on:**
- API discovery techniques (network inspection, JavaScript analysis, Playwright automation)
- Data structure analysis and TypeScript interface design
- Transformation logic with duration and price normalization
- Testing procedures and verification checklists
- Common pitfalls and troubleshooting guidance

### Normalization Pipeline

Raw market snapshots flow through three automatic layers before reaching the frontend:

1. **USDT Transfer Calculator** - Converts arbitrary energy amounts to practical "TRX per USDT transfer" costs using dynamically fetched blockchain data (not hardcoded values)
2. **Pricing Matrix Calculator** - Generates standardized grids across energy buckets (32k, 64k, 256k, 1M, 10M) and duration buckets (1h, 3h, 1d, 3d, 7d, 30d)
3. **Market Normalizer** - Orchestrates the pipeline and produces complete `MarketDocument` objects with fully computed `pricingDetail` fields

**Critical feature:** The system accounts for TRON's 24-hour energy regeneration. A 7-day rental provides 7x the value of a 1-day rental because the energy refills daily. Without this calculation, multi-day pricing would appear 7-30x more expensive than reality.

**See [market-system-architecture.md](./market-system-architecture.md) for complete details on:**
- Full data flow from fetchers through normalization to frontend display
- Energy regeneration mechanics and cost calculations
- Fetcher context and base class architecture
- Pricing matrix structure and comparison logic
- Error handling and resilience patterns
- Technical reference for all backend/frontend files

### Operations and Monitoring

Market fetchers run independently on 10-minute schedules with exponential backoff retry logic, Prometheus metrics collection, and automated reliability scoring. Configuration lives in hardcoded TypeScript files requiring code changes and redeployment.

**See [market-system-operations.md](./market-system-operations.md) for complete details on:**
- Provider configuration management
- Prometheus metrics and Grafana dashboards
- Admin API for manual overrides and refreshes
- Verification procedures after configuration changes
- Troubleshooting runbooks for common failure scenarios
- Alerting thresholds and incident response

## Quick Reference

### Adding a New Market

1. Discover the API endpoint using network inspection or Playwright automation
2. Create TypeScript interfaces matching the API response structure
3. Extend `BaseMarketFetcher` and implement `pull()` to return `MarketSnapshot` with `fees` array
4. Ensure each fee includes `minutes` (duration) and `sun` (per-unit price)
5. Register fetcher in `fetcher-registry.ts` and rebuild backend
6. Wait up to 10 minutes for scheduled fetch, verify in `/api/markets` endpoint

**Critical requirements:**
- `minutes` field is required for energy regeneration calculations (without it, multi-day costs will be 7-30x inflated)
- `sun` must be per-unit price, not total bundle price (otherwise calculations are off by orders of magnitude)
- Use `UsdtParametersService` for dynamic energy costs—never hardcode 65,000 as the USDT transfer cost

### Verifying Market Data

```bash
# Check market appears with recent timestamp
curl -s http://localhost:4000/api/markets | jq '.markets[] | select(.guid == "your-market") | {name, lastUpdated, isActive}'

# Verify pricing detail populated
curl -s http://localhost:4000/api/markets | jq '.markets[] | select(.guid == "your-market") | .pricingDetail.minUsdtTransferCost'

# Check fetcher logs for errors
tail -100 .run/backend.log | grep -i "your-market"
```

### Common Failure Modes

| Symptom | Common Cause | Resolution |
|---------|--------------|------------|
| Market shows "N/A" pricing | Missing `minutes` or `sun` in fees array | Verify fetcher transformation includes required fields |
| Costs appear 7-30x too high | Duration not provided to calculator | Ensure `minutes` field is present and numeric |
| Stale timestamps | Upstream API errors or USDT service failure | Check logs for retry attempts, verify upstream API accessible |
| Configuration not applied | Build/restart not completed | Run `./scripts/start.sh --force-build` and verify dist/ output |

## Pre-Ship Checklist

Before deploying a new market fetcher or configuration change, verify:

- [ ] Fetcher includes `minutes` and `sun` for all fee objects
- [ ] `sun` represents per-unit price (not total bundle price)
- [ ] Uses `UsdtParametersService` for energy costs (no hardcoded values)
- [ ] TypeScript compilation succeeds without errors
- [ ] Market appears in `/api/markets` with populated `pricingDetail`
- [ ] `minUsdtTransferCost` shows reasonable value (not null or suspiciously high)
- [ ] Frontend leaderboard displays market with correct pricing
- [ ] Expandable row details show per-duration costs
- [ ] Logs show successful fetch execution without retry storms
- [ ] Prometheus metrics show normal reliability and availability

## Further Reading

**Detailed documentation:**
- [market-fetcher-discovery.md](./market-fetcher-discovery.md) - Complete workflow for discovering and implementing new market fetchers
- [market-system-architecture.md](./market-system-architecture.md) - Full technical architecture, data flow, and normalization pipeline
- [market-system-operations.md](./market-system-operations.md) - Operational runbook for configuration management and troubleshooting

**Related topics:**
- [tron-chain-parameters.md](../tron/tron-chain-parameters.md) - Chain Parameters Service for dynamic blockchain data
- [documentation.md](../documentation.md) - Documentation standards and writing style
