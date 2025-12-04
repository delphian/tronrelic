# Plugin System Overview

TronRelic's plugin system enables self-contained blockchain features that own everything they need—from transaction observers to frontend presentation—without touching the platform core.

## Who This Document Is For

Backend developers implementing plugins, frontend developers extending UI, and maintainers understanding the plugin architecture.

## Why This Matters

TronRelic's blockchain pipeline ingests thousands of TRON transactions per second. The plugin system lets us experiment with features like whale alerts, delegation tracking, and custom analytics without:

- **Destabilizing core services** - Plugins use dependency injection and fail in isolation
- **Fragmenting the codebase** - Each plugin is a single workspace with backend + frontend code
- **Coupling to infrastructure** - Plugins depend on `@tronrelic/types` interfaces, not concrete implementations
- **Manual routing changes** - Pages, navigation, API routes, and WebSocket events register automatically

## Core System Components

### Plugin Lifecycle and Management

Plugins can be dynamically installed, enabled, disabled, and uninstalled through the `/system/plugins` admin interface without application restarts. Each plugin progresses through these states:

1. **Discovered** - Found in `packages/plugins/` and registered in database (default: uninstalled, disabled)
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

**See [plugins-database.md](./plugins-database.md) for complete details on:**
- Using `IPluginDatabase` for scoped storage
- Creating indexes and seeding defaults in install hook
- Key-value storage patterns for configuration
- Best practices for data modeling and cleanup

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

1. **Scaffold** - Copy `packages/plugins/example-alerts` to `packages/plugins/<new-id>`
2. **Update manifest** - Set `id`, `title`, `version`, `backend`/`frontend` flags in `src/manifest.ts`
3. **Install workspace** - Run `npm install` from repo root to link the new package
4. **Implement backend** - Create observers, API routes, database setup in `src/backend/`
5. **Implement frontend** - Create pages, components, WebSocket handlers in `src/frontend/`
6. **Build plugin** - Run `npm run build --workspace packages/plugins/<new-id>`
7. **Generate registry** - Run `npm run generate:plugins --workspace apps/frontend`
8. **Install and enable** - Use `/system/plugins` admin interface to activate the plugin

### Plugin Package Structure

```
packages/plugins/{plugin-id}/
├── src/
│   ├── manifest.ts              # Shared metadata (backend + frontend)
│   ├── backend/
│   │   ├── backend.ts          # Entry point with lifecycle hooks
│   │   └── *.observer.ts       # Transaction observers
│   ├── frontend/
│   │   ├── frontend.ts         # Entry point with pages/menu items
│   │   ├── *.tsx               # React components
│   │   └── *.module.css        # CSS Modules for scoped styles
│   └── shared/                  # Types shared between backend/frontend
│       ├── types/
│       └── constants.ts
├── dist/                        # Compiled backend output
│   ├── manifest.js
│   └── backend/backend.js
├── package.json                 # Workspace config
└── tsconfig.json               # TypeScript config
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

## Further Reading

**Detailed documentation:**
- [plugins-system-architecture.md](./plugins-system-architecture.md) - Package layout, manifests, lifecycle hooks, admin interface
- [plugins-blockchain-observers.md](./plugins-blockchain-observers.md) - Observer pattern, transaction processing, subscriptions
- [plugins-page-registration.md](./plugins-page-registration.md) - Menu items, pages, routing, admin UI
- [plugins-widget-zones.md](./plugins-widget-zones.md) - Widget zones for injecting UI into existing pages
- [plugins-frontend-context.md](./plugins-frontend-context.md) - Context injection, UI components, API client, WebSocket
- [plugins-api-registration.md](./plugins-api-registration.md) - REST routes, middleware, admin endpoints
- [plugins-database.md](./plugins-database.md) - Scoped storage, indexes, key-value config
- [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md) - Real-time subscriptions, rooms, event namespacing

**Related topics:**
- [Frontend Architecture](../frontend/frontend.md) - Frontend system overview and patterns
- [Market System](../markets/markets.md) - Market fetcher plugin examples
- [Chain Parameters](../tron/tron-chain-parameters.md) - Blockchain data enrichment used by observers
- [Menu Module](../system/system-modules-menu.md) - Backend menu service that manages plugin navigation items
