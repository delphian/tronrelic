# Plugin Menu and Page System

TronRelic's plugin UI extension system lets plugins register navigation menu items, routable public pages, and admin surfaces — all without core code changes. Menus live in the backend `IMenuService` (database, hierarchical, gated). Pages declare into the frontend `pages` array and resolve through a single Next.js catch-all route.

## Why This Matters

Adding pages used to require editing navigation components, route configuration, and core files. Forking those paths per-plugin couples plugins to internal layouts, prevents lifecycle gating, and bypasses the admin auto-gate. The split below keeps the menu tree, the page registry, and the admin enforcement chain in one place each — plugin authors only declare what they own.

## How It Works

Backend `init()` calls `context.menuService.create()`, writing a database node and emitting `menu:updated`; the NavBar refetches and re-renders. Admin entries parent under `MAIN_SYSTEM_CONTAINER_ID`, and the menu service walks the parent chain to force `requiresAdmin: true` on every descendant — gating cannot be misconfigured.

Frontend `pages` arrays are statically imported into `plugins.generated.ts` by `generate:plugins`, so the registry bootstraps synchronously — no fetch, no loading flash. The catch-all route (`app/[...slug]/page.tsx`) consults `serverPluginRegistry` filtered by enabled manifests and returns 404 server-side for disabled plugins.

## Quick Reference

Plugin needs UI? Set `manifest.frontend = true` (for pages) and `manifest.backend = true` (for menu registration). Backend `init()` registers menu nodes; frontend `frontend.ts` declares `pages` (and optionally `adminPages`); page components accept `{ context, initialData }` and never import from `apps/frontend`.

```bash
npm run build --workspace src/plugins/my-plugin
npm run generate:plugins
npm run dev
# /system/plugins → Install → Enable
```

After enable, verify: `GET /api/admin/system/menu/nodes?namespace=main` returns the entry; navigating to the page renders the component; backend logs show the `init()` hook ran.

## Detail Documents

| Document | Covers |
|----------|--------|
| [plugins-page-registration-menu.md](./plugins-page-registration-menu.md) | `IMenuService.create()`, menu node fields, hierarchies with container nodes, visibility gating, WebSocket updates |
| [plugins-page-registration-pages.md](./plugins-page-registration-pages.md) | `pages` array, `IPageConfig` fields, page component contract, registry bootstrap, build/enable flow |
| [plugins-page-registration-admin.md](./plugins-page-registration-admin.md) | System container parenting, auto-gating via parent-chain walk, `MAIN_SYSTEM_CONTAINER_ID`, admin page components |

## Best Practices

Match backend menu `url` to frontend page `path` exactly. Use semantic `order` ranges (0–9 core, 10–99 features, 100+ admin). Container nodes (no `url`) group related items. Pre-fetch via `serverDataFetcher` and initialize state from `initialData` so first render contains real content — no loading spinners on initial render. Remove menu nodes in `disable()` so toggling cleans up.

## Further Reading

**Plugin documentation:**
- [plugins.md](./plugins.md) — Plugin system overview
- [plugins-system-architecture.md](./plugins-system-architecture.md) — Package structure and lifecycle hooks
- [plugins-frontend-context.md](./plugins-frontend-context.md) — `IFrontendPluginContext` API and CSS Modules
- [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) — SEO field reference and `serverDataFetcher` contract
- [plugins-widget-zones.md](./plugins-widget-zones.md) — Injecting UI into existing pages
- [plugins-api-registration.md](./plugins-api-registration.md) — REST routes and the `/api/plugins/<id>/system/**` admin gate

**System documentation:**
- [Menu Module README](../../src/backend/modules/menu/README.md) — Menu module architecture, REST endpoints, WebSocket events, visibility gating contract

**Frontend documentation:**
- [react.md → SSR + Live Updates Pattern](../frontend/react/react.md#ssr--live-updates-pattern) — Mandatory render pattern for plugin pages
