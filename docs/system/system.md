# System Architecture Overview

These documents cover the **backend** — everything under `src/backend/`. For the frontend, see [docs/frontend/frontend.md](../frontend/frontend.md).

The system layer runs the data pipelines every TronRelic feature depends on: pulling blocks from the TRON blockchain, scheduling recurring jobs, notifying the components that react to new transactions, collecting real-time metrics, and serving runtime configuration.

## Why This Matters

If the system layer stalls, transactions stop being indexed, market prices go stale, and observers stop receiving transactions. Use this page to find the right detail document, then read that document before changing the subsystem. Each component below gets one row, and the document linked from that row is the canonical reference.

## Terms Used Below

A few names recur throughout the table and are worth defining once.

An **observer** is a component that subscribes to particular TRON contract types and runs when a matching transaction arrives during blockchain sync. A component **publishes a service** when it registers itself in the service registry under a quoted name such as `'accounts'`, which lets other modules and plugins find it at runtime without importing it directly. A **hook seam** is a named point in core's own execution where a plugin or module can contribute behaviour, such as injecting markup into the HTML `<head>` during server-side rendering. **Admin-gated** means the endpoint or page requires the `ADMIN_API_TOKEN` credential.

## Components

| Component | Purpose | Canonical docs |
|---|---|---|
| Runtime Configuration | Lets one Docker image serve any domain. The `siteUrl` value lives in MongoDB, and server-side rendering injects it into the page as `window.__RUNTIME_CONFIG__`. No `NEXT_PUBLIC_*` variables are used. | [system-runtime-config.md](./system-runtime-config.md) |
| Backend Modules | Core infrastructure that cannot be switched off, built on a two-phase `init()` then `run()` lifecycle with typed dependency injection. Any failure stops startup. | [modules.md](./modules/modules.md), [modules-architecture.md](./modules/modules-architecture.md), [modules-creating.md](./modules/modules-creating.md) |
| Database Access | All database reads and writes go through `IDatabaseService`, which offers three levels of access and automatically prefixes plugin collections with `plugin_<id>_*`. Importing Mongoose directly is prohibited. | [system-database.md](./system-database.md) |
| Blockchain Sync | Pulls blocks from TronGrid one at a time with a 200ms delay between calls, enriches each transaction with USD and energy figures, dispatches to observers asynchronously, and buffers work in a queue with a fixed size limit. | [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) |
| Scheduler | Runs six built-in recurring jobs that operators can toggle at runtime. `blockchain:sync`, `chain-parameters:fetch`, and `usdt-parameters:fetch` are the critical ones. `ENABLE_SCHEDULER=false` disables all of them. | [system-scheduler-operations.md](./system-scheduler-operations.md) |
| Monitoring API | Admin-gated endpoints reporting sync status, controlling the scheduler, checking health, and diagnosing WebSocket connections. | [system-api.md](./system-api.md) |
| Dashboard | The tabbed `/system` interface built over the monitoring API. Requires `ADMIN_API_TOKEN`. | [system-dashboard.md](./system-dashboard.md) |
| Auth & Authorization | Better Auth serves `/api/auth/*`. Each request resolves its session once into `req.authSession`, and routes are gated with the predicates `isLoggedIn`, `isInGroup`, and `isAdmin`. | [system-auth.md](./system-auth.md) |
| Identity | Owns Better Auth, user groups, wallets proven by signature, the account directory, and per-user settings. Publishes `'accounts'`, `'wallets'`, `'user-groups'`, and `'user-settings'`. | [Identity README](../../src/backend/modules/identity/README.md) |
| Menu | Holds navigation entries contributed by core and by plugins, supporting both database-backed and memory-only entries, grouping by namespace, and live `menu:update` events. | [Menu README](../../src/backend/modules/menu/README.md) |
| Widgets | Manages zones, placements, and widget-type registration behind the `'widgets'` service (`IWidgetsService`), with an admin interface at `/system/widgets`. | [Widgets README](../../src/backend/modules/widgets/README.md), [system-api-widgets.md](./system-api-widgets.md) |
| Migrations | Discovers schema migrations automatically, orders them by their declared dependencies, wraps each in a transaction, and records what ran. | [system-database-migrations.md](./system-database-migrations.md) |
| Pages | A markdown content management system built from `IPageService` and a swappable `IStorageProvider`, with rendered output cached in Redis and a list of routes it may not claim. | [Pages README](../../src/backend/modules/pages/README.md) |
| Tools | Stateless TRON calculators served under `/api/tools/*`, covering addresses, energy, staking, signatures, token approvals, and timestamps. | [Tools README](../../src/backend/modules/tools/README.md) |
| Traffic | Records visits in the ClickHouse `traffic_events` table, where the `tronrelic_tid` and `tronrelic_ref` cookies carry visit context and each event is classified by bot likelihood and geography. IP addresses are stored only as hashes, and an event recorded for a logged-in visitor also carries the Better Auth user id. | [Traffic README](../../src/backend/modules/traffic/README.md) |
| Account History | Backfills an account's history from TronGrid on demand and then keeps it current, storing results plus balance and resource snapshots in ClickHouse. Publishes `'account-history'`. | [Account History README](../../src/backend/modules/account-history/README.md) |
| Price History | Keeps a local daily USD price series for TRX and TRC20 tokens in ClickHouse, behind the `IPriceHistoryProvider` interface. Publishes `'price-history'`. | [Price History README](../../src/backend/modules/price-history/README.md) |
| Valuation | Builds a per-user portfolio from local data alone: net worth, holdings, and profit and loss calculated first-in-first-out, with transfers between a user's own wallets netted out. Publishes `'valuation'`. | [Valuation README](../../src/backend/modules/valuation/README.md) |
| Address Tags | The single authority for creating, reading, updating, and deleting text tags on TRON wallet addresses, stored in MongoDB in batched arrays. Publishes `'address-tags'`. Reads require login, changes require admin, and `/system/address-tags` is the interface. | [Address Tags README](../../src/backend/modules/address-tags/README.md) |
| Hooks | The typed seams where plugins contribute into core execution, in four styles (observer, series, waterfall, and bail), with a timeline at `/system/hooks` showing what is registered. | [system-hooks.md](./system-hooks.md) |
| AI Tools | The contract, capability classes, and accountability and security rules for tools an AI model can invoke. Independent of any particular AI vendor. | [system-ai-tools.md](./system-ai-tools.md), [AI Tools README](../../src/backend/modules/ai-tools/README.md) |
| Content Types | The central registry describing content owned by each provider, mapping an `IContentType` to a generic descriptor. Publishes `'content-types'`. | [system-content-types.md](./system-content-types.md) |
| Content Routing | Routes a piece of content to a list of recipients, giving curation, notifications, and syndication one shared delivery path. | [system-content-routing.md](./system-content-routing.md) |
| Curation | A single queue at `/system/curation` holding actions that need a human to approve them, including a `curationTypeId` binding that AI tools cannot forge. | [system-curation.md](./system-curation.md), [Curation README](../../src/backend/modules/curation/README.md) |
| Notifications | Dispatches by content reference and category: works out the audience, routes to channels that can carry the message, honours per-user opt-outs, and records an audit trail. | [system-notifications.md](./system-notifications.md), [Notifications README](../../src/backend/modules/notifications/README.md) |
| Syndication | Durable publishing to external destinations. Writes go to an outbox in the same transaction as the change, a relay retries them, duplicate sends are suppressed, and permanent failures land in a dead-letter store. | [system-syndication.md](./system-syndication.md), [Syndication README](../../src/backend/modules/syndication/README.md) |
| Logging | Pino for structured logging, persisted to MongoDB so past logs stay queryable. | [system-logging.md](./system-logging.md), [Logs README](../../src/backend/modules/logs/README.md) |
| Testing | Vitest plus shared Mongoose mocks providing in-memory collections, chainable queries, and spies. | [system-testing.md](./system-testing.md) |

## Operations Quick Start

The fastest way to check blockchain status, scheduler jobs, and queue depth is the `/system` dashboard, which authenticates with `ADMIN_API_TOKEN`. The equivalent endpoints for scripting are documented in [system-api.md](./system-api.md). Runbooks for the common failures — sync stalled, jobs not firing, queue filling up — are in [system-scheduler-operations.md](./system-scheduler-operations.md).

## Detail Documents

These documents are not owned by any single component row above.

| Document | Covers |
|---|---|
| [system-api-overview.md](./system-api-overview.md) | The `/health/*` probes for database, ClickHouse, Redis, server, and infrastructure, plus `/config` and `/config/system` |
| [system-api-blockchain.md](./system-api-blockchain.md) | Blockchain sync status, metrics, and triggering a sync by hand |
| [system-api-scheduler.md](./system-api-scheduler.md) | Scheduler status, health, and updating a job with `PATCH` |
| [system-api-logs.md](./system-api-logs.md) | Querying, resolving, and deleting system log entries |
| [system-api-websockets.md](./system-api-websockets.md) | WebSocket metrics for administrators, and the catalog of real-time events |
| [system-block-provider-migration.md](./system-block-provider-migration.md) | The proposal to decouple from TronGrid: the `IBlockProvider` design, research into alternative providers, and the migration plan |
| [system-domain-types.md](./system-domain-types.md) | Why the types package must not depend on any one data source, the test for admitting a type, `IBlockTransaction`, and the known exceptions |

## Related

- [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) — how to build observers that react to transactions
- [tron-chain-parameters.md](../tron/tron-chain-parameters.md) — how chain parameters are fetched and cached
- [environment.md](../environment.md) — behaviour of `ENABLE_SCHEDULER`, `TRONGRID_API_KEY`, and `SESSION_SECRET`
