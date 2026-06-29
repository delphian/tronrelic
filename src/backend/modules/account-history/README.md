# Account History Module

Ingests the full transaction history of operator-tracked TRON accounts into ClickHouse, pull-based and independent of the forward block-sync pipeline. Backfills are bounded per scheduler tick and resumable, so a million-transaction account spreads over many ticks without a long-lived process and resumes after a restart.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `account-history` |
| Module class | `src/backend/modules/account-history/AccountHistoryModule.ts` |
| Admin page | `/system/account-history` (menu item `Account History`, order 27, registered in `run()`) |
| Service registry name | `'account-history'` → `IAccountHistoryService` |
| Mounted routes | `/api/admin/system/account-history/*` (`createAdminRateLimiter` + `requireAdmin`) |
| Scheduler job | `account-history:ingest` (default `*/2 * * * *`) |
| WebSocket event | `account-history:stats` (global broadcast; has a case in `WebSocketService.emit()`) |
| Types package | `@delphian/tronrelic-types` → `IAccountHistoryService` and its DTOs |
| ClickHouse table | `account_transactions` (ReplacingMergeTree) |
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
| `migrations/001_create_account_transactions_table.ts` | ClickHouse table DDL (`target: 'clickhouse'`) |

## Data Source Coverage

The provider walks **both** TronGrid account endpoints, because neither alone is complete:

- `/v1/accounts/{addr}/transactions` (source `tx`) — native TRX, TRC10, staking, delegation, raw contract calls, and *outbound* TRC20 (the account is the native caller).
- `/v1/accounts/{addr}/transactions/trc20` (source `trc20`) — decoded token transfers indexed by participant, capturing *inbound* TRC20 the native endpoint omits (an inbound transfer's recipient lives only inside the contract call data, never as a native party), with the token amount.

Each endpoint has its own fingerprint cursor; an account is marked `complete` only when **both** exhaust. TRC20 amount/symbol/decimals are stored in dedicated columns (carried through the normalized transaction's `contract.parameters`), so `IBlockTransaction` stays unextended. An outbound TRC20 transfer is stored as two rows — the native call (`tx`) and the decoded transfer (`trc20`); reads suppress the redundant native row when a `trc20` row exists for the same tx.

**Limitation:** TronGrid fingerprint paging cannot reach the deepest history of very large accounts. The provider seam exists so a future archive-node or paid full-history source is a provider swap, not a service rewrite.

## Published Contract — `'account-history'` → `IAccountHistoryService`

| Method | Purpose |
|--------|---------|
| `addTrackedAccount({ address, label? })` | Begin tracking (idempotent on address) |
| `removeTrackedAccount(address)` | Stop tracking; retains stored history |
| `setAccountPaused(address, paused)` | Pause/resume one account, preserving its cursor |
| `listTrackedAccounts()` | The tracked set, oldest first |
| `getSettings()` / `updateSettings(patch)` | Read / merge pacing (`ingestionEnabled`, `pagesPerTick`, `accountsPerTick`) |
| `getStats()` | Settings + per-account progress + rollups (admin page and live payload) |
| `getTransactions({ address, limit?, offset? })` | Paged history read returning `IBlockTransaction[]` |
| `runIngestionTick()` | Advance ingestion one bounded slice (scheduler + manual trigger) |

Consume from a plugin via `context.services.watch('account-history', ...)`; from a module via constructor DI or the registry.

## REST Endpoints (`requireAdmin`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/system/account-history/stats` | Full stats snapshot |
| GET/PATCH | `/api/admin/system/account-history/settings` | Read / update pacing |
| POST | `/api/admin/system/account-history/ingest/run` | Manual ingestion tick |
| GET/POST | `/api/admin/system/account-history/accounts` | List / add tracked accounts |
| GET | `/api/admin/system/account-history/accounts/:address/transactions` | Paged history |
| PATCH | `/api/admin/system/account-history/accounts/:address/paused` | Pause/resume |
| DELETE | `/api/admin/system/account-history/accounts/:address` | Stop tracking |

## Ingestion Contract

`runIngestionTick()` selects the least-recently-advanced unpaused, not-complete accounts (up to `accountsPerTick`) and, for each, walks both endpoints (`tx` then `trc20`) up to `pagesPerTick` pages each, writing rows to ClickHouse and advancing **each endpoint's own cursor** after every clean write. A failed tick persists each cursor at its last cleanly-written page so the next tick resumes without re-counting or re-fetching. An account becomes `complete` only when both endpoints exhaust. ReplacingMergeTree keyed `(account, timestamp, tx_id, source, to_address)` absorbs paging/retry overlaps, so re-ingest is idempotent. The pacing dials throttle *down* only — they cannot exceed the shared TronGrid rate limiter that protects live block sync.

Progress is expressed as absolute counts plus the oldest timestamp reached, never a percentage: fingerprint paging never reveals an account's total transaction count up front.

## Storage

**ClickHouse `account_transactions`** — `ReplacingMergeTree(ingested_at)`, `PARTITION BY toYYYYMM(timestamp)`, `ORDER BY (account, timestamp, tx_id, source, to_address)`. Columns flatten `IBlockTransaction` plus `account`, `source`, the TRC20 `token_amount`/`token_symbol`/`token_decimals`, and `ingested_at`. No TTL — account history is the product.

**Mongo control collections** — `tracked` (the set, unique `address`), `progress` (resumable cursor per address, unique `address`), `settings` (singleton, keyed `settings`).

## Related

- [system-database.md](../../../../docs/system/system-database.md) — `IDatabaseService` access
- [system-database-migrations.md](../../../../docs/system/system-database-migrations.md) — ClickHouse-targeted migrations
- [Traffic Module README](../traffic/README.md) — the sibling ClickHouse consumer this mirrors
- [system-domain-types.md](../../../../docs/system/system-domain-types.md) — why reads return `IBlockTransaction`
