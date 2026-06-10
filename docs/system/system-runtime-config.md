# Runtime Configuration System

TronRelic uses runtime configuration to enable universal Docker images that work on any domain without rebuilding.

## Why This Matters

Next.js inlines `NEXT_PUBLIC_*` environment variables into JavaScript bundles at build time via webpack's static replacement — client JS can't access server env at runtime. GitHub Actions bakes in whatever values exist during build (typically `localhost`); container-runtime overrides cannot change them. The same image deployed to different domains breaks WebSocket connections because the bundle is frozen.

## How It Works

Backend stores `siteUrl` in MongoDB (editable via `/system/config`) and fetches TRON chain parameters every 10 minutes. SSR fetches config from `/api/config/public` once at container startup, caches in memory, and injects into HTML as `<script>window.__RUNTIME_CONFIG__={...}</script>`. The client reads the global synchronously — no separate fetch, no hardcoded values, no rebuild to switch domains.

## Architecture

```
Backend Database → /api/config/public → SSR Cache → HTML Injection → Client Global
     (MongoDB)         (REST API)      (memory)     (window.__*)      (getRuntimeConfig)
```

### Backend (Single Source of Truth)

`SystemConfigService` (`src/backend/src/services/system-config/system-config.service.ts`) stores `siteUrl` in MongoDB `system_config`, derives `apiUrl` and `socketUrl` deterministically, exposes via no-auth `/api/config/public`, caches in memory with a 1-minute TTL.

`ChainParametersService` (`src/backend/src/modules/chain-parameters/chain-parameters.service.ts`) is a singleton that fetches TRON parameters every 10 minutes via a scheduled job, stores them in MongoDB `chain_parameters`, exposes `energyPerTrx` and `energyFee`, rides along in the `/api/config/public` response so the client gets them without an extra round-trip. 1-minute TTL.

**Initial database default:** reads `NEXT_PUBLIC_SITE_URL` from the backend env (set via docker-compose), falls back to `http://localhost:3000`. Created on first boot when the DB is empty. Chain parameters use fallback values until the first TRON fetch completes.

### Frontend SSR (Server-Side)

`getServerConfig()` (`src/frontend/lib/serverConfig.ts`) fetches `/api/config/public` on first SSR request and caches a *successful* response for the container's lifetime (zero overhead after). If the backend is unavailable it serves a degraded fallback pointing at the internal backend URL, but caches that fallback for only ~10s and retries on the next request. The fallback is never latched for the container lifetime — a transient backend blip self-heals instead of poisoning every client with unreachable, mixed-content URLs until a manual restart. All server components, `generateMetadata`, `sitemap.ts`, and `layout.tsx` `await getServerConfig()`.

### Frontend Client (Browser)

`getRuntimeConfig()` (`src/frontend/lib/runtimeConfig.ts`) reads `window.__RUNTIME_CONFIG__` synchronously — config is already in the DOM, no fetch. Fallback to env vars only if injection failed. All client components call it without `await`.

## Deployment Workflow

### Environment Configuration

Production and dev `.env` files set `SITE_URL`; local sets `NEXT_PUBLIC_SITE_URL` (the asymmetry exists because docker-compose interpolates `SITE_URL` into the backend's `NEXT_PUBLIC_SITE_URL` env var, while local development reads `NEXT_PUBLIC_SITE_URL` directly).

```bash
SITE_URL=https://tronrelic.com           # production
SITE_URL=https://dev.tronrelic.com       # dev
NEXT_PUBLIC_SITE_URL=http://localhost:3000  # local
```

With `SITE_URL` set on the server, no further configuration is needed — the database initializes with the env value on first boot, SSR fetches and caches, WebSocket connects to the correct domain.

### Runtime Reconfiguration

To change the domain after deployment: edit `siteUrl` at `/system/config`, then **restart the frontend container** (`docker restart tronrelic-frontend-prod`) to refresh the SSR cache. Updating the DB without a restart leaves the cached config in place.

## Using Chain Parameters in Frontend

The runtime config includes `chainParameters` for instant energy/TRX conversions without additional API calls.

```typescript
const { chainParameters } = getRuntimeConfig();
const energy = trxAmount * chainParameters.energyPerTrx;
const trx = energyAmount / chainParameters.energyPerTrx;
const burnCost = chainParameters.energyFee; // SUN per energy unit
```

Parameters refresh every 10 minutes server-side; the frontend gets a snapshot at page load via SSR injection. Sufficient for most UI calculations. For real-time accuracy, fetch `/api/config/public` directly.

## Files Reference

Core file paths are cited inline above. Additional references:

- `src/backend/src/api/routes/config.router.ts` — public config endpoint
- `src/backend/src/modules/chain-parameters/chain-parameters-fetcher.ts` — scheduled fetch from TRON
- `src/frontend/app/layout.tsx` — injects `window.__RUNTIME_CONFIG__`
- `src/frontend/lib/socketClient.ts` — WebSocket consumer
- `docker-compose.{prod,dev}.yml` — interpolate `SITE_URL` into backend env
- `docker-compose.yml` — local dev, reads `NEXT_PUBLIC_SITE_URL`
- `src/frontend/lib/config.ts` — **deprecated**, do not use in new code

## Troubleshooting

**WebSocket connects to localhost instead of production domain:**
- Check `/system/config` shows correct `siteUrl`
- Restart frontend container to refresh SSR cache
- Verify browser console shows correct `window.__RUNTIME_CONFIG__.socketUrl`

**Fresh install uses localhost:**
- Set `SITE_URL` in `.env` file on the server before deploying
- Or update via `/system/config` admin UI after deploy and restart frontend

**SSR can't fetch backend config:**
- Check backend container is healthy: `docker ps`
- Check backend API responds: `curl http://localhost:4000/api/config/public`
- Falls back to environment variables (check container logs for warnings)
