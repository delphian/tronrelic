# System Architecture Overview

The system layer orchestrates blockchain sync, job scheduling, observer notification, real-time metrics, and runtime configuration — the data pipelines every TronRelic feature depends on.

## Why This Matters

When the system layer stalls, transactions stop indexing, market prices go stale, observers receive nothing. Use this file to find the right detail doc; read the detail doc before changing the subsystem.

## Components

### Runtime Configuration

Solves Next.js build-time env inlining so a single Docker image runs on any domain. Backend stores `siteUrl` (and TRON chain parameters) in MongoDB; the frontend SSR fetches once at startup and injects as `window.__RUNTIME_CONFIG__`. No `NEXT_PUBLIC_*` in production code. See [system-runtime-config.md](./system-runtime-config.md).

### Backend Modules

Essential, non-toggleable infrastructure (Pages, Menu, User, Migrations) initialized during bootstrap. Two-phase lifecycle — `init()` resolves typed DI dependencies, `run()` mounts routes — with fail-fast errors and no degraded mode. Plugins, by contrast, are optional and runtime-toggleable. See [modules.md](./modules/modules.md), [modules-architecture.md](./modules/modules-architecture.md), [modules-creating.md](./modules/modules-creating.md).

### Database Access

All database I/O must flow through `IDatabaseService`; direct Mongoose imports are prohibited. The abstraction exposes three access tiers (raw collections, Mongoose models, convenience methods), auto-prefixes plugin collections (`plugin_<id>_*`) for namespace isolation, and accepts mock implementations for testing. See [system-database.md](./system-database.md).

### Blockchain Sync

Pulls TronGrid blocks serially with a 200ms throttle (~5 req/s) to avoid burst rate limits, enriches transactions with USD and energy data, and notifies observers asynchronously so a slow observer cannot block sync. Pending blocks are capped to prevent memory leaks; multiple TronGrid keys rotate to spread load. See [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md).

### Scheduler

Runs six built-in cron jobs, each toggleable at runtime without restart. Critical jobs — `blockchain:sync` (1m), `markets:refresh` (10m), `chain-parameters:fetch` (10m), `usdt-parameters:fetch` (10m) — drive every downstream feature; disabling any of them stales data. Safe to disable temporarily: `cache:cleanup` (memory only) and `alerts:*` (notifications only, not data collection). Global kill via `ENABLE_SCHEDULER=false`. See [system-scheduler-operations.md](./system-scheduler-operations.md).

### Monitoring API

16+ admin-token-gated endpoints covering sync status, scheduler control, market freshness, DB/Redis/server health, env config, and WebSocket diagnostics. Powers the dashboard and any custom automation. See [system-api.md](./system-api.md).

### Dashboard

Tabbed web UI at `/system` (requires `ADMIN_API_TOKEN`) for live metrics, job toggles, schedule edits, and manual sync/refresh triggers. Built on the monitoring API. See [system-dashboard.md](./system-dashboard.md).

### Menu

Centralized navigation service that aggregates menu nodes from core and plugins. Supports DB-backed and memory-only entries, multiple namespaces, and emits WebSocket events when structure changes; plugins register through lifecycle hooks — no core edits. See [Menu Module README](../../src/backend/modules/menu/README.md).

### Migrations

Schema evolution discovered automatically from system, module, and plugin directories; topologically sorted by dependency; executed serially with MongoDB transaction wrapping (replica set required) and full audit history. Admin UI at `/system/database`. See [system-database-migrations.md](./system-database-migrations.md).

### Pages

Markdown-authored CMS for admin-published content. `PageService` (singleton, implements `IPageService`) depends on `IStorageProvider`, so the storage backend (local FS, S3, custom) is swappable via DI. Rendered HTML cached in Redis 24h with auto-invalidation; a route blacklist prevents slugs from shadowing core routes. See [Pages Module README](../../src/backend/modules/pages/README.md).

### User

Visitor identity anchored on one HttpOnly, HMAC-signed `tronrelic_uid` cookie minted by the server at `POST /api/user/bootstrap` — the server is the only writer. Identity state (`Anonymous` | `Registered` | `Verified`) is stored, not derived; `Verified` requires a recent TronLink signature within `SESSION_TTL_MS`. One UUID can link multiple wallets with a primary designation. See [User Module README](../../src/backend/modules/user/README.md).

### Logging

Pino-based logger with MongoDB persistence for historical queries. See [system-logging.md](./system-logging.md).

### Testing

Vitest with shared Mongoose mocking utilities — in-memory collections, chainable queries, error injection, operation spies — so database services exercise without a live MongoDB. See [system-testing.md](./system-testing.md).

## Operations Quick Start

Inspect health from the `/system` dashboard (auth: `ADMIN_API_TOKEN`) — fastest path to blockchain status, scheduler jobs, and queue depth. For programmatic access, every endpoint is documented in [system-api.md](./system-api.md). For full troubleshooting runbooks (sync stalled, jobs not firing, queue saturation), see [system-scheduler-operations.md](./system-scheduler-operations.md).

## Detail Documents

| Document | Covers |
|---|---|
| [system-runtime-config.md](./system-runtime-config.md) | Universal Docker images, SSR config injection, `SITE_URL` |
| [modules.md](./modules/modules.md) | Module overview, module-vs-plugin matrix, service singleton rules |
| [modules-architecture.md](./modules/modules-architecture.md) | `IModule` interface, bootstrap order, DI, service registry |
| [modules-creating.md](./modules/modules-creating.md) | Step-by-step new-module guide |
| [system-database.md](./system-database.md) | `IDatabaseService`, three-tier access, namespace isolation |
| [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) | Block retrieval, enrichment pipeline, observer dispatch |
| [system-scheduler-operations.md](./system-scheduler-operations.md) | Job control, cron syntax, persistence, troubleshooting |
| [system-api.md](./system-api.md) | All admin endpoints, auth, examples |
| [system-dashboard.md](./system-dashboard.md) | Dashboard tabs and controls |
| [system-database-migrations.md](./system-database-migrations.md) | Migration discovery, transactions, REST API, admin UI |
| [system-logging.md](./system-logging.md) | Pino, MongoDB persistence, log queries |
| [Menu Module README](../../src/backend/modules/menu/README.md) | Menu service, plugin integration, WebSocket events |
| [Pages Module README](../../src/backend/modules/pages/README.md) | Markdown CMS, storage providers, file uploads |
| [User Module README](../../src/backend/modules/user/README.md) | Identity cookie, wallet linking, admin UI |
| [system-testing.md](./system-testing.md) | Vitest, Mongoose mocks, fixtures |

## Related

- [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) — building observers that react to transactions
- [market-system-architecture.md](../markets/market-system-architecture.md) — market fetcher pipeline
- [tron-chain-parameters.md](../tron/tron-chain-parameters.md) — chain parameter caching
- [environment.md](../environment.md) — `ENABLE_SCHEDULER`, `TRONGRID_API_KEY`, `SESSION_SECRET`
