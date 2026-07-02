# Plugin Page Registration

Plugins declare routable pages in their frontend manifest's `pages` array. The Next.js catch-all route resolves slugs against the plugin registry, generates `<head>` metadata from `IPageConfig`, and renders the component with the framework-injected `IFrontendPluginContext`.

## Why This Matters

Without the registry, every plugin would fork `app/` routes and import core modules directly — coupling plugins to internal paths, breaking lifecycle gating, and making per-plugin SSR data fetching impossible. The single catch-all (`app/[...slug]/page.tsx`) consults `serverPluginRegistry` filtered by enabled manifests, so disabling a plugin returns 404 server-side without redeployment. Pages must receive the context as a prop because direct `apps/frontend` imports cross workspace boundaries the loader cannot satisfy.

## How It Works

`generate:plugins` reads each plugin's `package.json` `exports."./frontend"` and emits static-import lines into `src/frontend/components/plugins/plugins.generated.ts`. The registry bootstraps synchronously at module load — no fetch, no loading flash. On request, the catch-all calls `getEnabledPluginPageConfig(slug)`, awaits `serverDataFetcher` (if present), generates metadata from `IPageConfig` SEO fields, and renders the component with `{ context, initialData }`.

```typescript
// src/frontend/frontend.ts
export const myFrontendPlugin = definePlugin({
    manifest: myManifest,
    pages: [
        {
            path: '/my-dashboard',
            component: MyDashboardPage,
            title: 'My Dashboard',
            description: 'Analytics for my feature'
        }
    ]
});
```

## Wildcard Routes

A `path` ending in `/*` (e.g. `'/blog/*'`) registers a wildcard page owning every strictly deeper URL — the mechanism behind per-resource plugin pages like `/blog/my-post`. `/blog/*` matches `/blog/my-post` and `/blog/2026/recap` but never `/blog` itself; register the index page's exact path separately. Exact registrations beat wildcards, and the longest wildcard prefix wins among overlaps. Both `serverDataFetcher` and `serverMetadataFetcher` receive the concrete requested URL as `ctx.path`, so the fetcher derives its route parameter by stripping the declared prefix. Per-URL SEO comes from `serverMetadataFetcher` — see [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md#servermetadatafetcher-pattern).

## IPageConfig Fields

| Field | Purpose |
|-------|---------|
| `path` | URL route; must match backend menu `url` exactly. A trailing `/*` registers a wildcard route (see [Wildcard Routes](#wildcard-routes)) |
| `component` | React component receiving `{ context, initialData }` |
| `title`, `description`, `keywords`, `ogImage`, `ogType`, `canonical`, `noindex`, `structuredData` | SEO metadata — see [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) |
| `serverDataFetcher` | Async hook returning `initialData` for SSR — see [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) |
| `serverMetadataFetcher` | Async hook computing per-URL SEO metadata for wildcard pages; `null` return means the resource does not exist (404 + noindex) — see [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md#servermetadatafetcher-pattern) |
| `requiresAuth` | Authentication required (declarative; enforce in component) |
| `requiresAdmin` | Admin required (declarative; admin pages auto-enforce — see [plugins-page-registration-admin.md](./plugins-page-registration-admin.md)) |

## Page Component Contract

Pages receive `IFrontendPluginContext` as a prop. Never import from `apps/frontend` — the context provides UI primitives, charts, API client, and WebSocket through DI:

```typescript
'use client';
import type { IFrontendPluginContext } from '@/types';

export function MyDashboardPage({ context }: { context: IFrontendPluginContext }) {
    const { ui } = context;
    return (
        <ui.Card>
            <h1>My Dashboard</h1>
        </ui.Card>
    );
}
```

See [plugins-frontend-context.md](./plugins-frontend-context.md) for the full context API.

## SSR + Live Updates

All public pages must follow the [SSR + Live Updates pattern](../frontend/react/react.md#ssr--live-updates-pattern): pre-fetch via `serverDataFetcher`, initialize `useState(initialData)`, attach WebSocket subscriptions in `useEffect`. Loading spinners are reserved for user-triggered actions (form submission, pagination), not initial render. See [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) for the `serverDataFetcher` contract.

## Build and Enable

```bash
npm --prefix src/plugins/trp-my-plugin run build
npm run generate:plugins
npm run dev
# Then in /system/plugins admin UI: Install → Enable
```

The manifest must declare `frontend: true` for pages and `backend: true` for menu registration.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Page returns 404 | `path` matches menu `url`; plugin enabled in `/system/plugins`; `plugins.generated.ts` includes the plugin (re-run `npm run generate:plugins`); `manifest.frontend === true` |
| Component renders blank | Check page accepts `{ context, initialData }`; check browser console for plugin loader errors |
| Hydration mismatch | Initialize state from `initialData`, not empty arrays; see [SSR + Live Updates](../frontend/react/react.md#ssr--live-updates-pattern) |

## Reference Files

- `packages/types/src/plugin/IPageConfig.ts` — page config interface
- `packages/types/src/plugin/IPlugin.ts` — plugin definition
- `src/frontend/lib/pluginRegistry.ts` — client registry, self-bootstrapped
- `src/frontend/lib/serverPluginRegistry.ts` — server registry filtered by enabled manifests
- `src/frontend/components/plugins/plugins.generated.ts` — auto-generated static-import registry
- `src/frontend/app/[...slug]/page.tsx` — catch-all route handler
- `src/frontend/components/PluginPageHandler.tsx` — synchronous client lookup
- `src/frontend/components/PluginPageWithZones.tsx` — server wrapper with widget zones
- `src/plugins/trp-ai-assistant/` — canonical reference implementation
