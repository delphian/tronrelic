# System Architecture Overview

These documents cover the **backend** — everything under `src/backend/`. For the frontend, see [docs/frontend/frontend.md](../frontend/frontend.md).

The system layer orchestrates blockchain sync, job scheduling, observer notification, real-time metrics, and runtime configuration — the data pipelines every TronRelic feature depends on.

## Why This Matters

When the system layer stalls, transactions stop indexing, market prices go stale, observers receive nothing. Use this file to find the right detail doc; read the detail doc before changing the subsystem.

## Components

### Runtime Configuration

Solves Next.js build-time env inlining so a single Docker image runs on any domain. Backend stores `siteUrl` (and TRON chain parameters) in MongoDB; the frontend SSR fetches once at startup and injects as `window.__RUNTIME_CONFIG__`. No `NEXT_PUBLIC_*` in production code. See [system-runtime-config.md](./system-runtime-config.md).

### Backend Modules

Non-toggleable infrastructure (Pages, Menu, Identity, Traffic, Migrations) initialized during bootstrap. Two-phase lifecycle — `init()` resolves typed DI dependencies, `run()` mounts routes — fail-fast, no degraded mode. Plugins, by contrast, are optional and runtime-toggleable. See [modules.md](./modules/modules.md), [modules-architecture.md](./modules/modules-architecture.md), [modules-creating.md](./modules/modules-creating.md).

### Database Access

All database I/O must flow through `IDatabaseService`; direct Mongoose imports are prohibited. The abstraction exposes three access tiers (raw collections, Mongoose models, convenience methods), auto-prefixes plugin collections (`plugin_<id>_*`) for namespace isolation, and accepts mock implementations for testing. See [system-database.md](./system-database.md).

### Blockchain Sync

Pulls TronGrid blocks serially with a 200ms throttle (~5 req/s) to avoid burst rate limits, enriches transactions with USD and energy data, and notifies observers asynchronously so a slow observer cannot block sync. Pending blocks are capped to prevent memory leaks; multiple TronGrid keys rotate to spread load. See [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md).

### Scheduler

Runs six built-in cron jobs, each toggleable at runtime without restart. Critical jobs — `blockchain:sync` (1m), `chain-parameters:fetch` (10m), `usdt-parameters:fetch` (10m) — drive every downstream feature; disabling any of them stales data. Safe to disable temporarily: `cache:cleanup` and `system-logs:cleanup`. Global kill via `ENABLE_SCHEDULER=false`. See [system-scheduler-operations.md](./system-scheduler-operations.md).

### Monitoring API

Admin-token-gated endpoints covering sync status, scheduler control, DB/Redis/server health, env config, and WebSocket diagnostics. Powers the dashboard. See [system-api.md](./system-api.md).

### Dashboard

Tabbed web UI at `/system` (requires `ADMIN_API_TOKEN`) for live metrics, job toggles, schedule edits, and manual sync/refresh triggers. Built on the monitoring API. See [system-dashboard.md](./system-dashboard.md).

### Menu

Navigation service that aggregates menu nodes from core and plugins. Supports DB-backed and memory-only entries, multiple namespaces, and emits WebSocket events when structure changes; plugins register through lifecycle hooks — no core edits. See [Menu Module README](../../src/backend/modules/menu/README.md).

### Widgets

Owns the widget subsystem behind one public service — `IWidgetsService`, registry name `'widgets'` — covering zone definitions, per-zone flexbox layout, placement persistence, widget-type registration (including the core `core:block-ticker`, `core:world-clocks`, and `core:raw-html` types), and the `/system/widgets` admin UI. Plugins, modules, admin controllers, and the SSR router reach widgets only through this service; there is no other entry point. See [Widgets Module README](../../src/backend/modules/widgets/README.md) and [system-api-widgets.md](./system-api-widgets.md).

### Migrations

Schema evolution discovered automatically from system, module, and plugin directories; topologically sorted by dependency; executed serially with MongoDB transaction wrapping (replica set required) and full audit history. See [system-database-migrations.md](./system-database-migrations.md).

### Pages

Markdown-authored CMS for admin-published content. `PageService` (singleton, implements `IPageService`) depends on `IStorageProvider`, so the storage backend (local FS, S3, custom) is swappable via DI. Rendered HTML cached in Redis 24h with auto-invalidation; a route blacklist prevents slugs from shadowing core routes. See [Pages Module README](../../src/backend/modules/pages/README.md).

### Tools

User-facing TRON utilities — address-format conversion, energy estimation, bidirectional stake calculation, signature verification, token-approval checking, timestamp/block conversion — each on its own page under the Tools menu, served from `/api/tools/*`. Stateless: no collections of its own; calculations read the shared `transactions` collection and live `ChainParametersService` values. See [Tools Module README](../../src/backend/modules/tools/README.md).

### Authentication & Authorization

Identity runs on Better Auth (email-OTP / OAuth / passkey), mounted at `/api/auth/*`. The `attachAuthSession` middleware resolves the session once per request onto `req.authSession`; modules and plugins gate through predicates (`isLoggedIn` / `isInGroup` / `isAdmin`, plus `hasPrimaryWallet` for plugins) rather than reading session fields. See [system-auth.md](./system-auth.md).

### Identity

The identity module owns Better Auth and everything keyed by the Better Auth user id: the auth instance (above), the `GroupService` (admin/group membership), the signature-proven wallet store, and the account directory. It publishes `'accounts'`, `'wallets'`, and `'user-groups'` on the service registry so plugins and modules reach account data without touching `module_user_auth_*` directly. See [Identity Module README](../../src/backend/modules/identity/README.md) and [system-auth.md](./system-auth.md).

### Traffic

The traffic module owns cookieless behavioral analytics: the ClickHouse `traffic_events` store, the `tronrelic_tid`/`tronrelic_ref` cookies, bot classification, and geo/device derivation. It backs the `/system/traffic` analytics, crawler, and SEO dashboards. See [Traffic Module README](../../src/backend/modules/traffic/README.md).

### Hooks

Typed extension points where core invites plugins into its own execution. Descriptors declared in `src/backend/hooks/registry.ts` are the single source of truth; the runtime registry refuses unknown descriptors, enforces per-plugin handler caps, and serves a snapshot to the `/system/hooks` admin timeline. Four archetypes (observer / series / waterfall / bail) with explicit isolation and abort semantics. See [system-hooks.md](./system-hooks.md).

### AI Tools

The contract and governance for tools a model can invoke during an AI query. Core owns the tool shape, the capability classes (read / write / external, sensitivity, reversibility), and the accountability and security every tool must meet — input validation, object authorization, rate/quota/cost limits, human approval for irreversible effects, and per-invocation audit — so every AI provider plugin and tool inherits the same guarantees. Provider-neutral: `trp-ai-assistant` is only the Anthropic transport. See [system-ai-tools.md](./system-ai-tools.md) and [AI Tools Module README](../../src/backend/modules/ai-tools/README.md).

### Content Types

The central registry of provider-owned content — the reusable noun the platform renders, holds, decides, or delivers without understanding its payload. A provider registers an `IContentType` (`typeId`, `label`, `describe(ref)` → a generic descriptor, optional `applyEdit`); pipelines bind their own verbs onto it. Constructed in bootstrap as a peer of the service and hook registries, published as `'content-types'` before module init, and introspected read-only at `/system/content-types`. Curation and notifications both consume it. See [system-content-types.md](./system-content-types.md).

### Curation

One core admin surface (`/system/curation`, owned by the Curation module) for every effect held for human review before it takes hold. Plugins register an `ICurationType` — a [content type](./system-content-types.md) plus `onApprove`/`onReject` verbs; core owns the decision and a pointer-plus-preview envelope while the type owns the payload and what approval does. It also hardens a tool's `forcesCuratorReview` into a verifiable `curationTypeId` binding the AI tool governor checks live against the published `'curation'` service. See [system-curation.md](./system-curation.md).

### Notifications

Category-based notification dispatch behind one published service — `INotificationService`, registry name `'notifications'`. Any module or plugin declares a category and a content type, then fires by reference (`notify({ category, typeId, ref })`); the module resolves the audience (groups/users) to recipients, resolves the content type into a descriptor, routes to the channels whose declared capabilities can render it, enforces admin policy and per-user opt-outs, and audits every blast. Delivery is identity-targeted over WebSocket `user:${id}` rooms so per-user silencing is enforced server-side. The first consumer is the AI scheduler, which toasts admins when a cron prompt runs. See [system-notifications.md](./system-notifications.md) and [Notifications Module README](../../src/backend/modules/notifications/README.md).

### Logging

Pino-based logger with MongoDB persistence for historical queries. See [system-logging.md](./system-logging.md) and [Logs Module README](../../src/backend/modules/logs/README.md).

### Testing

Vitest with shared Mongoose mocking utilities — in-memory collections, chainable queries, error injection, operation spies — so database services exercise without a live MongoDB. See [system-testing.md](./system-testing.md).

## Operations Quick Start

Inspect health at `/system` (auth: `ADMIN_API_TOKEN`) — fastest path to blockchain status, scheduler jobs, queue depth. Programmatic equivalents in [system-api.md](./system-api.md); troubleshooting runbooks (sync stalled, jobs not firing, queue saturation) in [system-scheduler-operations.md](./system-scheduler-operations.md).

## Detail Documents

| Document | Covers |
|---|---|
| [system-runtime-config.md](./system-runtime-config.md) | Universal Docker images, SSR config injection, `SITE_URL` |
| [modules.md](./modules/modules.md) | Module overview, module-vs-plugin matrix, service singleton rules |
| [modules-architecture.md](./modules/modules-architecture.md) | `IModule` interface, bootstrap order, DI, service registry |
| [modules-creating.md](./modules/modules-creating.md) | Step-by-step new-module guide |
| [system-auth.md](./system-auth.md) | Better Auth identity, `req.authSession`, authorization predicates |
| [system-database.md](./system-database.md) | `IDatabaseService`, three-tier access, namespace isolation |
| [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) | Block retrieval, enrichment pipeline, observer dispatch |
| [system-block-provider-migration.md](./system-block-provider-migration.md) | Proposed TronGrid decoupling — `IBlockProvider` design, provider research, migration plan |
| [system-domain-types.md](./system-domain-types.md) | Source-independence rule for the types package — admission test, `IBlockTransaction`, known debt |
| [system-scheduler-operations.md](./system-scheduler-operations.md) | Job control, cron syntax, persistence, troubleshooting |
| [system-api.md](./system-api.md) | Admin API gateway — auth, conventions, troubleshooting, links to per-domain detail docs |
| [system-api-overview.md](./system-api-overview.md) | `/health/*` (database, clickhouse, redis, server), `/config`, `/config/system` |
| [system-api-blockchain.md](./system-api-blockchain.md) | Blockchain sync status, metrics, manual trigger |
| [system-api-scheduler.md](./system-api-scheduler.md) | Scheduler status, health, job PATCH |
| [system-api-logs.md](./system-api-logs.md) | System log query/resolve/delete endpoints |
| [system-api-websockets.md](./system-api-websockets.md) | WebSocket admin metrics + real-time event catalog |
| [system-api-widgets.md](./system-api-widgets.md) | Widget placements admin CRUD, zone and widget-type introspection |
| [system-dashboard.md](./system-dashboard.md) | Dashboard tabs and controls |
| [system-database-migrations.md](./system-database-migrations.md) | Migration discovery, transactions, REST API, admin UI |
| [system-hooks.md](./system-hooks.md) | Declared seams, four archetypes, plugin facade, introspection, admin UI |
| [system-content-types.md](./system-content-types.md) | The central content registry, the `IContentType`/`IContentDescriptor` contract, capability routing, `/system/content-types` |
| [system-content-routing.md](./system-content-routing.md) | Unifying router, a Recipient List — primitive, classification vocabulary, sink contract, and gate seam shipped (`'content-router'`); sink families, the classification/authorization/structural-routing split, potential-vs-mandated bindings, and durable multi-sink delivery still proposed |
| [system-ai-tools.md](./system-ai-tools.md) | AI tool contract, capability classes, accountability and security requirements |
| [system-curation.md](./system-curation.md) | Central curation queue, the type contract, the verifiable `curationTypeId` binding |
| [system-notifications.md](./system-notifications.md) | Notification dispatch, the resolution pipeline, channels, per-user opt-outs, audit |
| [system-logging.md](./system-logging.md) | Pino, MongoDB persistence, log queries |
| [Menu Module README](../../src/backend/modules/menu/README.md) | Menu service, plugin integration, WebSocket events |
| [Pages Module README](../../src/backend/modules/pages/README.md) | Markdown CMS, storage providers, file uploads |
| [Identity Module README](../../src/backend/modules/identity/README.md) | Better Auth, groups, wallet store, account directory |
| [Traffic Module README](../../src/backend/modules/traffic/README.md) | ClickHouse traffic_events, tid/ref cookies, analytics |
| [Tools Module README](../../src/backend/modules/tools/README.md) | TRON utility calculators — address conversion, energy/stake math, signature verification, token approvals, timestamp/block conversion |
| [Widgets Module README](../../src/backend/modules/widgets/README.md) | `IWidgetsService`, zones, placements, widget-types, SSR router integration |
| [Logs Module README](../../src/backend/modules/logs/README.md) | `SystemLogService` singleton, `system_logs` persistence, metadata sanitizer |
| [AI Tools Module README](../../src/backend/modules/ai-tools/README.md) | Tool registry, governor, policy, invocation audit, human-approval queue |
| [Curation Module README](../../src/backend/modules/curation/README.md) | `ICurationService`, the held-item lifecycle, `/system/curation` admin surface |
| [Notifications Module README](../../src/backend/modules/notifications/README.md) | `INotificationService`, dispatch pipeline, preferences, policy, audit, channels |
| [system-testing.md](./system-testing.md) | Vitest, Mongoose mocks, fixtures |

## Related

- [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) — building observers that react to transactions
- [tron-chain-parameters.md](../tron/tron-chain-parameters.md) — chain parameter caching
- [environment.md](../environment.md) — `ENABLE_SCHEDULER`, `TRONGRID_API_KEY`, `SESSION_SECRET`
