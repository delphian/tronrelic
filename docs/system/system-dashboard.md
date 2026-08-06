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

Every section still fetches its own admin endpoint and renders independently — there is no aggregating `/overview` API; the page joins probe results client-side. A tab's panel mounts only while that tab is active, so a section's fetch fires when the operator arrives rather than on page load.

| Tab | Section | Component | Fetches | Purpose |
|---|---|---|---|---|
| Overview | Refresh readout | `RefreshIndicator` | none | Reports the cadence the Overview consoles poll at, when one last succeeded, and which (if any) has stopped answering |
| Overview | Server | `ServerSection` | `/health/redis`, `/health/server`, `/health/infrastructure` | Droplet CPU/load/memory/disk; per-container CPU, memory, health, restarts; Redis ping, key count, evictions; process uptime and heap |
| Overview | Blockchain | `BlockchainSection` | `/blockchain/status`, `/metrics`, `/observers`, `/scheduler/health` | Sync lag, throughput, observer queues, **Trigger Sync Now** button |
| Configuration | System Config | `SystemConfigSection` | GET/PATCH `/config/system` | Edit `siteUrl` from the UI |
| Configuration | TronScan | `TronScanProviderSection` | GET/PATCH provider config | Runtime configuration for external data providers |
| WebSockets | WebSockets | `WebSocketsSection` | `/websockets/stats`, `/websockets/aggregate` | Per-plugin and aggregate WS metrics |
| MongoDB | MongoDB | `MongoSection` | `/health/database`, `/migrations/status`, `/migrations/history` | Connection state, db size, migration runs |
| ClickHouse | ClickHouse | `ClickHouseSection` | `/health/clickhouse` | Connection state, table count, db size |

Every section renders expanded — nothing on this page hides behind a disclosure row. Server and Blockchain each occupy their own card on the Overview tab; the other four each fill a tab of their own, where selecting the tab already expresses the intent.

The Overview tab previously opened with a telemetry strip — six tiles summarizing every subsystem, each linking to its card or tab. It was removed because the two subsystems still on that tab report the same state below in full, and the strip re-probed all seven endpoints every 15 seconds to say less. Only its refresh readout remains, since nothing else on the page reports when the consoles last updated.

Because a section mounts with its tab (or, on Overview, with the page), its polling runs only while an operator is actually looking at it. That load is what the split rate-limit buckets on `/api/admin/system` are sized against — see the 429 note in [system-api.md](./system-api.md#troubleshooting).

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
| Frontend transactions stale, observers silent | Overview → Blockchain — verify `lag` and `lastError`; check observers for rising `queueDepth` or `totalDropped` | Click **Trigger Sync Now**; for persistent backlog see [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) |
| Scheduler not advancing | Overview → Overview Bar `scheduler.uptime` — non-zero means scheduler running | Open `/system/scheduler` to toggle/reschedule a specific job |
| Droplet CPU or memory climbing | Overview → Server → Droplet, then the Containers table to attribute it | Resize the droplet, or restart the container carrying the growth once identified |
| Backend memory climbing | Overview → Server → Backend Process — heap/RSS trend | Restart the container if growth doesn't plateau; correlate with observer queue depth |
| A container crash-looping | Overview → Server → Containers — non-zero **Restarts**, or a state other than `running` | Tail that container's logs; the row's health column distinguishes a failing healthcheck from a stopped process |
| Disk filling | Overview → Server → Droplet — `Disk /` and `Disk clickhouse:*` cells turn amber at 75%, red at 90% | ClickHouse `traffic_events` is the usual cause; see the storage notes in [operations-server-info.md](../../../docs/operations/operations-server-info.md) |
| Redis evictions > 0 | Overview → Server (Redis Cache block) | Memory pressure; investigate caching keys or raise Redis maxmemory |
| WebSocket spikes | WebSockets tab — find offending plugin via `mostActiveEmitter` | Inspect that plugin's logs at `/system/logs` filtered by `service` |
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

Fresh install before scheduler has run, or scheduler globally disabled. Confirm `ENABLE_SCHEDULER=true`, wait one tick (1 minute) for `blockchain:sync`, or trigger manually from the Blockchain section.

### Section Reports Disconnected (Mongo / Redis / ClickHouse)

The probe will return `connected: false` immediately rather than 503; check the corresponding container with `docker ps`, tail its logs, and verify connection strings in backend `.env`. The dashboard does not cache — once the dependency comes back, the next probe poll surfaces it.

## Further Reading

- [system.md](./system.md) — System architecture overview
- [system-api.md](./system-api.md) — Admin API reference for everything the dashboard fetches
- [system-api-overview.md](./system-api-overview.md) — Health probe and config endpoint details
- [system-runtime-config.md](./system-runtime-config.md) — Why `siteUrl` edits need a frontend restart
- [environment.md](../environment.md) — `ADMIN_API_TOKEN`, `ENABLE_SCHEDULER`, `BETTER_AUTH_SECRET`
