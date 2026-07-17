# Plugin System Overview

Self-contained blockchain features that own observers, REST routes, pages, widgets, real-time subscriptions, and shared services — without touching the platform core.

## Why This Matters

Plugins fail in isolation, depend on interfaces, and register their own surfaces dynamically. Features like whale alerts and delegation tracking iterate without rewriting shared infrastructure; operators toggle them at runtime without restarts.

## Plugins Couple Only Through Published Contracts

A plugin may depend on core or on another plugin **only** through that component's published, versioned types package (`@delphian/tronrelic-types`, `@delphian/trp-<name>-types`) — declared in its own `package.json` and consumed `import type`-only, so the coupling is a compile-time contract with no runtime dependency. The monorepo is a development convenience, never a dependency channel: resolving another plugin's source or types by workspace co-location is a defect even when it compiles here, because it breaks on a standalone install. The test is blunt — a plugin that wouldn't build against only its own declared dependencies is wrong.

## Plugin Lifecycle

Five states, controlled from `/system/plugins` without restarts:

1. **Discovered** — registered from `src/plugins/` (default: uninstalled, disabled)
2. **Installed** — `install()` runs: create indexes, seed defaults
3. **Enabled** — `enable()` then `init()` run: register observers, routes, services
4. **Disabled** — `disable()` runs: stop background tasks, keep data
5. **Uninstalled** — `uninstall()` runs: clean up persistent state

Only **installed AND enabled** plugins load at runtime. See [plugins-system-architecture.md](./plugins-system-architecture.md) for package layout, manifests, runtime init, hot reload, and admin UI.

## Extension Surfaces

**Blockchain transaction processing.** Subscribe to TRON contract types (`TransferContract`, `DelegateResourceContract`, etc.) by extending the injected `BaseObserver`. Inherits queue management, overflow protection, and error isolation — observer failures cannot block sync. See [plugins-blockchain-observers.md](./plugins-blockchain-observers.md).

**Frontend UI extension.** Register menu items, full pages, and widgets injecting into zones on existing pages. Components receive `IFrontendPluginContext` (UI primitives, charts, api, websocket) — no cross-workspace imports. All plugin UI must follow [SSR + Live Updates](../frontend/react/react.md#ssr--live-updates-pattern). See [plugins-page-registration.md](./plugins-page-registration.md), [plugins-widget-zones.md](./plugins-widget-zones.md), [plugins-frontend-context.md](./plugins-frontend-context.md), [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md).

**REST API routes.** Endpoints mount under `/api/plugins/<plugin-id>/` via framework-agnostic request/response objects. Routes under `/api/plugins/<plugin-id>/system/**` auto-receive `requireAdmin` middleware. See [plugins-api-registration.md](./plugins-api-registration.md).

**Database storage.** Each plugin gets a MongoDB sandbox via `IDatabaseService` with collections auto-prefixed `plugin_<id>_`. Indexes belong in `install()`, config load in `init()`. See [system-database.md](../system/system-database.md#plugins).

**WebSocket real-time events.** Custom subscriptions through a namespaced manager — room and event names auto-prefixed with plugin ID. Handlers may validate and reject payloads. See [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md).

**Cross-component service sharing.** The service registry (`context.services`) lets plugins publish named services that other plugins and modules discover at runtime. Providers register on `init()`, unregister on `disable()`; consumers call `get()` (one-shot) or `watch()` (continuous). This shifts the module-vs-plugin decision: a feature exposing a shared service can stay a plugin as long as the app functions without it. See [plugins-service-registry.md](./plugins-service-registry.md).

**Core-pipeline hooks.** The inverse directional flow: where the service registry lets plugins *publish* capabilities, the hook system (`context.hooks`) lets plugins *contribute* into core's own execution at typed seams it declares — SSR `<head>` injection, request lifecycle, and so on. Handlers register against descriptors from a central `HOOKS` registry (no magic strings), are scoped to the plugin lifecycle, and surface on the `/system/hooks` admin timeline so operators can see who is mutating what. See [system-hooks.md](../system/system-hooks.md) for the contract, archetypes, and failure-isolation rules.

**AI tools.** Expose tools a model can invoke during an AI query (look up a transaction, post to a channel, generate an image) by registering an `IAiTool` on the AI tool registry. Tools are provider-neutral — the installed AI provider plugin (`trp-ai-assistant` for Anthropic) is only the transport. Every tool must declare its capability class and meet the platform's accountability and security requirements. To check whether a provider is available, ask the core `'ai-providers'` registry — never probe a provider's own service name like `'ai-assistant'`, which couples you to one vendor. See [system-ai-tools.md](../system/system-ai-tools.md).

**File picker.** Let a user pick a local file to upload or choose from already-uploaded files via `context.useFilePicker().pick()`. Core owns the interface; the picker UI is *provider-delivered* — the enabled files-provider plugin (`trp-files` by default) registers its own picker (last registration wins), so an operator can swap in an alternative without touching consumers. Store the returned `url`/`fileId` opaquely; when no provider is enabled, `isAvailable` is `false` and `pick()` resolves `null` — degrade gracefully. A core *backend* files-module facade is intentionally deferred (see the callout in [plugins-frontend-context.md](./plugins-frontend-context.md#file-picker-contextusefilepicker)). See [plugins-frontend-context.md](./plugins-frontend-context.md).

## Quick Reference

Canonical reference implementation: `src/plugins/trp-ai-assistant/` — exercises lifecycle hooks, scheduler jobs, service registry publication, admin routes, and SSR-first pages. New-plugin walkthrough: [plugins-system-architecture.md → Adding or updating a plugin](./plugins-system-architecture.md#adding-or-updating-a-plugin).

### Common Pattern: Backend Plugin Init

Wire observers and service-registry publication inside `init()` using only the injected `IPluginContext`:

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

- [plugins-catalog.md](./plugins-catalog.md) — Index of all installed plugins and per-market integrations
- [plugins-system-architecture.md](./plugins-system-architecture.md) — Package layout, manifests, lifecycle hooks, runtime flow, admin interface
- [plugins-blockchain-observers.md](./plugins-blockchain-observers.md) — Observer pattern, transaction processing, subscriptions
- [plugins-page-registration.md](./plugins-page-registration.md) — Menu and page system overview (gateway)
- [plugins-page-registration-menu.md](./plugins-page-registration-menu.md) — `IMenuService.create()`, menu node fields, hierarchies, visibility gating
- [plugins-page-registration-pages.md](./plugins-page-registration-pages.md) — `pages` array, `IPageConfig`, page component contract, registry bootstrap
- [plugins-page-registration-admin.md](./plugins-page-registration-admin.md) — Admin page registration, System container auto-gate
- [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) — SEO metadata fields and `serverDataFetcher`
- [plugins-widget-zones.md](./plugins-widget-zones.md) — Widget zones index: zone catalog and SSR data flow
- [plugins-widget-zones-registration.md](./plugins-widget-zones-registration.md) — Backend widget registration, route filtering, ordering, lifecycle, debugging
- [plugins-widget-zones-ssr.md](./plugins-widget-zones-ssr.md) — Widget components, SSR + Live Updates, hydration gotchas
- [plugins-frontend-context.md](./plugins-frontend-context.md) — `IFrontendPluginContext` index and shape (links to detail docs below)
- [plugins-frontend-context-ui.md](./plugins-frontend-context-ui.md) — Layout, UI, charts, `useUser`, `useModal`
- [plugins-frontend-context-api.md](./plugins-frontend-context-api.md) — `context.api` HTTP client and admin gating
- [plugins-frontend-context-websocket.md](./plugins-frontend-context-websocket.md) — Auto-prefixed events/rooms and reliable subscriptions
- [plugins-frontend-context-styling.md](./plugins-frontend-context-styling.md) — CSS Modules, design tokens, SSR + Live Updates
- [plugins-api-registration.md](./plugins-api-registration.md) — REST routes, middleware, admin endpoints
- [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md) — Real-time subscriptions, rooms, event namespacing
- [plugins-service-registry.md](./plugins-service-registry.md) — Cross-component service sharing
- [system-hooks.md](../system/system-hooks.md) — Core-pipeline hooks: declared seams, archetypes, plugin facade, admin introspection
- [system-ai-tools.md](../system/system-ai-tools.md) — AI tool contract, capability classes, and the accountability/security every tool must meet
- [system-database.md](../system/system-database.md#plugins) — Scoped storage, indexes, key-value config

**Related topics:**

- [Frontend Architecture](../frontend/frontend.md) — Frontend system overview and patterns
- [Chain Parameters](../tron/tron-chain-parameters.md) — Blockchain data enrichment used by observers
- [Menu Module README](../../src/backend/modules/menu/README.md) — Backend menu service that manages plugin navigation items
