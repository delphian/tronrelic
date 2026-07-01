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
| Scheduler jobs | `account-history:ingest` (backfill, `*/2 * * * *`); `account-history:forward-sync` (keep completed accounts current, `*/5 * * * *`); `account-history:snapshot` (per-account balance/resource sampler, `0 */4 * * *`); `account-history:ledger-backfill` (one-time value-leg backfill for pre-dual-write accounts, `*/5 * * * *`, self-quiescing) |
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
| `setAccountPaused(address, paused)` | Pause/resume one account, preserving its cursor |
| `listTrackedAccounts()` | The tracked set, oldest first |
| `getSettings()` / `updateSettings(patch)` | Read / merge pacing (`ingestionEnabled`, `pagesPerTick`, `accountsPerTick`) |
| `getStats()` | Settings + per-account progress + rollups (admin page and live payload) |
| `getProgressFor(addresses)` | Progress for a specific address set (tracked subset only) — backs ownership-scoped surfaces like a user's profile |
| `getTransactions({ address, limit?, offset? })` | Paged **activity** read from `account_transactions`, returning an `IAccountTransactionPage` (`{ transactions: IBlockTransaction[], total }`) — the top-level transaction record; the value read is `getValueTransfers` |
| `getValueTransfers({ address, limit?, cursor? })` | Paged **value-ledger** read from `account_value_transfers`, returning `IValueTransfer[]` — the discrete value legs (native / internal / token) valuation and the money-in/out chart consume. Pages by a keyset `cursor` (the previous page's last leg), not `offset`: an offset window shifts under a concurrent forward-sync insert and can duplicate or skip legs at the boundary; the keyset compares the table's full physical sort tuple `(timestamp, tx_id, origin, leg_key, asset_id)` instead |
| `getValueTransfersByTxIds(address, txIds)` | Read specific value legs by parent hash (clamped, deduped) |
| `getWalletSummary(address)` | Batched `IWalletActivitySummary` — calendar heatmap, "wallet story" stats, TRON resource totals, monthly inflow/outflow, top counterparties — from the stored ledger in one call (trusts the address; caller authorizes) |
| `getLatestSnapshot(address)` | Latest `IAccountBalanceSnapshot` (liquid/staked/unstaking TRX, energy/bandwidth, per-token balances) — the valuation anchor and current-holdings source |
| `getSnapshotSeries(address, fromDay, toDay)` | Scalar snapshot series over a UTC day range (token balances omitted) for balance-over-time calibration |
| `runSnapshotTick()` | Capture a bounded slice of balance snapshots through the provider (scheduler + manual trigger) |
| `runIngestionTick()` | Advance the backward backfill one bounded slice (scheduler + manual trigger) |
| `runForwardSyncTick()` | Refresh completed accounts with transactions that arrived after backfill (scheduler + manual trigger) |

Consume from a plugin via `context.services.watch('account-history', ...)`; from a module via constructor DI or the registry.

## REST Endpoints (`requireAdmin`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/system/account-history/stats` | Full stats snapshot |
| GET/PATCH | `/api/admin/system/account-history/settings` | Read / update pacing |
| POST | `/api/admin/system/account-history/ingest/run` | Manual backfill tick |
| POST | `/api/admin/system/account-history/ingest/forward/run` | Manual forward-sync tick (refresh completed accounts) |
| POST | `/api/admin/system/account-history/ingest/backfill-ledger/run` | Manual value-leg backfill tick (internal + token legs for pre-dual-write accounts) |
| GET/POST | `/api/admin/system/account-history/accounts` | List / add tracked accounts |
| GET | `/api/admin/system/account-history/accounts/:address/transactions` | Paged history |
| PATCH | `/api/admin/system/account-history/accounts/:address/paused` | Pause/resume |
| DELETE | `/api/admin/system/account-history/accounts/:address` | Stop tracking |

## User Endpoints (`requireLogin`)

Login-gated, ownership-scoped routes let a signed-in user explore only the wallets they verified — kept separate from the admin surface so a user never reaches the full tracked set. Every route resolves the caller's verified addresses through the identity `'wallets'` service (the only sanctioned path to that data); the per-wallet routes reject any `:address` the caller does not own with **404** (knowing an address is never authorization, and not-found never confirms whether an unowned address is tracked). The per-wallet detail surface drives the profile Wallets tab, which renders it only for a wallet whose backfill `status === 'complete'`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/account-history/me/progress` | `{ progress }` for the caller's own verified, tracked wallets |
| GET | `/api/account-history/me/wallets/:address/summary` | `{ summary }` — the `IWalletActivitySummary` for one owned wallet (heatmap, stats, resources, flow, counterparties) |
| GET | `/api/account-history/me/wallets/:address/transactions` | `IAccountTransactionPage` — paged decoded feed for one owned wallet (`limit`/`offset` query params) |

The summary is purely activity/behaviour, derived from the stored ledger. The **valuation/portfolio** surface (net worth, holdings, PnL, balance-over-time) now exists as the separate [valuation module](../valuation/README.md), which consumes this module's ledger and balance snapshots plus the [price-history](../price-history/README.md) series. The balance snapshots that anchor it are owned here: `runSnapshotTick()` samples each tracked account's on-chain state through the provider's `fetchAccountSnapshot` into `account_balance_snapshots` (scalar TRX/staking/resource state) and `account_token_balances` (per-token), keyed `(account, day)`, bounded per tick by `accountsPerTick`. The ledger alone cannot reconstruct an absolute balance (unreachable deep history, staking moves), so these snapshots are the calibration anchor valuation pins its derived series to.

## Auto-Enrollment

The module registers a `'core'` handler on the `http.walletLinked` observer hook (`docs/system/system-hooks.md`). When a user verifies a wallet on their profile, the handler calls `addTrackedAccount({ address, label: 'user-verified' })` — idempotent, so a re-link or an operator-tracked address is a harmless no-op. Observer isolation keeps a failed enroll from breaking the link. This is the inbound counterpart to the user endpoint above: identity fires the seam, account-history reacts, and the profile shows the resulting download progress.

## Ingestion Contract

`runIngestionTick()` selects the least-recently-advanced unpaused, not-complete accounts (up to `accountsPerTick`) and, for each, walks all three endpoints (`tx`, `trc20`, then `internal`) up to `pagesPerTick` pages each, writing rows to ClickHouse and advancing **each endpoint's own cursor** after every clean write. A failed tick persists each cursor at its last cleanly-written page so the next tick resumes without re-counting or re-fetching. An account becomes `complete` only when all three endpoints exhaust. The `tx`/`trc20` walks write `account_transactions` rows and **dual-write** value legs into `account_value_transfers`: `toValueTransfers` derives the native-TRX leg from each transaction, and the `trc20` walk additionally sources each token-bearing transaction's token legs from the events endpoint (keyed by `log_index`); the `internal` walk writes only `account_value_transfers` legs. ReplacingMergeTree keys absorb paging/retry overlaps on both tables (`account_transactions`: `(account, timestamp, tx_id, source, to_address)`; `account_value_transfers`: `(account, timestamp, tx_id, origin, leg_key, asset_id)`), so re-ingest is idempotent. The pacing dials throttle *down* only — they cannot exceed the shared TronGrid rate limiter that protects live block sync.

Progress is expressed as absolute counts plus the oldest timestamp reached, never a percentage: fingerprint paging never reveals an account's total transaction count up front.

## Staying Current (Forward Sync)

The backward backfill only walks *down* and permanently excludes `complete` accounts, so without a second path a finished account would go stale the moment new transactions land. `runForwardSyncTick()` (job `account-history:forward-sync`) closes that gap: for each completed account it walks the *leading edge* — newest pages of all three endpoints — for rows newer than the `newestTimestampSeen` watermark, appends them (transactions and value legs alike), and leaves the account `complete`.

The watermark advances only when a drain fully reaches known territory (a row at or below it). When a tick hits the per-tick page cap first — a backlog larger than one tick can hold — the endpoint is left *mid-drain*: its continuation fingerprint is persisted (`forwardTxCursor` / `forwardTrc20Cursor` / `forwardInternalCursor`) and the next tick resumes draining downward from there. The newest timestamp seen is held in `forwardPendingNewest` and promoted to the watermark only once both endpoints reach known territory, so the watermark never moves past rows a capped tick left un-fetched — the silent gap an immediate advance would create. While an account is mid-drain, an endpoint that is not itself draining is skipped rather than re-walked, so its fresh arrivals cannot push the shared pending watermark past the still-draining endpoint's un-fetched rows; those arrivals are caught on the next clean cycle. A high-volume account therefore drains over several ticks with **no data loss** — raising `pagesPerTick` or the job cadence only makes it drain faster.

The poll never flips an account to `failed` — that would re-admit it to the backward backfill (which filters on `status !== 'complete'`) and, with cursors cleared at completion, trigger a full re-walk that double-counts; on error it keeps `complete`, persists the drain state, and the next tick resumes from it.

**Admin visibility.** Forward sync is legible on `/system/account-history` without reading Mongo. `newestTimestampSeen` is the per-account freshness watermark ("Newest tx" column); a `catchingUp` boolean (derived from a parked forward continuation cursor, never the raw fingerprint) tags a completed account still draining a backlog; `lastForwardRunAt` records the last forward refresh, distinct from the frozen backfill `lastRunAt`. `getStats().totals` rolls these into `catchingUpAccounts` and `oldestNewestTimestamp` (the freshness floor across completed accounts) for the page header. The `POST /ingest/forward/run` endpoint is wired to a "Run forward sync" button so an operator can force a refresh without waiting for the cron.

## Storage

**ClickHouse `account_transactions`** — `ReplacingMergeTree(ingested_at)`, `PARTITION BY toYYYYMM(timestamp)`, `ORDER BY (account, timestamp, tx_id, source, to_address)`. Columns flatten `IBlockTransaction` plus `account`, `source`, the TRC20 `token_amount`/`token_symbol`/`token_decimals`, and `ingested_at`. No TTL — account history is the product.

**ClickHouse `account_value_transfers`** — `ReplacingMergeTree(ingested_at)`, `PARTITION BY toYYYYMM(timestamp)`, `ORDER BY (account, timestamp, tx_id, origin, leg_key, asset_id)`. The unifying value-movement ledger: one row per discrete value leg (native / internal / token), flattening a source-independent `IValueTransfer` plus `account` and `ingested_at`. The natural key keys legs by protocol fact (`leg_key` is empty for `native` legs, the internal-transaction hash for `internal` legs, and the event `log_index` for `token_event` legs), so legs sharing a parent transaction never collide and a provider swap reproduces the same keys. Dual-written alongside `account_transactions` during ingest. **Value reads now source from here:** valuation (`getValueTransfers`/`getValueTransfersByTxIds`) and the money-in/out flow chart read this ledger, while `account_transactions` remains the top-level transaction / activity record (`getTransactions`, the calendar/counterparty summaries). Ownership is explicit — `account_transactions` is the activity record, `account_value_transfers` is the value record. Accounts that completed their backfill *before* the dual-write shipped are backfilled by two idempotent mechanisms: migration `005` reconstructs native legs from `account_transactions` (their `leg_key` is empty, so storage suffices), and the `account-history:ledger-backfill` job (`runLedgerBackfillTick`) drains internal legs and re-fetches each stored `trc20` transaction's token legs from the events endpoint (the only source of their `log_index`), keyset-resumable per account. The job operates on `complete` accounts in place, writing a field set disjoint from forward sync; it targets only the legacy population (completions under current code are marked token-current at the gate) and self-quiesces. `getStats().totals.legacyBackfillPending` surfaces the count of completed accounts still owing an internal drain or token sweep — the operator's at-a-glance "is the one-time backfill done?" signal, reaching `0` once the legacy population is swept. It counts owing accounts regardless of pause state, so a paused account still shows as remaining work rather than masking it.

**Mongo control collections** — `tracked` (the set, unique `address`), `progress` (resumable cursor per address, unique `address`), `settings` (singleton, keyed `settings`). The three scheduler ticks (ingest, forward-sync, snapshot) each select their slice with a single indexed query on `progress` — filter (unpaused + dueness) + sort + `limit(accountsPerTick)` — rather than loading the whole tracked+progress set and joining in memory. This needs `paused` denormalized onto `progress` (authoritative copy stays on `tracked`, written by `setAccountPaused`, seeded `false` on insert, backfilled by migration `003`); the selectors read it with `{$ne: true}` so a pre-migration doc reads as unpaused. Composite indexes back the three selectors, ordered by the ESR rule (Equality → Sort → Range) so each sort is index-served rather than blocking: `{lastRunAt, paused, status}` (ingest), `{status, lastForwardRunAt, paused}` (forward sync), `{lastSnapshotDay, paused}` (snapshot), all created in `ensureIndexes`.

## Related

- [system-database.md](../../../../docs/system/system-database.md) — `IDatabaseService` access
- [system-database-migrations.md](../../../../docs/system/system-database-migrations.md) — ClickHouse-targeted migrations
- [Traffic Module README](../traffic/README.md) — the sibling ClickHouse consumer this mirrors
- [system-domain-types.md](../../../../docs/system/system-domain-types.md) — why reads return `IBlockTransaction`
