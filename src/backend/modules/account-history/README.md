# Account History Module

Ingests the full transaction history of operator-tracked TRON accounts into ClickHouse, pull-based and independent of the forward block-sync pipeline. Backfills are bounded per scheduler tick and resumable, so a million-transaction account spreads over many ticks without a long-lived process and resumes after a restart.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `account-history` |
| Module class | `src/backend/modules/account-history/AccountHistoryModule.ts` |
| Admin page | `/system/account-history` — System-container item `Account History` (order 27); in-page tabs registered as the `account-history` menu namespace (menu module's Submenu Pattern), rendered with `MenuNavClient`. All in `run()`. |
| Service registry name | `'account-history'` → `IAccountHistoryService` |
| Mounted routes | `/api/admin/system/account-history/*` (`createAdminRateLimiter` + `requireAdmin`); `/api/account-history/me/*` (`requireLogin`, ownership-scoped: progress, per-wallet summary, per-wallet transactions) |
| Auto-enrollment | Registers a `'core'` handler on the `http.walletLinked` hook — a user verifying a wallet auto-enrolls it (`label: 'user-verified'`) |
| Scheduler jobs | `account-history:ingest` (backfill, `*/2 * * * *`); `account-history:forward-sync` (keep completed accounts current, `*/5 * * * *`); `account-history:snapshot` (per-account balance/resource sampler, `0 */4 * * *`) |
| WebSocket event | `account-history:stats` (global broadcast; has a case in `WebSocketService.emit()`) |
| Types package | `@delphian/tronrelic-types` → `IAccountHistoryService` and its DTOs |
| ClickHouse tables | `account_transactions`; `account_value_transfers`; `account_balance_snapshots` + `account_token_balances` (all ReplacingMergeTree) |
| Mongo collections | `module_account-history_tracked`, `module_account-history_progress`, `module_account-history_settings` |
| Provider seam | `IAccountHistoryProvider` (v1 impl: `TronGridAccountHistoryProvider`) |
| Bootstrap order | Inits after the scheduler service is available; runs alongside other modules before `loadPlugins` |

## Why It Is a Module (Not a Plugin)

By the module-vs-plugin matrix this feature is plugin-shaped (the app runs without it). It is built as a module at the operator's explicit request: a self-contained, always-on core component. The consequence is that it cannot be toggled off — so the **tracked set** and the `ingestionEnabled` **setting** are the control surface a plugin's enable/disable would otherwise provide.

## Source Map

| Path | Responsibility |
|------|----------------|
| `AccountHistoryModule.ts` | Two-phase lifecycle; creates the service, mounts the router, registers the job and menu, publishes `'account-history'` |
| `services/account-history.service.ts` | `AccountHistoryService` singleton — the single authority; tracked set, cursors, settings, ingestion loop, ClickHouse reads, live-stats emit |
| `providers/IAccountHistoryProvider.ts` | The data-source seam the service depends on (never TronGrid directly) |
| `providers/trongrid-account-history.provider.ts` | v1 TronGrid provider + `toAccountTransactionRow` ClickHouse projector |
| `api/account-history.controller.ts` | Thin HTTP handlers delegating to the service |
| `api/account-history.routes.ts` | Router factory (guards applied at mount) |
| `database/index.ts` | Collection/table constants, Mongo doc shapes, ClickHouse row shape, TronGrid item shape |
| `lib/clickhouse-datetime.ts` | `DateTime64(3)` (de)serialization helpers |
| `migrations/001_create_account_transactions_table.ts` | ClickHouse `account_transactions` table DDL (`target: 'clickhouse'`) |
| `migrations/004_create_account_value_transfers_table.ts` | ClickHouse `account_value_transfers` ledger DDL (`target: 'clickhouse'`) |

## Data Source Coverage

An account's history is assembled from **four logical sources**, because none alone is complete. These are the provider *contract* — source-independent; the concrete endpoints a provider uses to satisfy them are an implementation detail (see the v1 note below).

- **External (top-level) transactions** (source `tx`) — native TRX, TRC10, staking, delegation, raw contract calls, and *outbound* TRC20 (the account is the native caller).
- **Inbound token transfers** (source `trc20`) — decoded token transfers indexed by participant, capturing *inbound* TRC20 the top-level source omits (an inbound transfer's recipient lives only inside the contract call data, never as a native party), with the token amount.
- **Internal (TVM) value moves** (source `internal`) — value a contract moves mid-execution (a contract paying TRX to the account), invisible to the two transaction sources. These are value legs, not transactions, so they land in `account_value_transfers` only — see [Storage](#storage).
- **Fee and reward legs** — derived from the external walk's transactions, not a fifth source. Every transaction that burned TRX yields a `fee` leg (payer → nobody; burned TRX has no recipient), and a `WithdrawBalanceContract` claim yields a `reward` leg (nobody → claimer) whose amount is overlaid from the envelope's info-level `withdraw_amount`. With the native leg these make the ledger a complete record of *total-balance* changes. Staking ops (freeze / V2 unfreeze / withdraw-expire / cancel-unfreeze) are recognized types with correct amounts in `account_transactions` but deliberately emit **no** leg: they move TRX between the account's own liquid/staked/unstaking buckets without changing its total; bucket state lives in the balance snapshots. Accounts backfilled before these legs shipped carry them only on newly ingested rows; remove-and-re-add re-walks history idempotently and fills them in.
- **Per-transaction event legs** — the authoritative token *value* leg. A token transfer surfaced by the inbound source omits its protocol `log_index`, so a leg built from it could only use an empty `leg_key`, and two same-token transfers in one transaction would then collapse under the `account_value_transfers` natural key. The value leg is instead sourced from each token-bearing transaction's decoded events (`provider.fetchTokenTransferLegs`), whose event index *is* the `log_index`. This is not an account walk: it is driven per token-bearing transaction the inbound source discovers (inbound and outbound both surface there), needs no cursor, costs one events read per such transaction, and carries decimals over from the matching `trc20` row's token metadata (the events payload omits them).

Each of the first three sources has its own cursor; an account is marked `complete` only when **all three** exhaust. TRC20 amount/symbol/decimals are stored in dedicated columns (carried through the normalized transaction's `contract.parameters`), so `IBlockTransaction` stays unextended. An outbound TRC20 transfer is stored as two rows — the native call (`tx`) and the decoded transfer (`trc20`); reads suppress the redundant native row when a `trc20` row exists for the same tx.

**v1 TronGrid provider.** `TronGridAccountHistoryProvider` maps the four sources onto TronGrid endpoints, but holds **no endpoint strings itself** — it delegates to the shared `TronGridClient` (`src/backend/modules/blockchain/tron-grid.client.ts`), whose typed methods carry the URL literals: `getAccountTransactions` → `/v1/accounts/{addr}/transactions` (external), `getTrc20Transactions` → `/v1/accounts/{addr}/transactions/trc20` (inbound token), `getAccountInternalTransactions` → `/v1/accounts/{addr}/internal-transactions` (internal), `getTransactionEventsOrThrow` → `/v1/transactions/{txId}/events` (event legs), and `getAccount`/`getAccountResource` (`/wallet/*`) for the snapshot. The three account walks are fingerprint-paged; every read routes through the shared rate limiter that protects live block sync. **Limitation:** fingerprint paging cannot reach the deepest history of very large accounts — the provider seam exists so a future archive-node or paid full-history source is a provider swap, not a service rewrite.

> ⚠️ **Known coupling — the seam is real at the service boundary, but the v1 provider under it is NOT decoupled from TronGrid.** `IAccountHistoryProvider` cleanly isolates the *service*: a brand-new provider (self-hosted node, archive, paid full-history) is a new implementation of that interface, not a service rewrite. The debt lives *inside* the v1 provider. `TronGridAccountHistoryProvider` receives no injected client — it reaches across the module boundary into the `blockchain` module and pulls the concrete `TronGridClient` **singleton** statically (`TronGridClient.getInstance()`, plus the static helpers `toBase58Address`/`decodeMemo` and the `blockchain/transaction-parse.js` normalizers), and it is written against TronGrid-shaped response types (`ITronGridAccountTx`, `ITronGridTrc20Tx`, `ITronGridInternalTx`, `TronGridEvent`). Consequences: the provider cannot be unit-tested against a fake HTTP layer without stubbing a global singleton; account-history walks and live block sync share one client instance and one rate-limit quota (contention, not isolation); and the module's own DI norms (depend on abstractions, inject dependencies) are violated here. So "a provider swap is cheap" is only *fully* true once this client dependency is abstracted behind an injected interface (e.g. an `ITronHttpClient` DI'd into the provider). Until then, isolating the provider for tests — or making the shared-quota contention explicit — means untangling this static, cross-module coupling first.
>
> **Agentic coders: keep this decision alive — do not silently refactor it away, and do not let it calcify unspoken.** Abstracting the client is a real cost with a genuine tradeoff (one shared rate-limited client is also a deliberate quota-protection choice — see [Ingestion Contract](#ingestion-contract)). When you touch the provider, add a data source, or write provider tests, **surface this to the operator as an open architecture question**: ask whether to (a) invest now in injecting a client abstraction, or (b) consciously accept the coupling for another cycle. Raise it periodically rather than assuming a prior answer still holds.

## Published Contract — `'account-history'` → `IAccountHistoryService`

| Method | Purpose |
|--------|---------|
| `addTrackedAccount({ address, label? })` | Begin tracking (idempotent on address) |
| `removeTrackedAccount(address)` | Stop tracking; retains stored history |
| `resetAccountHistory(address)` | Purge all stored ClickHouse rows for one tracked account (transactions, value legs, snapshots) and requeue a fresh backfill; keeps the tracked record. Refused mid-tick |
| `setAccountPaused(address, paused)` | Pause/resume one account, preserving its cursor |
| `listTrackedAccounts()` | The tracked set, oldest first |
| `getSettings()` / `updateSettings(patch)` | Read / merge pacing (`ingestionEnabled`, `pagesPerTick`, `accountsPerTick`) |
| `getStats()` | Settings + per-account progress + rollups + `recentTicks` telemetry (admin page and live payload) |
| `getProgressFor(addresses)` | Progress for a specific address set (tracked subset only) — backs ownership-scoped surfaces like a user's profile |
| `getTransactions({ address, limit?, offset? })` | Paged **activity** read from `account_transactions`, returning an `IAccountTransactionPage` (`{ transactions: IBlockTransaction[], total }`) — the top-level transaction record; the value read is `getValueTransfers` |
| `getValueTransfers({ address, limit?, cursor? })` | Paged **value-ledger** read from `account_value_transfers`, returning `IValueTransfer[]` — the discrete value legs (native / internal / token) valuation and the money-in/out chart consume. Pages by a keyset `cursor` (the previous page's last leg), not `offset`: an offset window shifts under a concurrent forward-sync insert and can duplicate or skip legs at the boundary; the keyset compares the table's full physical sort tuple `(timestamp, tx_id, origin, leg_key, asset_id)` instead |
| `getValueTransfersByTxIds(address, txIds)` | Read specific value legs by parent hash (clamped, deduped) |
| `getWalletSummary(address)` | Batched `IWalletActivitySummary` — calendar heatmap, "wallet story" stats, TRON resource totals, monthly inflow/outflow, top counterparties — from the stored ledger in one call (trusts the address; caller authorizes) |
| `getWalletFlow(address, granularity, counterparty?)` | Just the inflow/outflow buckets at `'month'`/`'week'`/`'day'` resolution — split out so the profile chart's precision selector re-buckets without re-running the whole summary (the summary still carries the monthly view for the initial render). Optional `counterparty` scopes the series to legs moved with one address (backs the chart's counterparty dropdown); a malformed/empty value degrades to unfiltered |
| `getTokenMetadata(assets)` | Real symbol/decimals per TRC20 contract, learned from stored decoded transfers — the token-metadata registry valuation keys display symbols and decimals on; local-only, never a network call |
| `getLatestSnapshot(address)` | Latest `IAccountBalanceSnapshot` (liquid/staked/unstaking TRX, withdrawable rewards, energy/bandwidth, per-token balances) — the valuation anchor and current-holdings source |
| `getSnapshotSeries(address, fromDay, toDay)` | Scalar snapshot series over a UTC day range (token balances omitted) for balance-over-time calibration |
| `runSnapshotTick()` | Capture a bounded slice of balance snapshots through the provider (scheduler + manual trigger) |
| `runIngestionTick()` | Advance the backward backfill one bounded slice (scheduler + manual trigger); returns an `IAccountHistoryTickOutcome` |
| `runForwardSyncTick()` | Refresh completed accounts with transactions that arrived after backfill (scheduler + manual trigger); returns an `IAccountHistoryTickOutcome` |

Consume from a plugin via `context.services.watch('account-history', ...)`; from a module via constructor DI or the registry.

## REST Endpoints (`requireAdmin`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/system/account-history/stats` | Full stats snapshot |
| GET/PATCH | `/api/admin/system/account-history/settings` | Read / update pacing |
| POST | `/api/admin/system/account-history/ingest/run` | Manual backfill tick; responds with the completed tick's outcome |
| POST | `/api/admin/system/account-history/ingest/forward/run` | Manual forward-sync tick (refresh completed accounts); responds with the outcome |
| GET/POST | `/api/admin/system/account-history/accounts` | List / add tracked accounts |
| GET | `/api/admin/system/account-history/accounts/:address/transactions` | Paged history |
| PATCH | `/api/admin/system/account-history/accounts/:address/paused` | Pause/resume |
| POST | `/api/admin/system/account-history/accounts/:address/reset` | Delete all stored history and requeue a fresh backfill |
| DELETE | `/api/admin/system/account-history/accounts/:address` | Stop tracking |

## User Endpoints (`requireLogin`)

Login-gated, ownership-scoped routes let a signed-in user explore only the wallets they verified — kept separate from the admin surface so a user never reaches the full tracked set. Every route resolves the caller's verified addresses through the identity `'wallets'` service (the only sanctioned path to that data); the per-wallet routes reject any `:address` the caller does not own with **404** (knowing an address is never authorization, and not-found never confirms whether an unowned address is tracked). The per-wallet detail surface drives the profile Wallets tab, which renders it only for a wallet whose backfill `status === 'complete'`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/account-history/me/progress` | `{ progress }` for the caller's own verified, tracked wallets |
| GET | `/api/account-history/me/wallets/:address/summary` | `{ summary }` — the `IWalletActivitySummary` for one owned wallet (heatmap, stats, resources, flow, counterparties) |
| GET | `/api/account-history/me/wallets/:address/flow` | `{ flow }` — inflow/outflow buckets for one owned wallet at the `?granularity=` resolution (`month`/`week`/`day`); backs the profile chart's precision selector. Optional `?counterparty=` scopes the series to one address, backing the chart's counterparty dropdown |
| GET | `/api/account-history/me/wallets/:address/transactions` | `IAccountTransactionPage` — paged decoded feed for one owned wallet (`limit`/`offset` query params) |

The summary is purely activity/behaviour, derived from the stored ledger. The **valuation/portfolio** surface (net worth, holdings, PnL, balance-over-time) now exists as the separate [valuation module](../valuation/README.md), which consumes this module's ledger and balance snapshots plus the [price-history](../price-history/README.md) series. The balance snapshots that anchor it are owned here: `runSnapshotTick()` samples each tracked account's on-chain state through the provider's `fetchAccountSnapshot` — `getaccount`, `getaccountresource`, and the `getReward` probe for unclaimed vote rewards (`withdrawable_reward_sun`, real net worth invisible to the ledger until claimed) — into `account_balance_snapshots` (scalar TRX/staking/reward/resource state) and `account_token_balances` (per-token), keyed `(account, day)`, bounded per tick by `accountsPerTick`. Snapshot freshness is legible on the admin page: each account row shows its `lastSnapshotDay`, and `getStats().totals.snapshottedTodayAccounts` rolls up how many accounts the sampler covered today, so a stalled `account-history:snapshot` job is visible at a glance. The ledger alone cannot reconstruct an absolute balance (unreachable deep history, staking moves), so these snapshots are the calibration anchor valuation pins its derived series to.

## Auto-Enrollment

The module registers a `'core'` handler on the `http.walletLinked` observer hook (`docs/system/system-hooks.md`). When a user verifies a wallet on their profile, the handler calls `addTrackedAccount({ address, label: 'user-verified' })` — idempotent, so a re-link or an operator-tracked address is a harmless no-op. Observer isolation keeps a failed enroll from breaking the link. This is the inbound counterpart to the user endpoint above: identity fires the seam, account-history reacts, and the profile shows the resulting download progress.

## Ingestion Contract

`runIngestionTick()` selects the least-recently-advanced unpaused, not-complete accounts (up to `accountsPerTick`) and, for each, walks all three endpoints (`tx`, `trc20`, then `internal`) up to `pagesPerTick` pages each, writing rows to ClickHouse and advancing **each endpoint's own cursor** after every clean write. A failed tick persists each cursor at its last cleanly-written page so the next tick resumes without re-counting or re-fetching. An account becomes `complete` only when all three endpoints exhaust. The `tx`/`trc20` walks write `account_transactions` rows and **dual-write** value legs into `account_value_transfers`: `toValueTransfers` derives the native-TRX leg from each transaction, and the `trc20` walk additionally sources each token-bearing transaction's token legs from the events endpoint (keyed by `log_index`); the `internal` walk writes only `account_value_transfers` legs. ReplacingMergeTree keys absorb paging/retry overlaps on both tables (`account_transactions`: `(account, timestamp, tx_id, source, to_address)`; `account_value_transfers`: `(account, timestamp, tx_id, origin, leg_key, asset_id)`), so re-ingest is idempotent. The pacing dials throttle *down* only — they cannot exceed the shared TronGrid rate limiter that protects live block sync.

Progress is expressed as absolute counts plus the oldest timestamp reached, never a percentage: fingerprint paging never reveals an account's total transaction count up front.

## Staying Current (Forward Sync)

The backward backfill only walks *down* and permanently excludes `complete` accounts, so without a second path a finished account would go stale the moment new transactions land. `runForwardSyncTick()` (job `account-history:forward-sync`) closes that gap: for each completed account it walks the *leading edge* — newest pages of all three endpoints — for rows newer than the `newestTimestampSeen` watermark, appends them (transactions and value legs alike), and leaves the account `complete`.

The watermark advances only when a drain fully reaches known territory (a row at or below it). When a tick hits the per-tick page cap first — a backlog larger than one tick can hold — the endpoint is left *mid-drain*: its continuation fingerprint is persisted (`forwardTxCursor` / `forwardTrc20Cursor` / `forwardInternalCursor`) and the next tick resumes draining downward from there. The newest timestamp seen is held in `forwardPendingNewest` and promoted to the watermark only once both endpoints reach known territory, so the watermark never moves past rows a capped tick left un-fetched — the silent gap an immediate advance would create. While an account is mid-drain, an endpoint that is not itself draining is skipped rather than re-walked, so its fresh arrivals cannot push the shared pending watermark past the still-draining endpoint's un-fetched rows; those arrivals are caught on the next clean cycle. A high-volume account therefore drains over several ticks with **no data loss** — raising `pagesPerTick` or the job cadence only makes it drain faster.

The poll never flips an account to `failed` — that would re-admit it to the backward backfill (which filters on `status !== 'complete'`) and, with cursors cleared at completion, trigger a full re-walk that double-counts; on error it keeps `complete`. TronGrid continuation fingerprints are short-lived, so a parked drain has two escape paths: an empty page on a resumed cursor's first fetch is treated as fingerprint expiry (the walk restarts once from the leading edge within the same tick), and an errored tick clears all continuation cursors rather than persisting them (the next tick restarts from the leading edge) — either way the frozen watermark plus ReplacingMergeTree idempotency makes the re-walk safe, and `forwardPendingNewest` is held so rows written before a failure still lift the watermark when a clean drain lands.

A tick that writes new rows also clears `lastSnapshotDay`, marking the account snapshot-due: valuation's current holdings read only the latest balance snapshot, so without the nudge fresh activity would stay invisible in the portfolio overview until the next UTC-day sample.

**Tick telemetry.** Every ingest and forward-sync tick returns and records an `IAccountHistoryTickOutcome`: per-account provider-call counts (page walks per source plus per-transaction token-event reads), pages fetched per source, rows written, and per-account errors, with tick-level rollups and a `skippedReason` on no-op ticks. The last `RECENT_TICKS_MAX` (20) outcomes live in a bounded in-memory ring surfaced as `getStats().recentTicks` and rendered on the page's **Tick Activity** tab — deliberately not persisted (telemetry, not history; resets on restart). The manual trigger endpoints respond with the outcome, so an operator sees what a forced tick did without diffing `/stats`. Per-account progress additionally projects `sourcesComplete` and `forwardDraining` (per-source booleans) so the admin can see *which* of the three walks is outstanding or mid-drain — the opaque cursor fingerprints stay internal.

**Admin visibility.** Forward sync is legible on `/system/account-history` without reading Mongo. `newestTimestampSeen` is the per-account freshness watermark ("Newest tx" column); a `catchingUp` boolean (derived from a parked forward continuation cursor, never the raw fingerprint) tags a completed account still draining a backlog; `lastForwardRunAt` records the last forward refresh, distinct from the frozen backfill `lastRunAt`. `getStats().totals` rolls these into `catchingUpAccounts` and `oldestNewestTimestamp` (the freshness floor across completed accounts) for the page header. The `POST /ingest/forward/run` endpoint is wired to a "Run forward sync" button so an operator can force a refresh without waiting for the cron.

## Storage

**ClickHouse `account_transactions`** — `ReplacingMergeTree(ingested_at)`, `PARTITION BY toYYYYMM(timestamp)`, `ORDER BY (account, timestamp, tx_id, source, to_address)`. Columns flatten `IBlockTransaction` plus `account`, `source`, the TRC20 `token_amount`/`token_symbol`/`token_decimals`, and `ingested_at`. No TTL — account history is the product.

**ClickHouse `account_value_transfers`** — `ReplacingMergeTree(ingested_at)`, `PARTITION BY toYYYYMM(timestamp)`, `ORDER BY (account, timestamp, tx_id, origin, leg_key, asset_id)`. The unifying value-movement ledger: one row per discrete value leg (native / internal / token), flattening a source-independent `IValueTransfer` plus `account` and `ingested_at`. The natural key keys legs by protocol fact (`leg_key` is empty for `native` legs, the internal-transaction hash for `internal` legs, and the event `log_index` for `token_event` legs), so legs sharing a parent transaction never collide and a provider swap reproduces the same keys. Dual-written alongside `account_transactions` during ingest. **Value reads now source from here:** valuation (`getValueTransfers`/`getValueTransfersByTxIds`) and the money-in/out flow chart read this ledger, while `account_transactions` remains the top-level transaction / activity record (`getTransactions`, the calendar/counterparty summaries). Ownership is explicit — `account_transactions` is the activity record, `account_value_transfers` is the value record. Accounts that completed their backfill *before* the dual-write shipped were repaired by two one-time mechanisms, both now finished and retired: migration `005` reconstructed native legs from `account_transactions`, and a since-removed `account-history:ledger-backfill` job drained internal legs and re-fetched token legs from the events endpoint until the legacy population was swept.

**Mongo control collections** — `tracked` (the set, unique `address`), `progress` (resumable cursor per address, unique `address`), `settings` (singleton, keyed `settings`). The three scheduler ticks (ingest, forward-sync, snapshot) each select their slice with a single indexed query on `progress` — filter (unpaused + dueness) + sort + `limit(accountsPerTick)` — rather than loading the whole tracked+progress set and joining in memory. This needs `paused` denormalized onto `progress` (authoritative copy stays on `tracked`, written by `setAccountPaused`, seeded `false` on insert, backfilled by migration `003`); the selectors read it with `{$ne: true}` so a pre-migration doc reads as unpaused. Composite indexes back the three selectors, ordered by the ESR rule (Equality → Sort → Range) so each sort is index-served rather than blocking: `{lastRunAt, paused, status}` (ingest), `{status, lastForwardRunAt, paused}` (forward sync), `{lastSnapshotDay, paused}` (snapshot), all created in `ensureIndexes`.

## Related

- [system-database.md](../../../../docs/system/system-database.md) — `IDatabaseService` access
- [system-database-migrations.md](../../../../docs/system/system-database-migrations.md) — ClickHouse-targeted migrations
- [Traffic Module README](../traffic/README.md) — the sibling ClickHouse consumer this mirrors
- [system-domain-types.md](../../../../docs/system/system-domain-types.md) — why reads return `IBlockTransaction`
