# Runtime Configuration System

TronRelic uses runtime configuration to enable universal Docker images that work on any domain without rebuilding.

## The Problem: Next.js Build-Time Inlining

Next.js inlines `NEXT_PUBLIC_*` environment variables into JavaScript bundles at build time. When GitHub Actions builds Docker images, it bakes in whatever values exist during the build (typically `localhost`). These hardcoded values cannot be changed at container runtime, breaking WebSocket connections when the same image is deployed to different domains.

**Why Next.js does this:** Client-side JavaScript runs in the browser and cannot access server environment variables. Next.js performs static replacement of `NEXT_PUBLIC_*` references with literal strings during webpack compilation for performance and security.

**The consequence:** Traditional environment variable overrides in docker-compose don't work for client-side code because the values are already frozen in the bundle.

## The Solution: SSR-Injected Runtime Config

Instead of relying on build-time environment variables, TronRelic:

1. **Backend stores siteUrl** in MongoDB (editable via `/system/config` admin UI)
2. **SSR fetches config** from backend API once at container startup, caches in memory
3. **SSR injects config** into HTML as `<script>window.__RUNTIME_CONFIG__={...}</script>`
4. **Client reads from global** - No hardcoded values, no separate fetch, instant access

This enables the same Docker image to work on `tronrelic.com`, `dev.tronrelic.com`, or any domain.

## Architecture

```
Backend Database → /api/config/public → SSR Cache → HTML Injection → Client Global
     (MongoDB)         (REST API)      (memory)     (window.__*)      (getRuntimeConfig)
```

### Backend (Single Source of Truth)

**SystemConfigService** (`apps/backend/src/services/system-config/system-config.service.ts`):
- Stores `siteUrl` in MongoDB `system_config` collection
- Derives `apiUrl` and `socketUrl` from `siteUrl` deterministically
- Exposes via public `/api/config/public` endpoint (no auth required)
- Caches in memory (1 minute TTL)

**Initial database default:**
- Reads from `NEXT_PUBLIC_SITE_URL` backend environment variable (set via docker-compose)
- Falls back to `http://localhost:3000` if not set
- Created automatically on first backend startup when database is empty

### Frontend SSR (Server-Side)

**getServerConfig()** (`apps/frontend/lib/serverConfig.ts`):
- Fetches from backend `/api/config/public` on first SSR request
- Caches in memory for container lifetime (zero overhead after first fetch)
- Falls back to environment variables if backend unavailable
- Used by all SSR code: `layout.tsx`, `sitemap.ts`, `generateMetadata()`, etc.

**Pattern:** All server components and SSR functions call `await getServerConfig()`.

### Frontend Client (Browser)

**getRuntimeConfig()** (`apps/frontend/lib/runtimeConfig.ts`):
- Reads from `window.__RUNTIME_CONFIG__` (injected by SSR)
- Synchronous - no async fetch needed, config already in DOM
- Falls back to environment variables if injection failed (shouldn't happen)
- Used by all client code: components, hooks, event handlers

**Pattern:** All client components call `getRuntimeConfig()` (no await).

## Deployment Workflow

### Fresh Install

1. **Deploy containers** with docker-compose
2. **Backend reads** `NEXT_PUBLIC_SITE_URL` from backend environment (docker-compose)
3. **Database initializes** with default siteUrl from environment
4. **Frontend SSR fetches** config from backend automatically
5. **WebSocket connects** to correct domain immediately

**No manual configuration needed** if `SITE_URL` is set in `.env` file on the server.

### Environment Configuration

**Production server** (`.env` file):
```bash
SITE_URL=https://tronrelic.com
```

**Dev server** (`.env` file):
```bash
SITE_URL=https://dev.tronrelic.com
```

**Local development** (`.env` file):
```bash
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

The docker-compose files use `${SITE_URL}` (prod/dev) or `${NEXT_PUBLIC_SITE_URL}` (local) to set the backend's `NEXT_PUBLIC_SITE_URL` environment variable.

### Runtime Reconfiguration

If the domain changes after deployment:

1. Visit `/system/config` admin UI
2. Update `siteUrl` field
3. Restart frontend container: `docker restart tronrelic-frontend-prod`
4. SSR cache refreshes with new config
5. WebSocket connects to new domain

## Key Points

✅ **Universal Docker images** - Same image works on any domain
✅ **Runtime configuration** - Change domain via admin UI or .env file
✅ **No client-side fetch** - Config injected in initial HTML (zero overhead)
✅ **Backend env vars work** - Node.js reads `process.env` at runtime (not build time)
✅ **Frontend env vars DON'T work** - Next.js inlines `NEXT_PUBLIC_*` at build time (webpack limitation)

❌ **Why not use NEXT_PUBLIC_* in frontend docker-compose?** Next.js already compiled the bundle with hardcoded values. Setting the variable at container runtime doesn't change the JavaScript bundle.

## Files Reference

**Backend:**
- `apps/backend/src/api/routes/config.router.ts` - Public config endpoint
- `apps/backend/src/services/system-config/system-config.service.ts` - Config storage and retrieval

**Frontend:**
- `apps/frontend/lib/serverConfig.ts` - SSR single source of truth (use in server components)
- `apps/frontend/lib/runtimeConfig.ts` - Client single source of truth (use in client components)
- `apps/frontend/app/layout.tsx` - Injects `window.__RUNTIME_CONFIG__` into HTML
- `apps/frontend/lib/socketClient.ts` - WebSocket uses runtime config

**Docker:**
- `docker-compose.prod.yml` - Production environment (SITE_URL from .env)
- `docker-compose.dev.yml` - Dev environment (SITE_URL from .env)
- `docker-compose.yml` - Local development (NEXT_PUBLIC_SITE_URL from .env)

**Deprecated:**
- `apps/frontend/lib/config.ts` - Old static config (do not use in new code)

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
