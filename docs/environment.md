# Environment Variables Reference

Authoritative reference for every environment variable the backend reads. Source of truth: `src/backend/config/env.ts` (Zod schema) plus `.env.example` for deploy-time vars consumed by docker-compose.

## Why This Matters

Misconfigured env breaks startup or, worse, looks fine and silently disables protections (cookie signing, rate limit pools, metrics auth). Validation at boot catches typos but cannot catch *missing-but-optional* vars whose absence quietly downgrades behavior. Read this doc before changing `.env` in any non-local environment.

## Quick Start

Local dev needs five vars; everything else has sensible defaults.

```bash
ENV=development
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/tronrelic
REDIS_URL=redis://127.0.0.1:6379
SITE_BACKEND=http://localhost:4000
```

Add `ADMIN_API_TOKEN=anything` to unlock `/system`. Add `TRONGRID_API_KEY` to lift the shared 100-req/s ceiling. Add `ENABLE_SCHEDULER=true` to populate live data.

## Core Runtime

| Variable | Type | Default | Required | Notes |
|---|---|---|---|---|
| `NODE_ENV` | enum | `development` | no | Set by Node tooling. Don't put in `.env`. Values: `development`, `test`, `staging`, `production`. |
| `ENV` | enum | `development` | no | Deployment env (`development`, `staging`, `production`). Distinct from `NODE_ENV` — gates production-only safety checks. |
| `PORT` | int | `4000` | no | Backend HTTP port. |

Either `NODE_ENV=production` or `ENV=production` triggers production-grade behavior (e.g., `SESSION_SECRET` enforcement).

## Site URLs

The frontend resolves backend/socket URLs from these on the server, then auto-detects on the client from `window.location`. **There are no `NEXT_PUBLIC_*` vars** — production builds inline build-time values, which would break universal Docker images. See [system-runtime-config.md](./system/system-runtime-config.md) for the runtime-config story.

| Variable | Required | Notes |
|---|---|---|
| `SITE_URL` | runtime config | Public frontend URL (SEO, canonical URLs, Open Graph, sitemap). Stored in MongoDB and editable from `/system`; this env var seeds the initial value. |
| `SITE_BACKEND` | yes (frontend SSR) | Where the Next.js server reaches the backend during SSR. Frontend throws on first request if unset. |
| `SITE_WS` | no | Socket.IO endpoint hint. Frontend falls back to deriving from `window.location`. |

## Datastores

| Variable | Default | Required | Notes |
|---|---|---|---|
| `MONGODB_URI` | — | yes | Connection string. Use TLS in non-local. |
| `REDIS_URL` | — | yes | Cache + session storage. App refuses to start without it. |
| `REDIS_NAMESPACE` | `tronrelic` | no | Key prefix. Change when sharing Redis across envs. |
| `CLICKHOUSE_HOST` | `http://127.0.0.1:8123` | no | Analytics workloads (time-series, aggregations). |
| `CLICKHOUSE_USER` | `default` | no | |
| `CLICKHOUSE_PASSWORD` | empty | no | |
| `CLICKHOUSE_DATABASE` | `tronrelic` | no | |

Connection-string format examples live in upstream MongoDB and Redis docs — not duplicated here.

## Feature Flags

| Variable | Default | Notes |
|---|---|---|
| `ENABLE_SCHEDULER` | `true` | Cron jobs (market refresh, blockchain sync, chain params, alerts). Disable for unit tests or to avoid TronGrid rate limits during dev. |
| `ENABLE_WEBSOCKETS` | `true` | Socket.IO server. Disable for SSR-only or proxy-incompatible deployments. |
| `ENABLE_TELEMETRY` | `true` | Prometheus `/metrics` endpoint. |

All three accept `true|false|1|0|yes|no|on|off` (case-insensitive); empty disables.

See [system-scheduler-operations.md](./system/system-scheduler-operations.md) for per-job runtime control without restart.

## Security

| Variable | Required | Notes |
|---|---|---|
| `ADMIN_API_TOKEN` | optional | Bearer token for `/system`, `/admin/markets`, `/admin/moderation`. **If unset, all admin endpoints return 503** — the intended way to disable admin entirely. Generate: `openssl rand -hex 32`. Pass as `X-Admin-Token` header or `localStorage.admin_token` for the dashboard. |
| `SESSION_SECRET` | yes in prod | HMAC secret for the `tronrelic_uid` identity cookie. See below. |
| `METRICS_TOKEN` | optional | Bearer-token gate on `/metrics` when exposed publicly. |

### SESSION_SECRET behavior

Without a real secret, the cookie is a bare UUID — any HTTP client that learns a UUID can forge `Cookie: tronrelic_uid=<uuid>` and impersonate that user. With signing, the wire value becomes `s:<uuid>.<HMAC>` and forgery requires the secret.

Behavior when unset:
- Production (`NODE_ENV=production` or `ENV=production`): backend refuses to start.
- Dev/test: uses placeholder `tronrelic-dev-cookie-secret-do-not-use-in-prod` and emits `console.warn`.

Rotation invalidates every existing cookie. Anonymous and registered visitors get a fresh UUID on next bootstrap. Verified users re-anchor through link-wallet identity-swap on their next signature. No session table to flush.

## TRON Integration

| Variable | Notes |
|---|---|
| `TRONGRID_API_KEY` | Primary TronGrid key. Without any key: 100 req/s shared IP pool. With key: 1,000 req/s dedicated. Sent as `TRON-PRO-API-KEY` header. |
| `TRONGRID_API_KEY_2` | Rotation pool member. Distributes load across accounts during sync. |
| `TRONGRID_API_KEY_3` | Same. |
| `ALERT_WHALE_MIN_TRX` | Override for whale-alert TRX threshold. Numeric or string. |

Get keys at https://www.trongrid.io/. Add as many as you have — the rotator picks round-robin.

## Notifications

| Variable | Default | Notes |
|---|---|---|
| `NOTIFICATION_WEBSOCKET_THROTTLE_MS` | `5000` | Min ms between WS notifications per user. |
| `NOTIFICATION_EMAIL_THROTTLE_MS` | `300000` | Min ms between emails per user. Higher because email costs more and inbox tolerance is lower. |
| `TELEGRAM_IP_ALLOWLIST` | unset | Comma-separated IPs permitted to hit the Telegram webhook. |

## Object Storage

S3-compatible storage for page module file uploads. All optional — if `STORAGE_BUCKET` is unset, the local filesystem provider is used.

| Variable | Notes |
|---|---|
| `STORAGE_ENDPOINT` | S3 endpoint URL. |
| `STORAGE_REGION` | AWS region or equivalent. |
| `STORAGE_BUCKET` | Bucket name. |
| `STORAGE_ACCESS_KEY_ID` | |
| `STORAGE_SECRET_ACCESS_KEY` | |
| `STORAGE_FORCE_PATH_STYLE` | Boolean. Set true for MinIO, Backblaze B2, and other path-style providers. |

## Deploy-Time and Compose-Only

These are read by `docker-compose.yml` and `scripts/droplet-*.sh`, not by the application. Leave blank for local dev.

| Variable | Notes |
|---|---|
| `IMAGE_TAG` | Docker tag to pull. Defaults to `production`. PR envs auto-generate `pr-{branch}-{sha}`. |
| `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD` | Mongo container bootstrap. Generate password with `openssl rand -hex 32`. |
| `REDIS_PASSWORD` | Redis AUTH for production deployments. |
| `GITHUB_USERNAME` | GHCR image path component. |
| `PROD_DROPLET_IP` | Target for manual deploy scripts. |

## Validation

`src/backend/config/env.ts` parses `process.env` with Zod at startup. On failure the backend logs per-field errors and exits — there is no degraded mode. Missing `MONGODB_URI` or `REDIS_URL` always blocks startup; missing optional vars produce a warning only when their absence is dangerous (e.g., `SESSION_SECRET` in dev).

## Further Reading

- Schema: `src/backend/config/env.ts`
- Template: `tronrelic/.env.example`
- Runtime config: [system-runtime-config.md](./system/system-runtime-config.md)
- Scheduler control: [system-scheduler-operations.md](./system/system-scheduler-operations.md)
- Security checklist: [README.md](../README.md#security-checklist)
- Deployment: [tronrelic-ops/docs/operations/operations.md](../../docs/operations/operations.md)
