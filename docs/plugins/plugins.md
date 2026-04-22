# Plugin System Overview

TronRelic's plugin system enables self-contained blockchain features that own everything they need—from transaction observers to frontend presentation—without touching the platform core.

## Why This Matters

The plugin system lets features like whale alerts and delegation tracking ship as self-contained workspaces that fail in isolation, depend on interfaces rather than infrastructure, and register their own routes, pages, and observers — all without touching platform core.

## Core System Components

### Plugin Lifecycle and Management

Plugins can be dynamically installed, enabled, disabled, and uninstalled through the `/system/plugins` admin interface without application restarts. Each plugin progresses through these states:

1. **Discovered** - Found in `src/plugins/` and registered in database (default: uninstalled, disabled)
2. **Installed** - `install()` hook runs, creates indexes, seeds defaults
3. **Enabled** - `enable()` and `init()` hooks run, registers observers and routes
4. **Disabled** - `disable()` hook runs, stops background tasks, keeps data intact
5. **Uninstalled** - `uninstall()` hook runs, cleans up persistent state

**See [plugins-system-architecture.md](./plugins-system-architecture.md) for complete details on:**
- Package layout and build outputs
- Manifest contracts and discovery flow
- Backend/frontend runtime initialization
- Lifecycle hooks and dependency injection context
- Hot reload and admin interface usage

### Blockchain Transaction Processing

The observer pattern transforms blockchain processing from a monolithic service into a modular, extensible pipeline. Each observer:

- Extends `BaseObserver` for queue management, overflow protection, and error isolation
- Subscribes to specific transaction types (e.g., `TransferContract`, `DelegateResourceContract`)
- Processes enriched `ITransaction` objects asynchronously
- Fails independently without blocking other observers or blockchain sync

**See [plugins-blockchain-observers.md](./plugins-blockchain-observers.md) for complete details on:**
- Observer pattern architecture and data flow
- Creating observers with dependency injection
- Subscription patterns and error handling
- Performance monitoring and statistics tracking
- Observer lifecycle within plugin init hooks

### Frontend UI Extension

Plugins extend the frontend through:

- **Menu items** - Navigation links with ordering, categorization, icons, and access control
- **Pages** - React components rendered via dynamic catch-all routing
- **Widget zones** - Inject UI components into designated zones on existing pages
- **Context injection** - UI components, API client, charts, and WebSocket access without cross-workspace imports

**SSR + Live Updates Pattern:** All visible plugin UI must follow the SSR + Live Updates pattern. Components render fully on the server with real data (no loading flash), then hydrate for interactivity and WebSocket subscriptions. **See [react.md](../frontend/react/react.md#ssr--live-updates-pattern) for the complete implementation guide.**

**See [plugins-page-registration.md](./plugins-page-registration.md) for complete details on:**
- Menu item and page configuration
- Dynamic routing and registry system
- Plugin admin pages and settings screens
- Migration from deprecated `adminUI` pattern

**See [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) for complete details on:**
- SEO fields on `IPageConfig` (title, description, keywords, ogImage, structuredData, noindex)
- `serverDataFetcher` for pre-fetching plugin page data during SSR
- bazi-fortune as the canonical reference implementation

**See [plugins-widget-zones.md](./plugins-widget-zones.md) for complete details on:**
- Registering widgets to inject UI into page zones
- Zone naming conventions and routing
- Widget ordering and lifecycle management
- Backend data fetching for widgets

**See [plugins-frontend-context.md](./plugins-frontend-context.md) for complete details on:**
- Using `IFrontendPluginContext` for dependency injection
- Accessing UI components, charts, API client, and WebSocket
- SSR + live updates pattern for plugin components
- CSS Modules for plugin-scoped styles
- Migration from cross-workspace imports

### REST API Routes

Plugins expose REST endpoints under `/api/plugins/<plugin-id>/` using framework-agnostic request/response objects. The API layer provides:

- **Automatic namespacing** - No route collisions between plugins
- **Middleware composition** - Auth, validation, rate limiting via `ApiMiddleware[]`
- **Lifecycle integration** - Routes register/unregister with plugin enable/disable
- **Admin routes** - Special `/api/plugins/<plugin-id>/system/**` endpoints with automatic auth

**See [plugins-api-registration.md](./plugins-api-registration.md) for complete details on:**
- Defining routes with `IApiRouteConfig`
- Handler patterns and middleware usage
- Admin route registration and auth enforcement
- Request/response contract and error handling

### Database Storage

Every plugin gets an isolated MongoDB sandbox with automatic collection prefixing. The database helper provides:

- **Scoped collections** - Prefixed with `plugin_<id>_` to prevent collisions
- **Key-value storage** - Simple config and state via `get()` / `set()`
- **Lifecycle-aware setup** - Create indexes in `install()`, load config in `init()`
- **Consistent API** - Framework-free helpers for CRUD operations

**See [system-database.md](../system/system-database.md#plugins) for complete details on:**
- Using `IDatabaseService` for scoped storage
- Creating indexes and seeding defaults in install hook
- Key-value storage patterns for configuration
- Best practices for data modeling and cleanup

### Cross-Component Service Sharing

The service registry (`context.services`) enables plugins to register named services that other plugins and modules consume at runtime. This is TronRelic's mechanism for plugin-to-plugin and plugin-to-module collaboration — a plugin provides a capability, and any consumer discovers it by name without importing concrete implementations.

The registry follows the same DI principle as constructor injection — consumers depend on abstractions, not implementations. The difference is resolution timing: constructor injection is static and wired at bootstrap, the registry is late-binding and resolved at call time. This makes it the natural fit for optional, plugin-provided services where the provider may be disabled or not yet initialized.

**Providing a service** — register during `init()`, unregister during `disable()`:

```typescript
init: async (context: IPluginContext) => {
    const myService = new MyService(context.database, context.logger);
    context.services.register('ai-assistant', myService);
},
disable: async (context: IPluginContext) => {
    context.services.unregister('ai-assistant');
}
```

**Sharing the service contract as a types-only package.** Provider plugins publish their service interface (e.g. `IAiAssistantService`, `IAiTool`) as a small types-only sibling package at `packages/types/` inside the provider's repo, published under a name like `@delphian/trp-<plugin>-types`. TronRelic treats these as workspaces of the root `tronrelic` package (see `package.json` `"workspaces": ["src/plugins/*/packages/*"]`), so the root `npm ci` links the types package into `/app/node_modules` once and every plugin resolves the import via Node's module walk-up. Consumer plugins declare the types package in *both* `peerDependencies` and `devDependencies` — matching how core types like `@delphian/tronrelic-types` are handled — and import the real interface:

```typescript
import type { IAiAssistantService, IAiTool } from '@delphian/trp-ai-assistant-types';

const ai = context.services.get<IAiAssistantService>('ai-assistant');
if (ai) {
    const tool: IAiTool = { name: 'my-tool', description: '…', inputSchema: { /* … */ }, handler };
    ai.registerTool(tool);
}
```

**Consumers must use `import type` only.** The types package exists purely so the TypeScript compiler sees the real contract — a signature change in the provider then surfaces as a build error in the consumer instead of a silent runtime break. `import type` erases at compile time and leaves no `require`/`import` in emitted JS, so listing the types package creates no runtime dependency on the provider plugin. The runtime lookup still flows through `context.services.get('ai-assistant')` and returns `undefined` when the provider is disabled or uninstalled — graceful degradation is preserved. If a consumer ever needs a runtime value (a constant, a helper) from the provider, promote that code to a package that ships runtime JS and declare a real dependency; do not value-import from a types-only package. Canonical provider: `trp-ai-assistant/packages/types/`. Canonical consumer: `trp-bazi-fortune/src/backend/backend.ts`.

**Anti-pattern: do not redeclare the service's interface locally.** It is tempting to write a "minimal structural adapter" describing only the methods the consumer calls, and to type registered payloads as `unknown` — the reasoning being that it avoids a dependency on the provider's types package. It does not. It reproduces the contract *by guessing*, and when the provider changes a method signature, adds a required field to its payload type, or renames an identifier, the consumer compiles green and fails at runtime. The types-only package exists to close that gap. If a consumer needs to call into a provider-registered service, it must import the real interface from the provider's types package — never redeclare it locally.

**Consuming a service — one-shot read with `get()`.** Use `get()` when the caller needs the service at a single moment and doesn't care whether it appears or disappears later (an admin route, a one-off migration, diagnostics). Always handle the undefined case:

```typescript
import type { IAiAssistantService } from '@delphian/trp-ai-assistant-types';

const ai = context.services.get<IAiAssistantService>('ai-assistant');
if (ai) {
    const result = await ai.ask('Analyze recent transactions');
    context.logger.info({ text: result.text }, 'ai response');
}
```

**Consuming a service — continuous presence with `watch()`.** Use `watch()` when the caller's behavior depends on the service being present over time — registering peer-facing hooks the moment a provider appears, or dropping cached references when it goes away. `watch()` fires `onAvailable` synchronously if the service is already registered at subscription time, re-fires on every subsequent re-registration, and fires `onUnavailable` whenever the provider unregisters. This closes two gaps `get()` cannot: the boot-order race where the consumer's `init()` runs before the provider's, and runtime churn where a provider is disabled and re-enabled by an operator.

```typescript
let unwatchAi: (() => void) | null = null;

init: async (context: IPluginContext) => {
    unwatchAi = context.services.watch<IAiAssistantService>('ai-assistant', {
        onAvailable: (ai) => ai.registerTool(myToolDefinition),
        onUnavailable: () => context.logger.info('ai-assistant gone — tool unregistered')
    });
},

disable: async (context: IPluginContext) => {
    unwatchAi?.();
    unwatchAi = null;
}
```

`watch()` is state-oriented, not event-oriented: the registry models "does this capability exist right now?" as a continuous truth, and `watch()` subscribes the caller to that truth. Three rules for handlers: **keep `onAvailable` idempotent** (the registry fires it again on every re-registration), **treat `onUnavailable` as past tense** (the provider's instance is already gone — don't call into it), and **always dispose in `disable()`** (the disposer returned from `watch()` prevents the registry from retaining closures that point at torn-down plugin state).

**Architectural direction:** The registry exists so that features providing shared capabilities — AI analysis, notification dispatch, data enrichment — can remain plugins rather than requiring promotion to modules. A plugin that exposes a shared service is still a plugin if the application functions without it. Consumers must handle the service being unavailable, which enforces graceful degradation by design. See [modules.md](../system/modules/modules.md#module-vs-plugin-decision-matrix) for how this changes the module vs plugin decision.

### WebSocket Real-Time Events

Plugins manage custom real-time subscriptions through a namespaced WebSocket manager that prevents collisions while maintaining Socket.IO semantics. The system provides:

- **Subscription autonomy** - Plugins define custom subscription handlers
- **Automatic namespacing** - Room names and event names prefixed with plugin ID
- **Flexible filtering** - Validate payloads and reject invalid subscriptions
- **Observable metrics** - Track room membership and emission rates

**See [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md) for complete details on:**
- Subscription and unsubscribe handler registration
- Room management with auto-join/auto-leave
- Event emission to rooms and specific sockets
- Frontend subscription patterns and helper methods
- Monitoring and debugging WebSocket activity

## Quick Reference

### Creating a New Plugin

> **Prerequisite:** `src/plugins/*` is gitignored; plugins are cloned from their own repositories by `./scripts/setup.sh` driven by `plugins.json`. Before you can reference `src/plugins/trp-ai-assistant/` as a template, populate it by copying `plugins.json.example` to `plugins.json` (with `trp-ai-assistant` enabled) and running `./scripts/setup.sh`.

1. **Study the canonical reference** - Read `src/plugins/trp-ai-assistant/` end-to-end. It demonstrates every pattern in this guide: manifest shape, lifecycle hooks, scheduler registration, service registry publication, admin routes, and SSR-first pages.
2. **Scaffold** - Create `src/plugins/<new-id>/` matching the [Plugin Package Structure](#plugin-package-structure). Copy `package.json`, `tsconfig.json`, `tsconfig.frontend.json`, `scripts/copy-frontend-assets.mjs`, `src/global.d.ts`, and `src/manifest.ts` from `trp-ai-assistant` as baselines — then rewrite the manifest id/title/version in step 3.
3. **Update manifest** - Set `id`, `title`, `version`, `backend`/`frontend` flags in `src/manifest.ts`
4. **Install dependencies** - Run `npm install` from repo root
5. **Implement backend** - Create observers, API routes, database setup in `src/backend/`
6. **Implement frontend** - Create pages, components, WebSocket handlers in `src/frontend/`
7. **Build plugin** - Run `cd src/plugins/<new-id> && npm run build`
8. **Generate registry** - Run `npm run generate:plugins`
9. **Install and enable** - Use `/system/plugins` admin interface to activate the plugin

### Plugin Package Structure

```
src/plugins/{plugin-id}/
├── src/
│   ├── manifest.ts              # Shared metadata (backend + frontend)
│   ├── global.d.ts              # Ambient *.module.scss / *.module.css types
│   ├── backend/
│   │   ├── backend.ts           # Entry point with lifecycle hooks
│   │   └── *.observer.ts        # Transaction observers
│   ├── frontend/
│   │   ├── frontend.ts          # Entry point with pages/menu items
│   │   ├── *.tsx                # React components
│   │   ├── *.module.scss        # SCSS Modules for scoped styles
│   │   ├── widgets/             # Widget component registry — optional
│   │   └── public/              # Stable-URL static assets — optional
│   └── shared/                  # Types shared between backend/frontend
│       ├── types/
│       └── constants.ts
├── scripts/
│   └── copy-frontend-assets.mjs # Mirrors SCSS into dist/frontend after tsc
├── dist/                        # Compiled artifacts (both loaders consume)
│   ├── manifest.js
│   ├── backend/backend.js
│   └── frontend/                # Compiled TSX + mirrored SCSS
│       ├── frontend.js
│       └── widgets/index.js     # If the plugin ships widgets
├── package.json                 # Workspace config (exports map points at dist/)
├── tsconfig.json                # Backend TS config
└── tsconfig.frontend.json       # Frontend TS config (emits dist/frontend/)
```

### Common Plugin Patterns

**Backend observer with WebSocket emission:**
```typescript
export const myPluginBackendPlugin = definePlugin({
    manifest: myManifest,

    init: async (context: IPluginContext) => {
        const observer = createMyObserver(
            context.BaseObserver,
            context.observerRegistry,
            context.websocket,
            context.logger
        );
    }
});
```

**Frontend page with API and UI:**
```typescript
export function MyPluginPage({ context }: { context: IFrontendPluginContext }) {
    const { ui, api, charts } = context;
    const [data, setData] = useState([]);

    useEffect(() => {
        async function loadData() {
            const result = await api.get('/plugins/my-plugin/data');
            setData(result.items);
        }
        void loadData();
    }, [api]);

    return (
        <ui.Card>
            <charts.LineChart series={data} />
        </ui.Card>
    );
}
```

**WebSocket subscription handler:**
```typescript
context.websocket.onSubscribe(async (socket, roomName, payload) => {
    const { threshold } = payload;

    if (threshold < 0 || threshold > 1_000_000) {
        throw new Error('Invalid threshold');
    }

    // Client auto-joined to 'plugin:my-plugin:{roomName}'
    context.websocket.emitToSocket(socket, 'subscribed', { roomName, threshold });
});
```

**Service registry** — see [Cross-Component Service Sharing](#cross-component-service-sharing) for examples of registering and consuming shared services via `context.services`.

## Further Reading

**Detailed documentation:**
- [plugins-system-architecture.md](./plugins-system-architecture.md) - Package layout, manifests, lifecycle hooks, admin interface
- [plugins-blockchain-observers.md](./plugins-blockchain-observers.md) - Observer pattern, transaction processing, subscriptions
- [plugins-page-registration.md](./plugins-page-registration.md) - Menu items, pages, routing, admin UI
- [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) - SEO metadata fields and `serverDataFetcher` for body SSR (bazi-fortune as canonical example)
- [plugins-widget-zones.md](./plugins-widget-zones.md) - Widget zones for injecting UI into existing pages
- [plugins-frontend-context.md](./plugins-frontend-context.md) - Context injection, UI components, API client, WebSocket
- [plugins-api-registration.md](./plugins-api-registration.md) - REST routes, middleware, admin endpoints
- [system-database.md](../system/system-database.md#plugins) - Scoped storage, indexes, key-value config
- [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md) - Real-time subscriptions, rooms, event namespacing

**Related topics:**
- [Frontend Architecture](../frontend/frontend.md) - Frontend system overview and patterns
- [Chain Parameters](../tron/tron-chain-parameters.md) - Blockchain data enrichment used by observers
- [Menu Module README](../../src/backend/modules/menu/README.md) - Backend menu service that manages plugin navigation items
