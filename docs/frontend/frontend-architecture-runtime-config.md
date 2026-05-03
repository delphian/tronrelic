# Frontend Runtime Configuration

How frontend code resolves backend URLs and environment values across SSR and client contexts without breaking the universal Docker image.

## Why This Matters

Next.js SSR runs inside Docker where only internal service names (`http://backend:4000`) resolve. The browser runs outside Docker where only public URLs (`https://tronrelic.com`) work. Mixing them produces 502s in production, CORS errors in the browser, and 100% of the production outages we have shipped from frontend env mistakes.

Worse, `NEXT_PUBLIC_*` variables inline at *build time*. A single Docker image meant to run on any domain — staging, prod, ephemeral PR previews — cannot do that if the backend URL is baked in at build. Forbidding `NEXT_PUBLIC_*` is what makes the universal image possible.

## The Two APIs

All backend URL handling flows through two functions. Pick by execution context:

| API | Module | Use In |
|-----|--------|--------|
| `getServerConfig()` | `@/lib/serverConfig` | Server components, `generateMetadata`, route handlers, server actions |
| `getRuntimeConfig()` | `@/lib/runtimeConfig` | Client components (`'use client'`), browser-only code |

Never read `process.env.*` directly. Never use `NEXT_PUBLIC_*` variables. The legacy `@/lib/config` module is deprecated for the same reason — it bakes URLs at build time.

`getRuntimeConfig()` reads values the SSR layer injected as `window.__RUNTIME_CONFIG__` during server render. The values reach the browser at *page load*, not build, so one image runs anywhere. See [system-runtime-config.md](../system/system-runtime-config.md) for the injection mechanism.

## Environment Variables

Server-only variables (read via `getServerConfig()`):

| Variable | Purpose | Example |
|----------|---------|---------|
| `SITE_BACKEND` | Backend URL the Next.js server uses for SSR fetches | `http://backend:4000` (Docker), `http://localhost:4000` (local) |
| `SITE_WS` | WebSocket URL for SSR-side initialization | `http://backend:4000` |
| `SITE_URL` | Public site URL (also stored in MongoDB; env seeds first boot only) | `https://tronrelic.com` |

`SITE_BACKEND` is required — the SSR layer throws on its first server request if unset. `SITE_URL` is runtime config in MongoDB, editable from `/system`; the env var seeds the initial value and changing it later does nothing.

There are no `NEXT_PUBLIC_*` variables in production code by design.

## Usage Patterns

**Server component fetching SSR data:**

```typescript
// app/(core)/markets/page.tsx
import { getServerConfig } from '@/lib/serverConfig';

export default async function MarketsPage() {
    const { backendUrl } = getServerConfig();
    const response = await fetch(`${backendUrl}/api/markets/compare`);
    const { markets } = await response.json();
    return <MarketDashboard initialMarkets={markets} />;
}
```

**Client component connecting WebSocket:**

```typescript
// modules/realtime/socket.ts
'use client';
import { io } from 'socket.io-client';
import { getRuntimeConfig } from '@/lib/runtimeConfig';

const { socketUrl } = getRuntimeConfig();
export const socket = io(socketUrl, { transports: ['websocket', 'polling'] });
```

**generateMetadata (server-side):**

```typescript
import { getServerConfig } from '@/lib/serverConfig';

export async function generateMetadata() {
    const { siteUrl } = getServerConfig();
    return { metadataBase: new URL(siteUrl) };
}
```

## Anti-Patterns

```typescript
// Direct process.env — bakes at build, breaks universal image
const apiUrl = process.env.NEXT_PUBLIC_API_URL;

// Public URL in SSR — server tries to reach the public domain from inside Docker, gets 502
const data = await fetch('https://tronrelic.com/api/markets');

// Internal Docker hostname in client — browser cannot resolve "backend", gets DNS failure / CORS
const socket = io('http://backend:4000');

// Legacy @/lib/config — deprecated, do not import
import { config } from '@/lib/config';
```

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| 502 in production SSR | Server component using public URL or `NEXT_PUBLIC_*` | Switch to `getServerConfig().backendUrl` |
| CORS error in browser | Client code using internal Docker hostname | Switch to `getRuntimeConfig().backendUrl` |
| WebSocket fails to connect | Hardcoded socket URL | `getRuntimeConfig().socketUrl` (client) or `getServerConfig().socketUrl` (SSR init) |
| Backend URL works in dev, breaks in prod | `NEXT_PUBLIC_*` baked into build | Remove the variable, route through the runtime APIs |

Verify by logging `typeof window` (`'undefined'` = SSR, `'object'` = client) and the resolved URL before the failing request.

## Related

- [frontend-architecture.md](./frontend-architecture.md) — Index and overview
- [frontend-architecture-modules.md](./frontend-architecture-modules.md) — Module structure and imports
- [system-runtime-config.md](../system/system-runtime-config.md) — How SSR injects config into `window.__RUNTIME_CONFIG__`
- [environment.md](../environment.md) — Authoritative env var inventory and non-obvious behaviors
