# System APIs and Real-Time Events

HTTP APIs and WebSocket events for monitoring system health, controlling operations, and subscribing to real-time blockchain data. Powers the `/system` dashboard and operator automation.

## Why This Matters

Without these endpoints operators must SSH in, restart processes, and tail logs to understand or change system state. The admin surface gives programmatic health checks, runtime job control, manual refreshes, and live event streams.

## Authentication

Admin endpoints accept any of the paths below via the `requireAdmin` middleware, tried in this order. See [system-auth.md](./system-auth.md) for the authorization model.

**Session path** (humans, the `/system` SPA). A Better Auth session whose account is in the `admin` group authorizes the call. Same-origin fetches carry the session cookie when `credentials: 'include'`.

**Legacy cookie path** (coexistence, removed in Phase 6). A signed `tronrelic_uid` cookie identifying a user with `identityState === Verified` and membership in the `admin` group. Still honored during the Better Auth migration.

**Service-token path** (CI, scripts, first-admin bootstrap). Set `ADMIN_API_TOKEN` in the backend `.env` and pass it in `X-Admin-Token` (preferred) or `Authorization: Bearer`. Query-param auth (`?token=...`) is intentionally rejected so tokens never leak into access logs.

```bash
# Generate
openssl rand -hex 32

# Use
curl -H "X-Admin-Token: $TOKEN" http://localhost:4000/api/admin/system/overview
```

When both succeed, the cookie wins: `req.adminVia = 'user'`. Token-only is tagged `req.adminVia = 'service-token'` for audit. With `ADMIN_API_TOKEN` unset and no admin user resolved, the entire admin surface returns 503 — disabling `/system` is a deliberate operational choice, not a misconfiguration.

## Conventions

**Base URLs.** Dev `http://localhost:4000/api`, prod `https://<your-domain>/api`.

**Response envelope.** Every endpoint returns `{ success: true, ... }` or `{ success: false, error: "..." }`. Data sits at a top-level key named for the resource (`overview`, `jobs`, `platforms`, `stats`, `log`, etc.).

**Async actions.** `POST /blockchain/sync` is fire-and-forget — it enqueues and returns immediately. Verify completion via `/blockchain/status` or WebSocket.

## Detail Documents

| Document | Covers |
|---|---|
| [system-api-overview.md](./system-api-overview.md) | Health (`/health/database`, `/health/clickhouse`, `/health/redis`, `/health/server`) and `/config` |
| [system-api-blockchain.md](./system-api-blockchain.md) | `/blockchain/status`, `/blockchain/transactions`, `/blockchain/metrics`, `/blockchain/observers`, `POST /blockchain/sync` |
| [system-api-scheduler.md](./system-api-scheduler.md) | `/scheduler/status`, `/scheduler/health`, `PATCH /scheduler/job/:jobName` |
| [system-api-logs.md](./system-api-logs.md) | `/logs` query/stats/get/resolve/unresolve/delete |
| [system-api-websockets.md](./system-api-websockets.md) | WebSocket monitoring endpoints + real-time event reference (`transaction:large`, `delegation:new`, `block:new`, `comments:new`, `chat:update`) |
| [system-api-widgets.md](./system-api-widgets.md) | Widget placements admin CRUD + zone/widget-type introspection (`/api/admin/system/widgets/placements`, `/api/admin/system/zones`, `/api/admin/system/widget-types`) |

## Troubleshooting

**401 Unauthorized.** Cookie path failed *and* the service token was missing or invalid. For scripts: confirm `ADMIN_API_TOKEN` is set, header is `X-Admin-Token` (no whitespace), and the backend was restarted after rotation. For humans: see [system-dashboard.md → Cannot Access Dashboard](./system-dashboard.md#cannot-access-dashboard-401-unauthorized).

**503 Service Unavailable.** `ADMIN_API_TOKEN` is unset and no admin user resolved — admin surface intentionally disabled.

**Empty data.** Fresh install: wait for the scheduler to populate. Check `ENABLE_SCHEDULER=true`, then `/health/database` and `/health/redis`.

**Scheduler PATCH had no effect.** Confirm the job is enabled (not just rescheduled), the global `ENABLE_SCHEDULER` is on, and the response confirmed the update. Changes apply on the next tick — they don't retroactively trigger.

**WebSocket drops.** Enable Socket.IO reconnection, allow WebSocket through firewalls, set `ENABLE_WEBSOCKETS=true`, and add a polling fallback (`transports: ['websocket', 'polling']`).

**Slow responses.** `/health/database` should be <50ms, `/health/redis` <10ms. Check `/health/server` for memory/CPU pressure.

## Further Reading

- [system-dashboard.md](./system-dashboard.md) — Web UI for these endpoints
- [system-scheduler-operations.md](./system-scheduler-operations.md) — Cron syntax, job persistence, runbooks
- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) — Sync internals
- [Menu Module README](../../src/backend/modules/menu/README.md) — Menu API and events
- [plugins/plugins-websocket-subscriptions.md](../plugins/plugins-websocket-subscriptions.md) — Plugin WebSocket patterns
- [environment.md](../environment.md) — `ADMIN_API_TOKEN`, `ENABLE_SCHEDULER`, `ENABLE_WEBSOCKETS`
