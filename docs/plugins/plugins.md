# Plugin System Overview

TronRelic's plugin system enables self-contained blockchain features that own everything they need — observers, REST routes, pages, widgets, real-time subscriptions, shared services — without touching the platform core.

## Why This Matters

Plugins ship as isolated workspaces that fail in isolation, depend on interfaces, and register their own surfaces dynamically. The pattern lets features like whale alerts and delegation tracking iterate without rewriting shared infrastructure, and lets operators toggle features at runtime without restarts.

## Plugin Lifecycle

Plugins move through five states, controlled from the `/system/plugins` admin interface without restarts:

1. **Discovered** — found in `src/plugins/` and registered (default: uninstalled, disabled)
2. **Installed** — `install()` runs; create indexes, seed defaults
3. **Enabled** — `enable()` and `init()` run; register observers, routes, services
4. **Disabled** — `disable()` runs; stop background tasks, keep data intact
5. **Uninstalled** — `uninstall()` runs; clean up persistent state

Only plugins that are **installed AND enabled** load at runtime. See [plugins-system-architecture.md](./plugins-system-architecture.md) for package layout, manifest contracts, runtime initialization, hot reload, the new-plugin walkthrough, and admin interface usage.

## Extension Surfaces

**Blockchain transaction processing.** Plugins subscribe to TRON contract types (`TransferContract`, `DelegateResourceContract`, etc.) by extending the injected `BaseObserver`. Observers inherit queue management, overflow protection, and error isolation — failures stay contained without blocking blockchain sync. See [plugins-blockchain-observers.md](./plugins-blockchain-observers.md) for the observer pattern, subscription mechanics, and statistics tracking.

**Frontend UI extension.** Plugins register menu items, full pages, and widgets that inject into zones on existing pages. Components receive an `IFrontendPluginContext` providing UI primitives, charts, the API client, and WebSocket access — no cross-workspace imports. All visible plugin UI must follow the [SSR + Live Updates pattern](../frontend/react/react.md#ssr--live-updates-pattern): server renders with real data, client hydrates and subscribes. See [plugins-page-registration.md](./plugins-page-registration.md) for menu and page registration, [plugins-widget-zones.md](./plugins-widget-zones.md) for zone injection, [plugins-frontend-context.md](./plugins-frontend-context.md) for the context API and CSS Modules, and [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) for SEO fields and `serverDataFetcher`.

**REST API routes.** Plugins expose endpoints under `/api/plugins/<plugin-id>/` using framework-agnostic request/response objects, with auto-namespacing, middleware composition (auth, validation, rate limiting), and lifecycle-coupled registration. Admin routes mounted under `/api/plugins/<plugin-id>/system/**` get the `requireAdmin` middleware automatically. See [plugins-api-registration.md](./plugins-api-registration.md) for route definitions, the dual-track admin gate, and handler contracts.

**Database storage.** Each plugin gets an isolated MongoDB sandbox via `IDatabaseService` with collection names auto-prefixed `plugin_<id>_` to prevent collisions. The helper provides scoped collections, key-value config storage, and lifecycle-aware setup (indexes in `install()`, config load in `init()`). See [system-database.md](../system/system-database.md#plugins) for usage patterns and modeling guidance.

**WebSocket real-time events.** Plugins manage custom subscriptions through a namespaced WebSocket manager. Room names and event names are auto-prefixed with the plugin ID; subscription handlers can validate payloads and reject invalid requests; the manager exposes metrics for room membership and emission rates. See [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md) for handler registration, room management, and frontend subscription patterns.

**Cross-component service sharing.** The service registry (`context.services`) lets plugins publish named services that other plugins and modules discover at runtime — TronRelic's mechanism for plugin-to-plugin and plugin-to-module collaboration. Providers register on `init()` and unregister on `disable()`; consumers look up by name with `get()` (one-shot) or `watch()` (continuous presence). The registry shifts the module vs plugin decision: a feature exposing a shared service can stay a plugin if the application functions without it. See [plugins-service-registry.md](./plugins-service-registry.md) for the types-only-package convention, get/watch semantics, and the `IUserGroupService` permission-gating pattern.

## Quick Reference

For the new-plugin walkthrough — directory layout, copy `trp-ai-assistant` as baseline, manifest fields, build commands — see [plugins-system-architecture.md → Adding or updating a plugin](./plugins-system-architecture.md#adding-or-updating-a-plugin). The canonical reference implementation that exercises every pattern in this guide (lifecycle hooks, scheduler jobs, service registry publication, admin routes, SSR-first pages) is `src/plugins/trp-ai-assistant/`.

### Common Pattern: Backend Plugin Init

Wire observers — and any service-registry publication — inside `init()` using only the injected `IPluginContext`:

```typescript
export const myPluginBackendPlugin = definePlugin({
    manifest: myManifest,
    init: async (context: IPluginContext) => {
        createMyObserver(
            context.BaseObserver,
            context.observerRegistry,
            context.websocket,
            context.logger
        );
    }
});
```

For the complete Hello World walkthrough including the observer factory, see [plugins-system-architecture.md → Backend implementation pattern](./plugins-system-architecture.md#backend-implementation-pattern). For frontend page patterns that comply with SSR + Live Updates, see [plugins-frontend-context.md](./plugins-frontend-context.md) and [react.md](../frontend/react/react.md#ssr--live-updates-pattern).

## Further Reading

**Detail documents:**

- [plugins-system-architecture.md](./plugins-system-architecture.md) — Package layout, manifests, lifecycle hooks, runtime flow, admin interface
- [plugins-blockchain-observers.md](./plugins-blockchain-observers.md) — Observer pattern, transaction processing, subscriptions
- [plugins-page-registration.md](./plugins-page-registration.md) — Menu items, pages, routing, admin UI
- [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) — SEO metadata fields and `serverDataFetcher`
- [plugins-widget-zones.md](./plugins-widget-zones.md) — Widget zones for injecting UI into existing pages
- [plugins-frontend-context.md](./plugins-frontend-context.md) — Context injection, UI components, API client, WebSocket
- [plugins-api-registration.md](./plugins-api-registration.md) — REST routes, middleware, admin endpoints
- [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md) — Real-time subscriptions, rooms, event namespacing
- [plugins-service-registry.md](./plugins-service-registry.md) — Cross-component service sharing
- [system-database.md](../system/system-database.md#plugins) — Scoped storage, indexes, key-value config

**Related topics:**

- [Frontend Architecture](../frontend/frontend.md) — Frontend system overview and patterns
- [Chain Parameters](../tron/tron-chain-parameters.md) — Blockchain data enrichment used by observers
- [Menu Module README](../../src/backend/modules/menu/README.md) — Backend menu service that manages plugin navigation items
