# System Dashboard

The System Dashboard is the cross-cutting observability surface at `/system/system` (default landing page when navigating to `/system`). It joins per-subsystem health probes into one tabbed surface for triage, and acts as the operator's entry point to the module-owned admin pages that live as siblings under `/system/*`.

## Why This Matters

Scheduler jobs fail silently, blockchain sync stalls without warning, observers fall behind. The dashboard surfaces real-time signals from every subsystem and exposes the manual sync trigger so operators resolve issues without backend restarts. Module-specific operations (job toggles, log queries, plugin management) live on dedicated sibling pages — the dashboard is the triage map, not a jack-of-all-trades.

## Accessing the Dashboard

### Authentication Workflow

Admin authority comes from `admin` group membership, not a JS-readable token. The `requireAdmin` middleware admits a Better Auth admin session or the service token — see [system-auth.md](./system-auth.md).

**How to become an admin.** Sign in via the header (email-OTP / OAuth / passkey) with an account in the `admin` group; the `/system` nav and routes unlock immediately — no wallet required. Get into the group via `ADMIN_EMAILS` on signup (the Better Auth after-create hook auto-promotes a matching verified email) or the Groups editor on `/system/users`. Navigating to `/system` then passes `requireAdmin`, which confirms the session is in the `admin` group.

**Service token alternative:** scripts, CI, and the first-admin bootstrap use `ADMIN_API_TOKEN` via the `x-admin-token` header (or `Authorization: Bearer`). Intended for automation, not human operators in the browser. Protect like any production secret and rotate on suspected compromise — human admins authenticate via Better Auth and are unaffected by token rotation.

## The System Page

`/system/system` splits its sections across an in-page tab row. The row is a menu, not a hand-rolled control: the tabs are nodes in the `system` menu namespace rendered with `MenuNavClient` (the menu module's [Submenu Pattern](../../src/backend/modules/menu/README.md#submenu-pattern-namespaced-tab-rows)), so they inherit per-user gating, ordering, and live `menu:update` refresh. Each tab carries a `?tab=` deep link the server entry reads SSR-first.

A tab's panel mounts only while that tab is active, so its fetches fire when the operator arrives rather than on page load. The Pipeline tab is the exception in one respect: it is the default, so its payload is fetched on the server and the tab renders with real figures on first paint.

| Tab | Section | Component | Fetches | Purpose |
|---|---|---|---|---|
| Pipeline (default) | Whole tab | `PipelineTab` | `/blockchain/pipeline` every 5 s | Block ingestion, top to bottom in the order an operator asks: a Healthy/Degraded/Stalled banner with reasons; the heights flow (chain head → fetched → buffered → committed, with the gap on each connector); one card each for Fetch, Enrich, Buffer, and Commit with their figures, p50/p95 timings, and control (Run sync now, the receipts switch, a link to the buffer settings); error history and backfill; recent blocks with receipt outcome and decoded events; and the observer table |
| Server | Refresh readout, Server | `ServerTab`, `ServerSection` | `/health/redis`, `/health/server`, `/health/infrastructure` | Droplet CPU/load/memory/disk; per-container CPU, memory, health, restarts; Redis ping, key count, evictions; process uptime and heap |
| Configuration | System Config | `SystemConfigSection` | GET/PATCH `/config/system` | Edit `siteUrl` from the UI |
| Configuration | Sign-in button image | `AuthButtonImageSection` | GET/PATCH `/config/system` | Choose an image with the file picker to replace the header's sign-in button; the header reads it per request from the public `GET /api/config/branding`. Choosing needs an enabled files provider (`trp-files` by default) |
| Configuration | Block feed buffer | `EmitBufferSection` | GET/PATCH `/config/system` | Tune the feed's playout buffer; saving applies to the running feed with no restart |
| Configuration | Providers, TronGrid | `ProviderVendorSections`, `TronGridProviderSection` | Provider config endpoints | Runtime configuration for external data providers, including the block receipts switch |
| Schedules | Block pipeline jobs | `SchedulerMonitor` | `/scheduler/status` | `blockchain:*` and `network-activity:*` jobs, scoped by name prefix |
| Logs | Block pipeline logs | `SystemLogsMonitor` | `/logs` | Entries under the `tronrelic:blockchain` service, which the blockchain module and its scheduler jobs log to |
| WebSockets | WebSockets | `WebSocketsSection` | `/websockets/stats`, `/websockets/aggregate` | Per-plugin and aggregate WS metrics |
| MongoDB | MongoDB | `MongoSection` | `/health/database`, `/migrations/status`, `/migrations/history` | Connection state, db size, migration runs |
| ClickHouse | ClickHouse | `ClickHouseSection` | `/health/clickhouse` | Connection state, table count, db size |

The Pipeline tab replaced the Blockchain card that used to sit below the Server console on an Overview tab. Admins found that card hard to use for monitoring ingestion: it showed two lag figures that meant nearly the same thing, never showed how far fetching had got, dropped figures the backend already computed (commit queue, backfill size, receipt timing), turned a single failed request into "No observers registered," and kept only one error, which the next healthy tick erased. The Pipeline tab's health verdict and tones are computed on the backend, so the banner, the figures, and a script reading the endpoint agree. The old `?tab=overview` link opens the Pipeline tab.

Because a panel mounts with its tab, its polling runs only while an operator is actually looking at it. That load is what the split rate-limit buckets on `/api/admin/system` are sized against — see the 429 note in [system-api.md](./system-api.md#troubleshooting).

Tab nodes are registered memory-only in `registerTemporaryMenuItems` (`src/backend/index.ts`), so the row rebuilds on every boot. Section sources: `src/frontend/app/(core)/system/system/components/`. For payload details and the cross-link to runtime config restart semantics, see [system-api-overview.md](./system-api-overview.md).

## Module-Owned Admin Pages

Other admin features live on dedicated pages — each owned by its module and documented in that module's canonical doc. The dashboard nav links to them; this file does not duplicate their content.

| Page | Owned by | Canonical doc |
|---|---|---|
| `/system/scheduler` | Scheduler module | [system-scheduler-operations.md](./system-scheduler-operations.md) |
| `/system/logs` | Logs module | [system-logging.md](./system-logging.md) |
| `/system/plugins` | Plugin loader | [../plugins/plugins.md](../plugins/plugins.md) |
| `/system/pages` | Pages module | [Pages Module README](../../src/backend/modules/pages/README.md) |
| `/system/menu` | Menu module | [Menu Module README](../../src/backend/modules/menu/README.md) |
| `/system/users` | Identity module | [Identity Module README](../../src/backend/modules/identity/README.md) |
| `/system/traffic` | Traffic module | [Traffic Module README](../../src/backend/modules/traffic/README.md) |
| `/system/theme` | Theme system | [ui-theme.md](../frontend/ui/ui-theme.md) |
| `/system/address-labels` | Address Labels module | `src/backend/modules/address-labels/` (no README yet) |
| `/system/logout` | — | Clears cookie and redirects |

## Common Diagnostic Flows

The System page is the triage map. Identify *which* subsystem is degraded, then either act on it from the page directly or click into the owning module's admin page for deeper control.

| Symptom | Where to look | Action |
|---|---|---|
| Frontend transactions stale, observers silent | Pipeline → the banner's reasons, then the heights flow: the connector whose gap is growing names the stuck stage | Fetch stalled: check the Fetch card's job badge and last tick, then **Run sync now**. Commit backed up: the Commit card and the error history. See [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) |
| Token transfers or energy figures missing for recent blocks | Pipeline → Enrich card — receipts switch, coverage, and missed count; Recent blocks table for per-block outcome | Turn receipts on from the card, or investigate partial/failed receipt fetches in the error history |
| An observer falling behind | Pipeline → Observers table; rows needing attention sort first, queues are shown against each observer's capacity | Inspect that plugin's logs; a queue near capacity will start dropping work |
| Scheduler not advancing | Pipeline → Fetch card job badge and last tick; Schedules tab for the pipeline jobs | Toggle or reschedule the job on the Schedules tab or `/system/scheduler` |
| Droplet CPU or memory climbing | Server → Droplet, then the Containers table to attribute it | Resize the droplet, or restart the container carrying the growth once identified |
| Backend memory climbing | Server → Backend Process — heap/RSS trend | Restart the container if growth doesn't plateau; correlate with observer queue depth |
| A container crash-looping | Server → Containers — non-zero **Restarts**, or a state other than `running` | Tail that container's logs; the row's health column distinguishes a failing healthcheck from a stopped process |
| Disk filling | Server → Droplet — `Disk /` and `Disk clickhouse:*` cells turn amber at 75%, red at 90% | ClickHouse `traffic_events` is the usual cause; see the storage notes in [operations-server-info.md](../../../docs/operations/operations-server-info.md) |
| Redis evictions > 0 | Server (Redis Cache block) | Memory pressure; investigate caching keys or raise Redis maxmemory |
| WebSocket spikes | WebSockets tab — find offending plugin via `mostActiveEmitter` | Inspect that plugin's logs at `/system/logs` filtered by `service` |
| Feed stutters; emit buffer underruns climbing | Pipeline → Buffer card — underrun count and when the last one happened | Use the card's **Buffer settings** button to raise the target depth. It applies to the running feed immediately, so watch the same card to judge the new value (see [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md#buffer-settings)) |
| Site URL needs updating | Configuration tab | Edit inline; **restart the frontend container** for SSR cache to refresh (see [system-runtime-config.md](./system-runtime-config.md#runtime-reconfiguration)) |
| Log level or retention needs updating | Logs page (`/system/logs`) | Moved off this page — edit there (see [system-logging.md](./system-logging.md)) |
| Need to inspect a specific error | Logs page (`/system/logs`) | Filter by level/service; resolve to clear from unresolved counts |

## Troubleshooting

### Cannot Access Dashboard (401 Unauthorized)

**Cause:** Session resolution failed and no valid service token was provided. The middleware tries the Better Auth session first; the service-token branch produces 401 on missing or invalid tokens (or 503 when `ADMIN_API_TOKEN` is unset entirely).

**Session path (humans):**
1. Confirm you're signed in — a Better Auth session cookie should exist in devtools → Application → Cookies. If absent, sign in via the header auth button.
2. Confirm your account is in the `admin` group on `/system/users` (ask a current admin if not).

**Service token (scripts/CI):**
1. Verify `ADMIN_API_TOKEN` is set in backend `.env` and the backend was restarted after the change.
2. Send via `x-admin-token` or `Authorization: Bearer`; query-param auth is intentionally unsupported.
3. Trim whitespace/quotes — strict equality.

### Dashboard Shows "No Data" or Empty Metrics

Fresh install before the scheduler has run, a backend that just restarted (pipeline telemetry is in memory and starts empty), or the scheduler globally disabled. Confirm `ENABLE_SCHEDULER=true`, wait one `blockchain:sync` tick (15 seconds by default), or use **Run sync now** on the Pipeline tab's Fetch card.

### Section Reports Disconnected (Mongo / Redis / ClickHouse)

The probe will return `connected: false` immediately rather than 503; check the corresponding container with `docker ps`, tail its logs, and verify connection strings in backend `.env`. The dashboard does not cache — once the dependency comes back, the next probe poll surfaces it.

## Further Reading

- [system.md](./system.md) — System architecture overview
- [system-api.md](./system-api.md) — Admin API reference for everything the dashboard fetches
- [system-api-overview.md](./system-api-overview.md) — Health probe and config endpoint details
- [system-runtime-config.md](./system-runtime-config.md) — Why `siteUrl` edits need a frontend restart
- [environment.md](../environment.md) — `ADMIN_API_TOKEN`, `ENABLE_SCHEDULER`, `BETTER_AUTH_SECRET`
