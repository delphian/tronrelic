# Plugin System Overview

A plugin is a self-contained feature that brings its own blockchain observers, REST routes, pages, widgets, real-time subscriptions, and shared services — without modifying the platform core.

## Why This Matters

A plugin fails in isolation, depends on interfaces rather than concrete classes, and registers everything it adds at runtime. Those three properties let features such as whale alerts and delegation tracking change without anyone rewriting shared infrastructure, and let an operator turn a feature off without restarting the application.

## Plugins Couple Only Through Published Contracts

A plugin may depend on core, or on another plugin, **only** through that component's published and versioned types package — `@delphian/tronrelic-types` for core, or `@delphian/trp-<name>-types` for a plugin. The dependency must be declared in the plugin's own `package.json` and imported with `import type` only, so the coupling exists at compile time and adds nothing at runtime.

The plugins share one repository during development, which makes them easier to work on together. That does not give a plugin permission to depend on another plugin's code. Importing another plugin's source or types because the two directories sit side by side is a bug even when it compiles here, because it breaks as soon as that plugin is installed on its own. To check your work, ask whether the plugin would still build if it had only the dependencies it declares. If it would not, the plugin is wrong.

**Never edit the `version` field of a types package by hand.** Continuous integration owns that field. Each plugin's `publish-types.yml` workflow runs `npm version patch` on every push to `main` that touches `packages/types/**` or `src/shared/types/**`, commits the bump, and publishes the result to GitHub Packages.

Changing the version in a feature branch means two things are writing the same line. Any other pull request touching types that merges while yours is open moves that line too, and the resulting conflict blocks a rebase merge outright with `This branch can't be rebased`, forcing a squash merge instead of the strategy this project defaults to. The workflow only ever bumps the patch number, so setting a minor version by hand achieves nothing. Leave the field alone. If your working tree already carries a bump, restore both `package.json` and its lockfile from `main` before committing, rather than sweeping them in with `git add -A`.

## Plugin Lifecycle

A plugin moves through five states, all controlled from `/system/plugins` without restarting the application.

1. **Discovered** — found in `src/plugins/` and registered, but not yet installed or enabled
2. **Installed** — `install()` has run to create database indexes and seed default values
3. **Enabled** — `enable()` and then `init()` have run to register observers, routes, and services
4. **Disabled** — `disable()` has run to stop background work, leaving stored data in place
5. **Uninstalled** — `uninstall()` has run to clean up everything persistent

A plugin loads at runtime only when it is both installed **and** enabled. See [plugins-system-architecture.md](./plugins-system-architecture.md) for the package layout, the manifest that describes a plugin to the loader, runtime startup, hot reload, and the admin interface.

## What a Plugin Can Extend

**Blockchain transaction processing.** Subscribe to TRON contract types such as `TransferContract` or `DelegateResourceContract` by extending the injected `BaseObserver` class. Your observer inherits queue management, protection against overflow, and error isolation, so a failure inside it can never block blockchain sync. See [plugins-blockchain-observers.md](./plugins-blockchain-observers.md).

**Frontend UI.** Register menu entries, whole pages, and widgets that render into zones on existing pages. Components receive `IFrontendPluginContext`, which supplies UI building blocks, charts, an API client, and a WebSocket client, so no plugin needs to import across workspace boundaries. All plugin UI must follow [SSR + Live Updates](../frontend/react/react.md#ssr--live-updates-pattern). See [plugins-page-registration.md](./plugins-page-registration.md), [plugins-widget-zones.md](./plugins-widget-zones.md), [plugins-frontend-context.md](./plugins-frontend-context.md), and [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md).

**REST API routes.** Endpoints mount under `/api/plugins/<plugin-id>/` using request and response objects that are independent of any web framework. Any route beneath `/api/plugins/<plugin-id>/system/**` automatically receives the `requireAdmin` middleware. See [plugins-api-registration.md](./plugins-api-registration.md).

**Database storage.** Each plugin gets its own area of MongoDB through `IDatabaseService`, with every collection name automatically prefixed `plugin_<id>_`. Create indexes in `install()` and load configuration in `init()`. See [system-database.md](../system/system-database.md#plugins).

**Real-time WebSocket events.** Define custom subscriptions through a manager that automatically prefixes room and event names with the plugin id, so two plugins can never collide. Handlers may validate an incoming payload and reject it. See [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md).

**Sharing services with other components.** The service registry (`context.services`) lets a plugin publish a named service that other plugins and modules can find at runtime. Providers register during `init()` and unregister during `disable()`. Consumers either call `get()` for a one-off lookup or `watch()` to keep following a service as it comes and goes. This is what allows a feature that offers shared capabilities to remain a plugin, as long as the application still works without it.

**A plugin publishes exactly one registry name**, and everything a programmatic caller may do with that plugin is reachable from the object behind it. Where the plugin covers several distinct topics, do not put every method on one interface. Instead, the object behind that single registry name exposes accessor methods, and each accessor returns a smaller service covering one of those topics. Group them by what the data and abilities are about, rather than by who may call them. See [plugins-service-registry.md](./plugins-service-registry.md).

**Contributing into core execution.** Hooks work in the opposite direction from the service registry. The registry lets a plugin publish a capability that other code calls. The hook system (`context.hooks`) lets a plugin add code into core's own execution, at named points that core declares, such as injecting markup into the HTML `<head>` or acting during the request lifecycle. Handlers register against descriptors from the central `HOOKS` registry rather than string literals, are removed automatically when the plugin is disabled, and appear on the `/system/hooks` timeline so operators can see which plugin is changing what. See [system-hooks.md](../system/system-hooks.md) for the contract, the four styles of hook, and the rules that keep one failing handler from taking down the others.

**AI tools.** Register an `IAiTool` on the AI tool registry to expose an action a model can invoke during a query, such as looking up a transaction, posting to a channel, or generating an image. Tools are independent of any AI vendor. The installed provider plugin, which is `trp-ai-assistant` for Anthropic, carries the request to the model and the response back, and it does not define what the tools do. Every tool must declare its capability class and satisfy the platform's accountability and security requirements. To check whether any provider is available, ask the core `'ai-providers'` registry rather than probing a specific provider's service name such as `'ai-assistant'`, which would tie you to one vendor. See [system-ai-tools.md](../system/system-ai-tools.md).

**File picker.** Call `context.useFilePicker().pick()` to let a user upload a local file or choose one already uploaded. Core owns the interface, but the picker interface itself is delivered by whichever files-provider plugin is enabled — `trp-files` by default — and the most recent registration wins, so an operator can swap in an alternative without any consumer changing. Treat the returned `url` and `fileId` as opaque values. When no provider is enabled, `isAvailable` is `false` and `pick()` resolves to `null`, so handle that case gracefully. A core backend equivalent has been deliberately postponed; see the note in [plugins-frontend-context.md](./plugins-frontend-context.md#file-picker-contextusefilepicker).

## Quick Reference

The reference implementation is `src/plugins/trp-ai-assistant/`, which exercises the lifecycle hooks, scheduled jobs, publishing to the service registry, admin routes, and server-rendered pages. For a walkthrough of building a new plugin, see [plugins-system-architecture.md → Adding or updating a plugin](./plugins-system-architecture.md#adding-or-updating-a-plugin).

### Common Pattern: Backend Plugin Init

Wire up observers and publish services inside `init()`, using only the injected `IPluginContext`:

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

For the complete walkthrough including the observer factory, see [plugins-system-architecture.md → Backend implementation pattern](./plugins-system-architecture.md#backend-implementation-pattern). For page patterns that satisfy SSR + Live Updates, see [plugins-frontend-context.md](./plugins-frontend-context.md) and [react.md](../frontend/react/react.md#ssr--live-updates-pattern).

## Further Reading

**Detail documents:**

- [plugins-catalog.md](./plugins-catalog.md) — index of every installed plugin and each market integration
- [plugins-system-architecture.md](./plugins-system-architecture.md) — package layout, manifests, lifecycle hooks, runtime flow, admin interface
- [plugins-blockchain-observers.md](./plugins-blockchain-observers.md) — the observer pattern, transaction processing, subscriptions
- [plugins-page-registration.md](./plugins-page-registration.md) — gateway to the menu and page system
- [plugins-page-registration-menu.md](./plugins-page-registration-menu.md) — `IMenuService.create()`, menu node fields, hierarchies, visibility rules
- [plugins-page-registration-pages.md](./plugins-page-registration-pages.md) — the `pages` array, `IPageConfig`, the page component contract, registry startup
- [plugins-page-registration-admin.md](./plugins-page-registration-admin.md) — registering admin pages and the automatic gate on the System container
- [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) — search engine metadata fields and `serverDataFetcher`
- [plugins-widget-zones.md](./plugins-widget-zones.md) — the catalog of widget zones and how server-rendered data reaches them
- [plugins-widget-zones-registration.md](./plugins-widget-zones-registration.md) — registering widgets, filtering by route, ordering, lifecycle, debugging
- [plugins-widget-zones-ssr.md](./plugins-widget-zones-ssr.md) — widget components, SSR + Live Updates, hydration pitfalls
- [plugins-frontend-context.md](./plugins-frontend-context.md) — the shape of `IFrontendPluginContext`, linking to the detail documents below
- [plugins-frontend-context-ui.md](./plugins-frontend-context-ui.md) — layout, UI primitives, charts, `useUser`, `useModal`
- [plugins-frontend-context-api.md](./plugins-frontend-context-api.md) — the `context.api` HTTP client and admin gating
- [plugins-frontend-context-websocket.md](./plugins-frontend-context-websocket.md) — automatically prefixed events and rooms, and reliable subscriptions
- [plugins-frontend-context-styling.md](./plugins-frontend-context-styling.md) — CSS Modules, design tokens, SSR + Live Updates
- [plugins-api-registration.md](./plugins-api-registration.md) — REST routes, middleware, admin endpoints
- [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md) — real-time subscriptions, rooms, event namespacing
- [plugins-service-registry.md](./plugins-service-registry.md) — sharing services between components
- [system-hooks.md](../system/system-hooks.md) — hook seams, the four styles, the plugin-facing wrapper, admin introspection
- [system-ai-tools.md](../system/system-ai-tools.md) — the AI tool contract, capability classes, and the accountability and security every tool must meet
- [system-database.md](../system/system-database.md#plugins) — scoped storage, indexes, key-value configuration

**Related topics:**

- [Frontend Architecture](../frontend/frontend.md) — frontend system overview and patterns
- [Chain Parameters](../tron/tron-chain-parameters.md) — the blockchain data observers use for enrichment
- [Menu Module README](../../src/backend/modules/menu/README.md) — the backend service that manages plugin navigation entries
