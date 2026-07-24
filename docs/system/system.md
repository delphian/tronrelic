# System Architecture Overview

These documents cover the **backend** — everything under `src/backend/`. For the frontend, see [docs/frontend/frontend.md](../frontend/frontend.md).

The system layer orchestrates blockchain sync, job scheduling, observer notification, real-time metrics, and runtime configuration — the data pipelines every TronRelic feature depends on.

## Why This Matters

When the system layer stalls, transactions stop indexing, market prices go stale, observers receive nothing. Use this file to find the right detail doc; read the detail doc before changing the subsystem. Each component below gets one row — the linked doc is canonical.

## Components

| Component | Purpose | Canonical docs |
|---|---|---|
| Runtime Configuration | One universal Docker image, any domain: `siteUrl` lives in MongoDB, SSR injects `window.__RUNTIME_CONFIG__`; no `NEXT_PUBLIC_*` | [system-runtime-config.md](./system-runtime-config.md) |
| Backend Modules | Non-toggleable core infrastructure with a two-phase `init()`/`run()` lifecycle, typed DI, fail-fast | [modules.md](./modules/modules.md), [modules-architecture.md](./modules/modules-architecture.md), [modules-creating.md](./modules/modules-creating.md) |
| Database Access | All DB I/O through `IDatabaseService` (three tiers, `plugin_<id>_*` prefixing); direct Mongoose imports prohibited | [system-database.md](./system-database.md) |
| Blockchain Sync | Serial TronGrid block pull (200ms throttle), USD/energy enrichment, async observer dispatch, bounded pending queue | [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) |
| Scheduler | Six built-in cron jobs, runtime-toggleable; `blockchain:sync`, `chain-parameters:fetch`, `usdt-parameters:fetch` are critical; global kill `ENABLE_SCHEDULER=false` | [system-scheduler-operations.md](./system-scheduler-operations.md) |
| Monitoring API | Admin-token-gated endpoints for sync status, scheduler control, health, WebSocket diagnostics | [system-api.md](./system-api.md) |
| Dashboard | Tabbed `/system` UI (requires `ADMIN_API_TOKEN`) over the monitoring API | [system-dashboard.md](./system-dashboard.md) |
| Auth & Authorization | Better Auth at `/api/auth/*`; `req.authSession` resolved once per request; gate via predicates (`isLoggedIn`/`isInGroup`/`isAdmin`) | [system-auth.md](./system-auth.md) |
| Identity | Owns Better Auth, groups, signature-proven wallets, account directory, per-user settings; publishes `'accounts'`, `'wallets'`, `'user-groups'`, `'user-settings'` | [Identity README](../../src/backend/modules/identity/README.md) |
| Menu | Navigation nodes from core and plugins; DB-backed and memory-only entries, namespaces, `menu:update` events | [Menu README](../../src/backend/modules/menu/README.md) |
| Widgets | Zones, placements, widget-type registration behind `'widgets'` (`IWidgetsService`); `/system/widgets` admin UI | [Widgets README](../../src/backend/modules/widgets/README.md), [system-api-widgets.md](./system-api-widgets.md) |
| Migrations | Auto-discovered schema migrations, topologically sorted, transaction-wrapped, audited | [system-database-migrations.md](./system-database-migrations.md) |
| Pages | Markdown CMS (`IPageService` + swappable `IStorageProvider`), Redis-cached rendering, route blacklist | [Pages README](../../src/backend/modules/pages/README.md) |
| Tools | Stateless TRON utility calculators under `/api/tools/*` (address, energy, stake, signature, approvals, timestamp) | [Tools README](../../src/backend/modules/tools/README.md) |
| Traffic | Cookieless analytics: ClickHouse `traffic_events`, `tronrelic_tid`/`tronrelic_ref` cookies, bot/geo classification | [Traffic README](../../src/backend/modules/traffic/README.md) |
| Account History | Pull-based per-account TronGrid backfill + forward sync into ClickHouse; balance/resource snapshots; publishes `'account-history'` | [Account History README](../../src/backend/modules/account-history/README.md) |
| Price History | Local daily USD price series (TRX + TRC20) in ClickHouse behind `IPriceHistoryProvider`; publishes `'price-history'` | [Price History README](../../src/backend/modules/price-history/README.md) |
| Valuation | Per-user portfolio (net worth, holdings, FIFO PnL with internal-transfer netting) joined from local data; publishes `'valuation'` | [Valuation README](../../src/backend/modules/valuation/README.md) |
| Address Tags | Central CRUD authority for text tags on TRON wallet addresses (Mongo, array-based batches); publishes `'address-tags'`; login-gated reads, admin-gated mutations, `/system/address-tags` UI | [Address Tags README](../../src/backend/modules/address-tags/README.md) |
| Hooks | Typed core seams plugins contribute into; four archetypes (observer/series/waterfall/bail); `/system/hooks` timeline | [system-hooks.md](./system-hooks.md) |
| AI Tools | Contract, capability classes, and accountability/security for model-invocable tools; provider-neutral | [system-ai-tools.md](./system-ai-tools.md), [AI Tools README](../../src/backend/modules/ai-tools/README.md) |
| Content Types | Central registry of provider-owned content (`IContentType` → generic descriptor); published `'content-types'` | [system-content-types.md](./system-content-types.md) |
| Content Routing | Recipient List router unifying the curation/notifications/syndication sink families | [system-content-routing.md](./system-content-routing.md) |
| Curation | One `/system/curation` queue for effects held for human review; verifiable `curationTypeId` binding for AI tools | [system-curation.md](./system-curation.md), [Curation README](../../src/backend/modules/curation/README.md) |
| Notifications | Category-based dispatch by content reference; audience resolution, channel capability routing, per-user opt-outs, audit | [system-notifications.md](./system-notifications.md), [Notifications README](../../src/backend/modules/notifications/README.md) |
| Syndication | Durable publish sinks: transactional outbox, retrying relay, idempotency, dead-letter (effectively-once) | [system-syndication.md](./system-syndication.md), [Syndication README](../../src/backend/modules/syndication/README.md) |
| Logging | Pino with MongoDB persistence for historical queries | [system-logging.md](./system-logging.md), [Logs README](../../src/backend/modules/logs/README.md) |
| Testing | Vitest + shared Mongoose mocks (in-memory collections, chainable queries, spies) | [system-testing.md](./system-testing.md) |

## Operations Quick Start

Inspect health at `/system` (auth: `ADMIN_API_TOKEN`) — fastest path to blockchain status, scheduler jobs, queue depth. Programmatic equivalents in [system-api.md](./system-api.md); troubleshooting runbooks (sync stalled, jobs not firing, queue saturation) in [system-scheduler-operations.md](./system-scheduler-operations.md).

## Detail Documents

Docs not owned by a single component row above:

| Document | Covers |
|---|---|
| [system-api-overview.md](./system-api-overview.md) | `/health/*` (database, clickhouse, redis, server), `/config`, `/config/system` |
| [system-api-blockchain.md](./system-api-blockchain.md) | Blockchain sync status, metrics, manual trigger |
| [system-api-scheduler.md](./system-api-scheduler.md) | Scheduler status, health, job PATCH |
| [system-api-logs.md](./system-api-logs.md) | System log query/resolve/delete endpoints |
| [system-api-websockets.md](./system-api-websockets.md) | WebSocket admin metrics + real-time event catalog |
| [system-block-provider-migration.md](./system-block-provider-migration.md) | Proposed TronGrid decoupling — `IBlockProvider` design, provider research, migration plan |
| [system-domain-types.md](./system-domain-types.md) | Source-independence rule for the types package — admission test, `IBlockTransaction`, known debt |

## Related

- [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) — building observers that react to transactions
- [tron-chain-parameters.md](../tron/tron-chain-parameters.md) — chain parameter caching
- [environment.md](../environment.md) — `ENABLE_SCHEDULER`, `TRONGRID_API_KEY`, `SESSION_SECRET`
