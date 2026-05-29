# System Dashboard

The System Dashboard is the cross-cutting observability surface at `/system/system` (default landing page when navigating to `/system`). It joins per-subsystem health probes into one scroll for triage, and acts as the operator's entry point to the module-owned admin pages that live as siblings under `/system/*`.

## Why This Matters

Scheduler jobs fail silently, blockchain sync stalls without warning, observers fall behind. The dashboard surfaces real-time signals from every subsystem and exposes the manual sync trigger so operators resolve issues without backend restarts. Module-specific operations (job toggles, log queries, plugin management) live on dedicated sibling pages — the dashboard is the triage map, not a jack-of-all-trades.

## Accessing the Dashboard

### Authentication Workflow

Admin authority comes from `admin` group membership, not a JS-readable token. The `requireAdmin` middleware admits a Better Auth admin session, the legacy cookie path below, or the service token — see [system-auth.md](./system-auth.md).

**Primary path (Better Auth).** Sign in via the header (email-OTP / OAuth / passkey) with an account in the `admin` group; the `/system` nav and routes unlock immediately — no wallet required. Get into the group via `ADMIN_EMAILS` on signup or the Groups editor on `/system/users`.

**Legacy cookie path (coexistence, removed in Phase 6).** Still honored during the migration:

1. **Bootstrap your identity** by visiting any TronRelic page — the server mints the signed `tronrelic_uid` cookie via `POST /api/user/bootstrap`.
2. **Verify a wallet** via the header WalletButton (TronLink signature). This moves your `identityState` to `Verified` and starts the 14-day session clock.
3. **Get added to the `admin` group** by an existing operator using the Groups editor on `/system/users`. For a fresh install with no admins yet, see [Bootstrapping the first admin](../../src/backend/modules/user/README.md#bootstrapping-the-first-admin) — it uses the service token (`ADMIN_API_TOKEN`) once, then the cookie path takes over.
4. **Navigate to** `/system`. The `requireAdmin` middleware reads the signed cookie, confirms `Verified`, and checks `IUserGroupService.isAdmin(userId)`. The `/system` nav entry only appears when all three pass.

**Recovery:** if your session ages past `SESSION_TTL_MS` (14 days), the dashboard becomes inaccessible — re-sign via the header WalletButton to refresh `identityVerifiedAt`. There is no separate "stale admin" UI.

**Service token alternative:** scripts, CI, and the first-admin bootstrap use `ADMIN_API_TOKEN` via the `x-admin-token` header (or `Authorization: Bearer`). Intended for automation, not human operators in the browser. Protect like any production secret and rotate on suspected compromise — human admins authenticate via the cookie path and are unaffected by token rotation.

## The System Page

`/system/system` is one page rendered as a vertical stack of independent sections. Each section fetches its own admin endpoint and renders independently — there is no aggregating `/overview` API; the page joins probe results client-side. Sections (in render order):

| Section | Component | Fetches | Purpose |
|---|---|---|---|
| Overview Bar | `OverviewBar` | All seven probes | At-a-glance status strip across the top |
| Blockchain | `BlockchainSection` | `/blockchain/status`, `/metrics`, `/observers`, `/scheduler/health` | Sync lag, throughput, observer queues, **Trigger Sync Now** button |
| MongoDB | `MongoSection` | `/health/database`, `/migrations/status`, `/migrations/history` | Connection state, db size, migration runs |
| ClickHouse | `ClickHouseSection` | `/health/clickhouse` | Connection state, table count, db size |
| Server / Redis | `ServerSection` | `/health/redis`, `/health/server` | Process uptime, heap, CPU; Redis ping, key count, evictions |
| WebSockets | `WebSocketsSection` | `/websockets/stats`, `/websockets/aggregate` | Per-plugin and aggregate WS metrics |
| System Config | `SystemConfigSection` | GET/PATCH `/config/system` | Edit `siteUrl`, `logLevel`, log retention from the UI |

Section sources: `src/frontend/app/(core)/system/system/components/`. For payload details and the cross-link to runtime config restart semantics, see [system-api-overview.md](./system-api-overview.md).

## Module-Owned Admin Pages

Other admin features live on dedicated pages — each owned by its module and documented in that module's canonical doc. The dashboard nav links to them; this file does not duplicate their content.

| Page | Owned by | Canonical doc |
|---|---|---|
| `/system/scheduler` | Scheduler module | [system-scheduler-operations.md](./system-scheduler-operations.md) |
| `/system/logs` | Logs module | [system-logging.md](./system-logging.md) |
| `/system/plugins` | Plugin loader | [../plugins/plugins.md](../plugins/plugins.md) |
| `/system/pages` | Pages module | [Pages Module README](../../src/backend/modules/pages/README.md) |
| `/system/menu` | Menu module | [Menu Module README](../../src/backend/modules/menu/README.md) |
| `/system/users` | User module | [User Module README](../../src/backend/modules/user/README.md) |
| `/system/theme` | Theme system | [ui-theme.md](../frontend/ui/ui-theme.md) |
| `/system/address-labels` | Address Labels module | `src/backend/modules/address-labels/` (no README yet) |
| `/system/logout` | — | Clears cookie and redirects |

## Common Diagnostic Flows

The System page is the triage map. Identify *which* subsystem is degraded, then either act on it from the page directly or click into the owning module's admin page for deeper control.

| Symptom | Section to check | Action |
|---|---|---|
| Frontend transactions stale, observers silent | Blockchain — verify `lag` and `lastError`; check observers for rising `queueDepth` or `totalDropped` | Click **Trigger Sync Now**; for persistent backlog see [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) |
| Scheduler not advancing | Overview Bar `scheduler.uptime` — non-zero means scheduler running | Open `/system/scheduler` to toggle/reschedule a specific job |
| Memory or CPU climbing | Server — heap/RSS/cpu trend | Restart container if growth doesn't plateau; correlate with observer queue depth |
| Redis evictions > 0 | Server (Redis card) | Memory pressure; investigate caching keys or raise Redis maxmemory |
| WebSocket spikes | WebSockets — find offending plugin via `mostActiveEmitter` | Inspect that plugin's logs at `/system/logs` filtered by `service` |
| Site URL or log retention need updating | System Config | Edit inline; **restart the frontend container** for SSR cache to refresh (see [system-runtime-config.md](./system-runtime-config.md#runtime-reconfiguration)) |
| Need to inspect a specific error | Logs page (`/system/logs`) | Filter by level/service; resolve to clear from unresolved counts |

## Troubleshooting

### Cannot Access Dashboard (401 Unauthorized)

**Cause:** Cookie path failed and no valid service token was provided. The middleware tries the cookie path first; the service-token branch produces 401 on missing or invalid tokens (or 503 when `ADMIN_API_TOKEN` is unset entirely).

**Cookie path (humans):**
1. Confirm a signed `tronrelic_uid` cookie exists in devtools → Application → Cookies. If absent, reload the site so `POST /api/user/bootstrap` mints it.
2. Confirm `identityState === Verified` (e.g., via `/api/user/me` or the WalletButton state). If `Registered`, sign a wallet via the header WalletButton to refresh `identityVerifiedAt`.
3. Confirm your UUID appears in the `admin` group on `/system/users` (ask a current admin if not).

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
- [environment.md](../environment.md) — `ADMIN_API_TOKEN`, `ENABLE_SCHEDULER`, `SESSION_TTL_MS`
