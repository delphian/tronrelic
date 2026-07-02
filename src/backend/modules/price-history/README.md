# Price History Module

Maintains a **local** daily USD price series (TRX + tracked TRC20 tokens) in ClickHouse so portfolio valuation never makes a live external price call on a page load. Prices are immutable, so the work is a bounded, resumable backward backfill plus a cheap daily forward append — the same ingestion discipline as account-history.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `price-history` |
| Module class | `src/backend/modules/price-history/PriceHistoryModule.ts` |
| Service registry name | `'price-history'` → `IPriceHistoryService` |
| Admin page | `/system/price-history` — System-container item `Price History` (order 28); in-page tabs (Coverage, Diagnostics, Settings) in the `price-history` menu namespace (Submenu Pattern), rendered with `MenuNavClient` |
| Mounted routes | `/api/admin/system/price-history/*` (`createAdminRateLimiter` + `requireAdmin`): `GET /stats`, `GET /diagnostics`, `GET`/`PATCH /settings`, `POST /backfill/run`, `POST /forward/run` |
| WebSocket event | `price-history:stats` (global admin-refetch nudge after each tick; has a case in `WebSocketService.emit()`) |
| Scheduler jobs | `price-history:backfill` (`*/5 * * * *`); `price-history:forward-sync` (`0 1 * * *`) |
| Types package | `@delphian/tronrelic-types` → `IPriceHistoryService`, `IPricePoint`, `PriceAsset`, `PRICE_ASSET_TRX` |
| ClickHouse table | `price_history` (ReplacingMergeTree) |
| Mongo collections | `module_price-history_settings`, `module_price-history_progress` |
| Provider seam | `IPriceHistoryProvider` (active impl: `TronScanPriceHistoryProvider`, TRX-only; `CoinGeckoPriceHistoryProvider` retained for future token coverage) |
| Bootstrap order | Inits after the scheduler service; before the valuation module that consumes it |

## Why It Is a Module

Valuation depends on a local price series existing, ingested on a schedule regardless of which optional features are enabled — core, non-toggleable infrastructure. There is no live-fetch fallback by design: a missing day reads as "unpriced", never a synchronous provider call.

## Source Map

| Path | Responsibility |
|------|----------------|
| `PriceHistoryModule.ts` | Lifecycle; creates the service, registers the two jobs, publishes `'price-history'` |
| `services/price-history.service.ts` | `PriceHistoryService` singleton — settings, cursors, the two-phase ingestion, ClickHouse reads |
| `providers/IPriceHistoryProvider.ts` | The source seam (`fetchRange` seed + `fetchDay` deep walk) the service depends on |
| `providers/tronscan-price-history.provider.ts` | **Active** provider; TRX via TronScan `/api/trx/volume` (`close` per day), tokens → empty |
| `providers/coingecko-price-history.provider.ts` | Retained CoinGecko provider; maps `'TRX'`→`tron`, a token→`contract/{address}` — kept for future token coverage |
| `lib/price-day.ts` | UTC `YYYY-MM-DD` day arithmetic |
| `database/index.ts` | Collection/table constants, cursor/settings doc shapes, ClickHouse row shape |
| `api/price-history.admin.{controller,routes}.ts` | Admin surface (coverage stats, settings, manual backfill/forward) behind `requireAdmin` |
| `migrations/001_create_price_history_table.ts` | ClickHouse table DDL (`target: 'clickhouse'`) |

## Published Contract — `'price-history'` → `IPriceHistoryService`

| Method | Purpose |
|--------|---------|
| `getPriceOn(asset, day)` | One asset's USD price on a UTC day, or null (unpriced) |
| `getPricesForDays(asset, days)` | Batched prices for an explicit day set (value a tx feed in one query) |
| `getSeries(asset, fromDay, toDay)` | Contiguous daily series for the balance chart |
| `ensureAssetsTracked(assets)` | Register token contracts for backfill (the valuation engine reports held tokens) |
| `getSettings()` / `updateSettings(patch)` | Read / merge pacing (`ingestionEnabled`, `daysPerTick`, `tokensPerTick`) |
| `getStats()` | Settings + per-asset coverage rollup |
| `runBackfillTick()` / `runForwardTick()` | Advance the backward backfill / append the latest closed day (scheduler + manual) |

## Ingestion Strategy

Backfill is two-phase, provider-agnostic at the service layer. **Seed**: one `fetchRange` call fills the recent window (`RECENT_WINDOW_DAYS`), flipping `recentSeeded`. **Deep walk**: the backward backfill walks older days one at a time via `fetchDay`, up to `daysPerTick`, stopping at the first null (listing reached → `backfillComplete`) or the `MAX_BACKFILL_DAYS` floor. Each clean write advances the per-asset cursor, so a failed tick resumes without re-fetching. ReplacingMergeTree keyed `(asset, day)` makes re-fetch idempotent. Pacing dials throttle *down* only.

The active TronScan provider fills the seed window and each forward append in a single `/api/trx/volume` call with no keyless history wall (the wall that stalled the prior CoinGecko deep walk). The service still drives the deep walk one `fetchDay` per day, so a full multi-year TRX backfill spans many ticks — bounded and resumable, just not instant. Token assets resolve to empty (TronScan has no per-token history), leaving tokens "seeded-but-empty" until a token source is added. Provider config (key, source, enable) lives in the [providers module](../providers/README.md), edited from `/system/system` → Providers.

Granularity is one closing price per UTC day — the reproducible standard for cost-basis math, and it joins to the ledger's day buckets directly.

## Storage

**ClickHouse `price_history`** — `ReplacingMergeTree(fetched_at)`, `PARTITION BY toYYYYMM(day)`, `ORDER BY (asset, day)`. No TTL; the series is the product.

**Mongo** — `settings` (singleton) and `progress` (per-asset cursor: `recentSeeded`, `oldestDayFetched`, `newestDayFetched`, `backfillComplete`).

## Observability

The admin page is the operator's window on an otherwise-invisible subsystem. Each ingestion tick emits a timestamp-only `price-history:stats` nudge so the page live-refreshes coverage over the requireAdmin feed. `getStats().totals.staleAssets` counts seeded assets whose newest day has fallen behind yesterday (the forward append is lagging). `totals.providerCalls`/`providerErrors` are rolling since-boot provider health counters (in-memory by design — the signal is "is the provider healthy now", not an audit trail), warning of rate-limiting or an outage before coverage visibly stalls. Per asset, `estimatedDaysRemaining` reports how many days the deep walk still has to cover before the lookback floor — a ceiling (the listing date may end the walk earlier) an operator divides by `daysPerTick` × tick cadence for an ETA. The **Diagnostics** tab (`GET /diagnostics`) joins the held-token set — `IAccountHistoryService.getHeldTokenAssets()` over the balance snapshots — against price coverage to list the contracts users hold that the series cannot price; those are excluded from portfolio USD totals, so the list is the operator's actionable backlog for chasing a price source.

## Related

- [Valuation Module README](../valuation/README.md) — the consumer that joins this series with the ledger and snapshots
- [Account History Module README](../account-history/README.md) — the sibling ClickHouse ingester this mirrors
- [system-database-migrations.md](../../../../docs/system/system-database-migrations.md) — ClickHouse-targeted migrations
