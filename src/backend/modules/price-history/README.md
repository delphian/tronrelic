# Price History Module

Maintains a **local** daily USD price series (TRX + tracked TRC20 tokens) in ClickHouse so portfolio valuation never makes a live external price call on a page load. Prices are immutable, so the work is a bounded, resumable backward backfill plus a cheap daily forward append — the same ingestion discipline as account-history. Prices come from the vendors declared in the [providers module](../providers/README.md), tried in an operator-set order per asset class.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `price-history` |
| Module class | `src/backend/modules/price-history/PriceHistoryModule.ts` |
| Service registry name | `'price-history'` → `IPriceHistoryService` |
| Admin page | `/system/price-history` — System-container item `Price History` (order 28); in-page tabs (Coverage, Diagnostics, Schedules, Database, Logs, Settings) in the `price-history` menu namespace (Submenu Pattern), rendered with `MenuNavClient`. Schedules is core `SchedulerMonitor` filtered to the `price-history:` job prefix, Database is core `CollectionBrowser` scoped to `module_price-history_` plus core `ClickHouseTableBrowser` scoped with `tables={['price_history']}`, and Logs is core `SystemLogsMonitor` scoped to the `tronrelic:price-history` service name |
| Log service name | `tronrelic:price-history`, derived by the logs module from the `module: 'price-history'` binding on the module's child logger. Do not set a `service` binding on a child logger here, or its entries fall outside the Logs tab. Both jobs register with `{ logger }`, so the scheduler's own start, success, and failure entries for them land here too |
| Mounted routes | `/api/admin/system/price-history/*` (`createAdminRateLimiter` + `requireAdmin`): `GET /stats`, `GET /diagnostics`, `GET`/`PATCH /settings`, `GET /sources`, `POST /assets/:asset/reset`, `POST /backfill/run`, `POST /forward/run` |
| WebSocket event | `price-history:stats` (global admin-refetch nudge after each tick and each reset; has a case in `WebSocketService.emit()`) |
| Scheduler jobs | `price-history:backfill` (`*/5 * * * *`); `price-history:forward-sync` (`0 1 * * *`) |
| Types package | `@delphian/tronrelic-types` → `IPriceHistoryService`, `IPricePoint`, `IPriceHistorySettings`, `IPriceSourceInfo`, `IPriceAssetCoverage`, `PriceAsset`, `PRICE_ASSET_TRX` |
| ClickHouse table | `price_history` (ReplacingMergeTree) |
| Mongo collections | `module_price-history_settings`, `module_price-history_progress` |
| Provider seam | `IPriceHistoryProvider` from the providers module; one adapter per vendor here, composed by `RoutingPriceHistoryProvider`, which the service sees as `IPriceHistoryRouter` |
| Bootstrap order | Inits after the providers module (receives its `IProviderRegistry`) and the scheduler service; before the valuation module that consumes it |

## Why It Is a Module

Valuation depends on a local price series existing, ingested on a schedule regardless of which optional features are enabled — core, non-toggleable infrastructure. There is no live-fetch fallback by design: a missing day reads as "unpriced", never a synchronous vendor call.

## Source Map

| Path | Responsibility |
|------|----------------|
| `PriceHistoryModule.ts` | Lifecycle; builds the per-vendor adapters and attaches them to the registry, creates the routing provider and the service, registers the two jobs, publishes `'price-history'` |
| `services/price-history.service.ts` | `PriceHistoryService` singleton — settings, cursors, seed and chunked deep walk, forward append, reset, ClickHouse reads |
| `providers/IPriceHistoryRouter.ts` | `IPriceHistoryRouter` — the routed contract the service depends on: `fetchRange` returning an `IPriceRangeOutcome`, `forgetAsset` |
| `providers/IPriceRangeOutcome.ts` | `IPriceRangeOutcome` and `PriceRangeVerdict` — how a routed fetch ended (`priced`, `empty`, `inconclusive`, `unavailable`) and which vendors were asked, skipped, or failed |
| `providers/PriceVendorsFailedError.ts` | `PriceVendorsFailedError` — thrown when nothing priced the asset and a vendor threw; names each failed vendor |
| `providers/routing-price-history.provider.ts` | `RoutingPriceHistoryProvider` — the one source the service sees; tries the ordered vendors for the asset's class and reports the verdict |
| `providers/tronscan-price-history.provider.ts` | TRX via TronScan `/api/trx/volume`; tokens unsupported |
| `providers/coingecko-price-history.provider.ts` | TRX by coin id and listed tokens by contract via CoinGecko `market_chart/range` |
| `providers/geckoterminal-price-history.provider.ts` | Tokens via their deepest SunSwap pool's daily candles on GeckoTerminal; remembers a usable pool per process, and re-looks-up a token that had none on its next fetch |
| `lib/price-day.ts` | UTC `YYYY-MM-DD` day arithmetic |
| `lib/retry-backoff.ts` | `retryDelayMs` / `isRetryAtCeiling` — the progressive wait (1h doubling to 24h) for an asset a fetch could not price |
| `database/index.ts` | Collection/table constants, cursor/settings doc shapes, ClickHouse row shape, `DEFAULT_SETTINGS` |
| `api/price-history.admin.{controller,routes}.ts` | Admin surface behind `requireAdmin` |
| `migrations/001_create_price_history_table.ts` | ClickHouse table DDL (`target: 'clickhouse'`) |
| `migrations/002_unpark_empty_token_cursors.ts` | Mongo: clears `recentSeeded` on token cursors recorded as seeded with no prices before a token vendor existed |

## Published Contract — `'price-history'` → `IPriceHistoryService`

| Method | Purpose |
|--------|---------|
| `getPriceOn(asset, day)` | One asset's USD price on a UTC day, or null (unpriced) |
| `getPricesForDays(asset, days)` | Batched prices for an explicit day set (value a tx feed in one query) |
| `getSeries(asset, fromDay, toDay)` | Contiguous daily series for the balance chart |
| `ensureAssetsTracked(assets)` | Register token contracts for backfill (the valuation engine reports held tokens) |
| `getSettings()` / `updateSettings(patch)` | Read / merge `ingestionEnabled`, `chunkDays` (1–1000), `tokensPerTick`, `trxSources[]`, `tokenSources[]` (unknown vendor ids are dropped) |
| `getPriceSources()` | The vendors declaring `price-history`: id, label, what each serves, whether enabled — the options the Settings tab offers |
| `getStats()` | Settings + per-asset coverage rollup, including each asset's `source` / `sourceRef` and retry state |
| `resetAsset(asset)` | Clear a tracked asset's cursor so the next tick re-seeds it through the current routing; stored prices are kept. Throws for an asset that is not tracked |
| `runBackfillTick()` / `runForwardTick()` | Advance the backward backfill / append the latest closed days (scheduler + manual) |

## Routing

`trxSources` and `tokenSources` name vendor ids in the order they are tried; defaults are `['tronscan', 'coingecko']` and `['coingecko', 'geckoterminal']`. For a fetch, the routing provider walks the list for the asset's class, never asks a vendor whose adapter does not support the asset, skips one that throws `ProviderDisabledError`, falls through on an empty answer, and stops at the first non-empty one. A vendor that throws anything else is logged at `warn` with its vendor id and the walk moves on, so one vendor's outage or rejected key does not stop the next vendor from pricing the asset; the outcome's `failed` list records it, and the call still counts toward `providerErrors`. When no vendor prices the asset and any vendor threw, the call throws `PriceVendorsFailedError`, whose message puts the vendor id in front of each error (`coingecko: HTTP 401: Unauthorized`), so the tick retries with the cursor untouched rather than parking the asset as unpriced.

The router does not return a bare array. It returns an `IPriceRangeOutcome` whose `verdict` says how the walk ended, because an empty answer means different things depending on who was asked:

| Verdict | Meaning | Seed | Deep walk | Forward |
|---------|---------|------|-----------|---------|
| `priced` | A vendor returned points | Seeded; backoff cleared | Cursor advances; backoff cleared | Appended |
| `empty` | Every vendor that could serve the asset was asked and had nothing | Parked under the backoff | Listing reached; `backfillComplete` | Try tomorrow |
| `inconclusive` | A vendor was skipped as disabled and the rest had nothing | Parked under the backoff | Parked under the backoff, cursor untouched | Try tomorrow |
| `unavailable` | No vendor could be asked: all disabled, or the list is empty | Skipped; nothing counted | Skipped; nothing counted | Skipped |

The `inconclusive` row is what keeps a briefly disabled vendor from wedging an asset: the old single-vendor code threw on a disabled vendor so the cursor could not move, and a router that returned `[]` for the same case would have marked the asset complete at whatever day the walk had reached. The `unavailable` row is why disabling every vendor of a class is quiet rather than a failure every tick: the first asset of that class to report it makes the tick skip the rest of the class, with one warning naming the skipped assets. A tick still isolates each asset it seeds or forward-appends, so one vendor outage is logged, the other assets and the deep walk still run, and the tick then rethrows so the scheduler records the failure. Every stored row carries the vendor id in `source`, and the cursor records the vendor and its handle (`sourceRef`: a pool address, a coin id) behind the latest fetch, shown on the Coverage tab.

## Ingestion Strategy

**Seed**: one `fetchRange` over the recent window (`RECENT_WINDOW_DAYS`, 360, inside keyless CoinGecko's 365-day reach) fills the dense recent history and flips `recentSeeded`. **Deep walk**: each tick fetches one `chunkDays`-wide range ending the day before the oldest day covered, for the least-recently-advanced incomplete asset, and moves the cursor to the oldest day the winning vendor returned (not the chunk's start, so days a later vendor in the order may hold are asked for on the next chunk rather than skipped). An empty chunk is read as the asset's listing date and marks `backfillComplete`; so does the `MAX_BACKFILL_DAYS` floor. `chunkDays` is therefore also the widest gap a source may show inside its history before the walk stops, which matters for a pool that traded rarely. **Forward**: one ranged call per seeded asset covers the days since its newest stored day.

A fetch that comes back without prices, in either phase, parks the asset rather than recording the answer as final. The cursor's `unpricedAttempts` counts consecutive unpriced fetches and `nextAttemptAt` holds the asset until the backoff in `lib/retry-backoff.ts` allows another try: an hour after the first, doubling each time, capped at a day. Both clear as soon as a fetch returns prices. Once the wait has reached the daily ceiling (the sixth consecutive unpriced attempt) each further attempt is logged at `error` level with the phase and the vendors asked and skipped, so an asset that has stayed unpriced for over a day reaches the logs page rather than only the coverage table. The asset is still tried once a day from then on; only a class with no vendor to ask is left alone. The Coverage tab shows a parked unseeded asset as **Unpriced** and a parked seeded one as **Backfill paused**, each with its retry time, and the per-asset reset re-queues it immediately. Deployments that ran the TRX-only vendor recorded tokens as seeded-but-empty; migration `002_unpark_empty_token_cursors` clears those so the token vendors get to see them. TRX cursors and stored TRX rows are untouched by any of this.

Granularity is one closing price per UTC day — the reproducible standard for cost-basis math, and it joins to the ledger's day buckets directly. A DEX-sourced day with no trade has no row; the series stores what exists and valuation treats the day as unpriced rather than carrying a stale close forward.

## Storage

**ClickHouse `price_history`** — `ReplacingMergeTree(fetched_at)`, `PARTITION BY toYYYYMM(day)`, `ORDER BY (asset, day)`. `source` is the vendor id. No TTL; the series is the product.

**Mongo** — `settings` (singleton; older documents may still carry the retired `daysPerTick`, which is ignored) and `progress` (per-asset cursor: `recentSeeded`, `oldestDayFetched`, `newestDayFetched`, `backfillComplete`, `source`, `sourceRef`, `unpricedAttempts`, `nextAttemptAt`).

## Observability

The admin page is the operator's window on an otherwise-invisible subsystem. Each ingestion tick emits a timestamp-only `price-history:stats` nudge so the page live-refreshes coverage over the requireAdmin feed. `getStats().totals.staleAssets` counts seeded assets whose newest day has fallen behind yesterday. `totals.providerCalls`/`providerErrors` are rolling since-boot counters over the routing provider (in-memory by design — the signal is "are the vendors healthy now", not an audit trail). Per asset, `estimatedDaysRemaining` reports how many days the deep walk still has to cover before the lookback floor — a ceiling an operator divides by `chunkDays` × tick cadence for an ETA. The **Diagnostics** tab (`GET /diagnostics`) joins the held-token set — `IAccountHistoryService.getHeldTokenAssets()` over the balance snapshots — against price coverage to list the contracts users hold that the series cannot price; those are excluded from portfolio USD totals, so the list is the operator's backlog for adding or re-ordering a source. The **Settings** tab orders the vendors per asset class and flags a vendor the operator has disabled on its configuration card; credentials and base URLs are edited on `/system/system` → Configuration.

## Related

- [Providers Module README](../providers/README.md) — the vendor registry, the `IPriceHistoryProvider` seam, and each vendor's configuration
- [Valuation Module README](../valuation/README.md) — the consumer that joins this series with the ledger and snapshots
- [Account History Module README](../account-history/README.md) — the sibling ClickHouse ingester this mirrors
- [system-database-migrations.md](../../../../docs/system/system-database-migrations.md) — ClickHouse-targeted migrations
