# Market System Operations

This runbook summarizes operational procedures for TronRelic's market fetcher system, including configuration management, observability, and incident response.

## Why This Matters

Market fetchers provide real-time pricing data that drives TronRelic's energy cost comparisons. Operational failures have direct user impact:

- **Stale data** - Users see outdated prices and make suboptimal purchasing decisions
- **Missing observability** - Fetcher failures go unnoticed until users report incorrect data
- **Slow incident response** - Outages take longer to diagnose and resolve without documented procedures
- **Provider API changes** - Markets change endpoints or data formats without notice, breaking fetchers

This runbook ensures market data remains accurate and observable by documenting configuration management, metrics collection, alerting thresholds, and recovery procedures.

## Related Documentation

Before operating the market system, review these foundational documents:

- [market-system-architecture.md](./market-system-architecture.md) - System architecture, data normalization pipeline, and pricing calculations
- [market-fetcher-discovery.md](./market-fetcher-discovery.md) - Step-by-step guide for discovering and implementing new market fetchers

## Provider Configuration

Market provider configuration is stored in `apps/backend/src/config/market-providers.ts` as hardcoded values. Each provider entry defines:

- **API endpoints** - URLs where market data is fetched (GraphQL, REST APIs)
- **Site links** - Display URLs shown to users in the frontend
- **Affiliate links** - Optional referral URLs for tracking commissions
- **Social links** - Telegram, Twitter, GitHub links for each platform
- **Wallet addresses** - Blockchain addresses used by the platform (displayed for transparency)
- **Minimum order** - Smallest energy order size accepted by the platform

### Making Changes

To update provider configuration:

1. Edit `apps/backend/src/config/market-providers.ts`
2. Modify the relevant provider's settings
3. Rebuild backend: `npm run build --workspace apps/backend`
4. Restart services: `./scripts/stop.sh && ./scripts/start.sh`

All configuration changes require code changes and redeployment.

## Retry & Resilience

- All fetchers now execute outbound HTTP calls through a shared exponential backoff helper (`executeWithRetry`) with three attempts and doubling delays (500ms, 1s, 2s).
- Retry details are logged to `context.logger` with the fetcher name and request label.
- When upstream responses are malformed or unavailable, the fetchers degrade gracefully (returning `null` snapshot) and the reliability service handles error accounting.
- Each retry attempt also increments Prometheus counters (`tronrelic_market_fetch_retry_total`) enabling dashboards and alerts to track upstream churn.

## Telemetry & Metrics

- Prometheus metrics live at `GET /metrics`. Provide the `x-metrics-token` header matching `METRICS_TOKEN` when telemetry is enabled.
- Gauges recorded per market: `tronrelic_market_availability_percent`, `tronrelic_market_reliability_score`, and `tronrelic_market_effective_price_trx`.
- Counters/histograms record fetch duration, success/failure totals, and retry volume for alerting.
- Reliability snapshots (status, availability, effective price) are persisted in the `MarketReliabilityHistory` collection with a 30-day TTL for change-detection dashboards.

## Local Observability Stack

- `ops/observability/docker-compose.yml` provisions Prometheus, Alertmanager, and Grafana against the `/metrics` endpoint. Start the stack with `docker compose -f ops/observability/docker-compose.yml up -d`.
- The Prometheus scrape target defaults to `host.docker.internal:4000`; adjust the target inside `ops/observability/prometheus.yml` if you expose the backend elsewhere or require TLS.
- The bundled Grafana dashboard `TronRelic Markets Overview` visualises success/failure deltas, P95 fetch duration, availability, reliability, and effective price snapshots.
- Alerting rules (`ops/observability/alert.rules.yml`) cover fetcher failure spikes, stalled schedulers, and sustained availability drops. Extend the receivers inside `ops/observability/alertmanager.yml` before wiring PagerDuty/Slack.

## Admin Overrides API

- All routes require the `x-admin-token` header (value sourced from `ADMIN_API_TOKEN`). When the token is unset the API responds with `503`.
- Endpoints:
  - `GET /api/admin/markets`
  - `PATCH /api/admin/markets/:guid/priority` → `{ "priority": 5 }`
  - `PATCH /api/admin/markets/:guid/status` → `{ "isActive": false }`
  - `PATCH /api/admin/markets/:guid/affiliate` → `{ "link": "https://...", "commission": 12 }` or `{ "link": null }`
  - `POST /api/admin/markets/:guid/refresh` → `{ "force": true }` (currently refreshes the full set, not a single provider)

## Operational Checklist

### Configuration Changes

When updating market provider settings (endpoints, affiliate links, wallet addresses):

1. **Edit `apps/backend/src/config/market-providers.ts`** with new values
2. **Rebuild backend** (`npm run build --workspace apps/backend`)
3. **Restart services** (`./scripts/stop.sh && ./scripts/start.sh`)
4. **Verify configuration** by checking `/api/markets` endpoint for updated values
5. **Monitor fetcher logs** for any errors with new endpoints

### Verification Procedures

Run these checks after any configuration change or deployment:

**Backend health check:**
```bash
# Verify backend is running and responsive
curl http://localhost:4000/health

# Check market data endpoint returns valid JSON
curl -s http://localhost:4000/api/markets | jq '.markets | length'
```

**Market data verification:**
```bash
# Verify specific market appears with recent timestamp
curl -s http://localhost:4000/api/markets | jq '.markets[] | select(.guid == "brutus-finance") | {name, lastUpdated, isActive}'

# Check pricing detail is populated
curl -s http://localhost:4000/api/markets | jq '.markets[] | select(.guid == "brutus-finance") | .pricingDetail.minUsdtTransferCost'
```

**Log analysis:**
```bash
# Check for fetcher errors
tail -100 .run/backend.log | grep -i "market.*error"

# Verify fetcher execution schedule
tail -100 .run/backend.log | grep -i "market.*fetched"
```

### Routine Maintenance

1. **Daily:** Review Prometheus dashboards for failure spikes and availability drops
2. **Weekly:** Check for new API versions or endpoint changes from market providers
3. **As needed:** Update affiliate links in `market-providers.ts` when running new campaigns

## Troubleshooting

### Market Not Appearing in API Response

**Symptoms:**
- Market missing from `/api/markets` endpoint
- Frontend leaderboard doesn't show market

**Diagnosis:**
```bash
# Check if fetcher is registered
grep -r "YourMarketFetcher" apps/backend/src/modules/markets/fetchers/fetcher-registry.ts

# Check backend logs for fetcher errors
tail -100 .run/backend.log | grep -i "your-market"

# Verify MongoDB has market data
docker exec tronrelic-mongo mongosh tronrelic --eval "db.markets.findOne({guid: 'your-market'})"
```

**Resolution:**
1. Ensure fetcher is registered in `fetcher-registry.ts`
2. Check scheduler is enabled (`ENABLE_SCHEDULER=true` in `.env`)
3. Wait up to 10 minutes for next scheduled fetch
4. Review logs for API errors or timeout issues

### Market Shows N/A for Pricing

**Symptoms:**
- Market appears but "TRX per USDT TX" shows "N/A"
- `pricingDetail.minUsdtTransferCost` is null or missing

**Diagnosis:**
```bash
# Check fees array structure
curl -s http://localhost:4000/api/markets | jq '.markets[] | select(.guid == "your-market") | .fees'
```

**Common causes:**
- **Missing `minutes` field** - Energy regeneration cannot be calculated
- **Missing `sun` field** - Price per unit not provided
- **Only marketplace orders** - Some markets (like Tronify) don't have fixed fees
- **USDT energy cost service failure** - The `UsdtParametersService` fetches energy costs from the blockchain every 10 minutes. If this service fails, `minUsdtTransferCost` cannot be calculated even when fee data is present.

**Resolution:**
1. Verify fetcher includes `minutes` and `sun` in each fee object
2. Check USDT energy cost service logs: `tail -100 .run/backend.log | grep -i "usdt.*parameter"`
3. Confirm USDT service is fetching energy costs: `curl -s http://localhost:4000/api/markets | jq '.markets[0].pricingDetail.usdtTransferCosts'`
4. Check [market-fetcher-discovery.md](./market-fetcher-discovery.md#common-pitfalls) for transformation guidance
5. Rebuild backend and wait for next fetch cycle

### Stale Market Data

**Symptoms:**
- `lastUpdated` timestamp is more than 10 minutes old
- Market shows old pricing despite API having new data

**Diagnosis:**
```bash
# Check when market was last updated
curl -s http://localhost:4000/api/markets | jq '.markets[] | select(.guid == "your-market") | {name, lastUpdated}'

# Check scheduler logs
tail -100 .run/backend.log | grep -i "market scheduler"
```

**Common causes:**
- Fetcher hitting rate limits or timeouts
- Upstream API down or returning errors
- Scheduler disabled or crashed
- USDT energy cost service failure preventing price calculations

**Resolution:**
1. Check upstream API is accessible: `curl <api-endpoint>`
2. Verify USDT energy cost service is running: `tail -100 .run/backend.log | grep -i "usdt.*parameter"`
3. Review retry metrics in Prometheus dashboard
4. Manually trigger refresh via admin API: `POST /api/admin/markets/:guid/refresh`
5. Check scheduler health: look for "Market scheduler started" in logs

### Configuration Not Applied

**Symptoms:**
- Changed endpoint URL in source code but fetcher still uses old value
- Updated affiliate link doesn't appear in market data

**Diagnosis:**
```bash
# Check if backend rebuild succeeded
ls -la apps/backend/dist/config/market-providers.js

# Verify backend is actually restarted (not using old process)
ps aux | grep node
```

**Resolution:**
1. Confirm changes saved in `apps/backend/src/config/market-providers.ts`
2. Clean rebuild: `./scripts/start.sh --force-build`
3. Verify build output includes your changes: check `dist/config/market-providers.js`
4. Confirm no TypeScript errors prevented compilation

### High Retry Rate

**Symptoms:**
- Prometheus shows increasing `tronrelic_market_fetch_retry_total`
- Logs show repeated retry attempts

**Diagnosis:**
```bash
# Check retry frequency
tail -100 .run/backend.log | grep -i "market.*retry"

# Test upstream API directly
curl -v <market-api-endpoint>
```

**Common causes:**
- Upstream API intermittent failures
- Network connectivity issues
- Rate limiting from upstream

**Resolution:**
1. Contact upstream API provider about stability
2. Temporarily increase timeout: adjust `timeoutMs` in fetcher constructor
3. Use mirror endpoint if available (update in `market-providers.ts`)
4. Monitor Prometheus for sustained error rates requiring alerting
