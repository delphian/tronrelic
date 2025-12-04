# Plugin System

TronRelic's plugin system keeps high-impact blockchain features self-contained so we can iterate quickly without rewriting the platform core. Each plugin owns everything it needs—from transaction observers to frontend presentation—so enabling or disabling a feature never leaks concerns back into shared infrastructure.

## Why This Matters

This guide speaks directly to plugin authors and maintainers who ship blockchain features on TronRelic. Internalising these guardrails keeps experiments from spilling into core services, prevents UI drift, and protects production data when teams toggle features on and off.

Our blockchain pipeline ingests thousands of TRON transactions per second. We need a way to experiment with features like whale alerts without destabilizing core services. The plugin system delivers that by:

- Letting us ship or retire entire features by touching one directory.
- Protecting the blockchain service from feature-specific logic via dependency injection.
- Allowing the frontend to discover optional UI at runtime instead of hard-coding imports.
- Enabling plugins to register navigation menu items and routable pages without modifying core infrastructure.
- Keeping tests, docs, and build tooling scoped to the feature team that owns the plugin.

## How It Works

1. Auto-discovery registers plugin manifests so the platform understands available features before any runtime hooks execute.
2. Administrators toggle installation and enablement states in `/system/plugins`, and the lifecycle hooks wire features in or out without restarting services.
3. Each plugin ships backend and frontend surfaces from a single workspace, keeping builds deterministic and preventing interface drift.

### Plugin Management

Plugins can be dynamically installed, uninstalled, enabled, and disabled through the `/system/plugins` admin interface without requiring application restarts. This management system provides:

- **Auto-discovery**: Plugins are automatically discovered on startup and registered in the database with default state of `installed: false` and `enabled: false`.
- **State tracking**: Each plugin's installation and enabled status is persisted in MongoDB, allowing administrators to control which plugins are active.
- **Hot reload**: Enabling or disabling a plugin dynamically calls lifecycle hooks and updates the running system without requiring a restart.
- **Dependency enforcement**: Plugins must be installed before they can be enabled. Uninstalling automatically disables the plugin first.
- **Error handling**: Installation and lifecycle hook failures are captured and displayed in the admin UI for debugging.

### Plugin Lifecycle Hooks

Plugins support the following lifecycle hooks for state management:

- **`install(context)`** - Run once when the plugin is first installed. Use this to create database indexes, seed default configuration, or perform one-time setup. Called before enabling the plugin.
- **`enable(context)`** - Run when the plugin is enabled. Use this to start background tasks or activate features. Called before `init()`.
- **`init(context)`** - Run on every application startup for enabled plugins. Use this to register observers, start services, or connect to external systems.
- **`disable(context)`** - Run when the plugin is disabled. Use this to stop background tasks and deactivate features without removing persistent data.
- **`uninstall(context)`** - Run when the plugin is uninstalled. Use this to clean up database collections or remove persistent state. Note: Always sets `installed: false` even if the hook fails.

Only plugins that are both **installed AND enabled** will have their backend and frontend components loaded and initialized.

### Plugin Package Layout

We organize every plugin under `packages/plugins/<plugin-id>` so backend and frontend code live together. This colocation matters because a feature almost always spans both runtimes, and splitting the files would make updates brittle.

#### Directory Essentials

- `package.json` declares the workspace package, exposes `dist/backend/backend.js` as the Node entry point, and leaves `./src/frontend/frontend.ts` as the ESM export consumed by Next.js.
- `tsconfig.json` compiles only backend-facing TypeScript (manifest + backend files) into `dist/` and intentionally excludes React code.
- `src/manifest.ts` centralizes metadata shared by both runtimes. The manifest sets `backend: true` and/or `frontend: true` so loaders know which surfaces exist.
- `src/backend/backend.ts` exports the `definePlugin` wrapper that wires `manifest` and `init` together.
- `src/backend/*.ts` files house the actual observers, queues, and service integration the plugin needs.
- `src/frontend/frontend.ts` exports the `definePlugin` wrapper for the browser runtime and imports the plugin's CSS file.
- `src/frontend/*.tsx` files contain the React implementation (toasts, dashboards, etc.).
- `src/frontend/styles.css` contains plugin-specific styles with scoped class names (e.g., `.whale-dashboard`, `.whale-stat-card`).
- `src/shared/` (optional) contains types, constants, and utilities shared between backend and frontend to eliminate duplication and maintain a single source of truth.
- `dist/` contains everything the backend loader consumes: `manifest.js`, `manifest.d.ts`, `backend/backend.js`, and type maps.
- `dist/frontend.bundle.js` is produced by the shared esbuild task so we have a browser-friendly artifact for CDN or static hosting scenarios, even though Next currently imports the source file directly.

#### Plugin Shared Code Organization

Why shared code matters: Plugins often define data models, configuration interfaces, and constants that both backend observers and frontend components need. Duplicating these types creates drift—when the backend changes its transaction shape, the frontend's inline copy breaks silently. The `src/shared/` directory solves this by giving plugins a single source of truth that both runtimes import using simple relative paths.

**Structure:**

```
packages/plugins/{plugin-id}/
├── src/
│   ├── backend/          # Server-side implementation
│   ├── frontend/         # Client-side implementation
│   └── shared/           # Code shared between backend and frontend
│       ├── types/        # TypeScript interfaces (one per file)
│       │   ├── IPluginConfig.ts
│       │   ├── IPluginTransaction.ts
│       │   └── index.ts  # Barrel export
│       ├── constants.ts
│       └── index.ts      # Barrel export
```

**When to use `src/shared/`:**

- Plugin-specific data models (transaction shapes, config interfaces, API responses)
- Constants and enums used by both backend observers and frontend components
- Type definitions for WebSocket payloads emitted by the plugin
- Any interface or type that appears in both `src/backend/` and `src/frontend/`

**When to use `@tronrelic/types` instead:**

- Framework contracts that define how plugins integrate with the platform (`IPluginContext`, `IPluginManifest`)
- Core blockchain primitives consumed across multiple plugins (`ITransaction`, `IBlock`)
- Types that need to be shared with code outside the plugin workspace
- Platform-wide interfaces that establish architectural patterns

**Import pattern:**

Both backend and frontend import from shared using relative paths:

```typescript
// In src/backend/whale-detection.observer.ts
import type { IWhaleTransaction, IWhaleConfig } from '../shared/types';

// In src/frontend/WhaleDashboard.tsx
import type { IWhaleTransaction, IWhaleConfig } from '../shared/types';
```

**Benefits:**

- **Encapsulation** – Plugin types stay inside the plugin workspace instead of polluting global packages
- **DRY principle** – One definition eliminates the drift caused by copy-paste type duplication
- **Portability** – Plugins remain self-contained; extracting a feature to a separate project requires no type reorganization
- **Clear ownership** – The plugin team owns both the interface and its implementation without coordinating cross-workspace changes
- **Simple builds** – No cross-workspace TypeScript project references needed; relative imports work immediately

#### Scaffold Templates

Cutting a new plugin should feel mechanical. Copy these baseline files, replace `example-alerts` with your plugin id, and adjust metadata so the loaders can reason about the new package without guesswork.

Reference the living templates instead of copying long snippets into this guide:

- `packages/plugins/example-alerts/package.json` – Workspace metadata, exports, and build scripts that every plugin needs.
- `packages/plugins/example-alerts/tsconfig.json` – Backend-focused TypeScript configuration that omits React files.
- `packages/plugins/example-alerts/src/manifest.ts` – Canonical manifest establishing id, version, and surface flags.
- `packages/plugins/example-alerts/src/backend/backend.ts` – Minimal backend entry showing lifecycle hooks and dependency injection.
- `packages/plugins/example-alerts/src/frontend/` – Frontend bootstrap (`frontend.ts`), scoped CSS, and example page/components.

Copy the directory with `cp -R packages/plugins/example-alerts packages/plugins/<new-id>` and update the manifest fields, workspace name, and any scaffolded components before implementing feature-specific logic. Each file is documented inline so new authors can see the “why” next to the code they are editing.

**Important**: Frontend plugin components and pages receive `IFrontendPluginContext` as a prop. This provides access to:
- `context.ui` - UI components (Card, Badge, Skeleton, Button, Input)
- `context.charts` - Chart components (LineChart, etc.)
- `context.api` - Pre-configured API client for HTTP requests
- `context.websocket` - WebSocket client for real-time events

Do **not** import from `apps/frontend` directly - use the injected context instead. See [Plugin Frontend Context](./plugins-frontend-context.md) for complete examples.

### Plugin CSS Styling

Keep plugin styling local and scoped using CSS Modules:

**Recommended approach: CSS Modules**
- Create `ComponentName.module.css` files colocated with plugin components
- Import with `import styles from './ComponentName.module.css'`
- CSS Modules automatically scope class names to prevent conflicts with core app or other plugins
- Use container queries in CSS Modules for component-level responsiveness

**Example structure:**
```
packages/plugins/my-plugin/
└── src/
    └── frontend/
        ├── frontend.ts
        ├── MyPluginPage.tsx
        ├── MyPluginPage.module.css
        ├── components/
        │   ├── PluginCard.tsx
        │   └── PluginCard.module.css
```

**Usage pattern:**
```typescript
// MyPluginPage.tsx
import styles from './MyPluginPage.module.css';

export function MyPluginPage({ context }: { context: IFrontendPluginContext }) {
    return (
        <div className={`surface ${styles.container}`}>
            <div className={styles.grid}>
                <div className={styles.item}>Content</div>
            </div>
        </div>
    );
}
```

```css
/* MyPluginPage.module.css */
.container {
    container-type: inline-size;
}

.grid {
    display: grid;
    gap: 1.5rem;
}

@container (min-width: 600px) {
    .grid {
        grid-template-columns: repeat(2, 1fr);
    }
}
```

**Key principles:**
- Always reference CSS variables from `apps/frontend/app/globals.css` (e.g., `var(--color-primary)`, `var(--radius-md)`)
- Combine CSS Modules with utility classes (`.surface`, `.btn`, `.badge`) for consistency
- Use container queries instead of viewport media queries for plugin responsiveness

For complete CSS architecture guidance, see [Frontend Component Guide](../frontend/ui/ui-component-styling.md) and [Plugin Frontend Context](./plugins-frontend-context.md).

### Build outputs

Running `npm run build` inside a plugin executes `tsc -p tsconfig.json`, producing the backend bundle plus a compiled manifest. The shared `packages/plugins/build-frontends.mjs` script runs from the monorepo root and emits `dist/frontend.bundle.js` for every plugin whose manifest sets `frontend: true`. Both artifacts must exist before the backend loader will initialize the plugin in production builds.

## Quick Checklist / Reference

- Copy `packages/plugins/example-alerts` to `packages/plugins/<new-id>` so backend and frontend scaffolding stay aligned.
- Update the manifest id, title, version, and the workspace name in `package.json` before wiring feature code.
- Run `npm install` at the repo root to link the new workspace, then `npm run build --workspace packages/plugins/<new-id>` to emit `dist/`.
- Regenerate the frontend registry with `npm run generate:plugins --workspace apps/frontend` and rebuild plugin bundles via `npm run build:plugin-frontends`.
- Verify `/api/plugins/manifests` lists the plugin, then install and enable it through `/system/plugins` to execute lifecycle hooks.

See [Adding or updating a plugin](#adding-or-updating-a-plugin) for the full walkthrough with context and troubleshooting tips.

## Related Documentation

- **[Plugin Frontend Context](./plugins-frontend-context.md)** - UI dependency injection, CSS guidance, and context usage patterns.
- **[Plugin Database Access](./plugins-database.md)** - Namespaced storage helpers and lifecycle considerations.
- **[Plugin Page Registration](./plugins-page-registration.md)** - Navigation and routing contracts for frontend surfaces.
- **[Plugin Blockchain Observer Pattern](./plugins-blockchain-observers.md)** - Observer lifecycle and transaction handling patterns.
- **[Plugin API Registration](./plugins-api-registration.md)** - REST route wiring, middleware patterns, and handler contracts.
- **[Plugin WebSocket Subscriptions](./plugins-websocket-subscriptions.md)** - Namespaced subscription management for real-time features.

## Manifest contract

The manifest is the single source of truth for plugin identity and surface availability. We keep it in TypeScript so both runtimes share one definition via the `PluginManifest` interface from `@tronrelic/types`.

Why it matters:

- The backend loader trusts the compiled manifest in `dist/manifest.js` to decide whether the plugin exposes backend code.
- The frontend fetches those same manifests over HTTP and will only attempt to load plugins that explicitly mark `frontend: true`.
- Any metadata we expose in the manifest becomes part of the API response returned by `/api/plugins/manifests`, keeping UI and backend aligned without separate config files.

How we use it:

1. Author `src/manifest.ts` in plain TypeScript and export a `PluginManifest` constant.
2. Reference that manifest from both backend and frontend entry points via `definePlugin`.
3. Build the plugin so `tsc` emits `dist/manifest.js`, which becomes the runtime artifact for both loaders.

## Backend runtime flow

Backend plugins are loaded during API bootstrap (`apps/backend/src/index.ts`). The flow has two phases:

### Discovery Phase
1. `loadPlugins` (in `apps/backend/src/loaders/plugins.ts`) walks `packages/plugins`, skipping hidden folders, `dist`, and anything without build artifacts.
2. For each candidate it imports `dist/manifest.js` and validates the shape. Missing manifests are logged and skipped.
3. If the manifest advertises `backend: true`, the loader imports `dist/backend/backend.js` and searches for an exported plugin object (anything with a `manifest` field).
4. Each discovered plugin is registered in the `plugin_metadata` MongoDB collection with default state: `installed: false`, `enabled: false`. Existing plugins have their title and version updated.
5. A plugin-scoped database service is created using the plugin's ID for namespace isolation.
6. A shared `IPluginContext` is assembled with `ObserverRegistry.getInstance()`, `WebSocketService.getInstance()`, the `BaseObserver` class, the scoped database service, and a plugin-scoped child logger.
7. The plugin and its context are registered with `PluginManagerService` for dynamic lifecycle management.

### Initialization Phase (Installed + Enabled Plugins Only)
1. The loader queries the database for plugins where `installed: true AND enabled: true`.
2. For each active plugin:
   - If not yet installed, call `plugin.install(context)` inside a try/catch and mark as installed.
   - Call `plugin.enable(context)` inside a try/catch (if present).
   - Call `plugin.init(context)` inside a try/catch (if present), logging any failure alongside the plugin id.
   - Register the plugin's API routes with `PluginApiService`.
3. Plugins that are discovered but not installed/enabled are tracked but not initialized.

### Dependency injection context

Plugins never reach into `apps/backend/src` directly. Instead they rely on the injected context:

- `observerRegistry` lets a plugin subscribe to TRON transaction types and receive enriched transactions (typed as `ITransaction` from `@tronrelic/types`).
- `websocketService` exposes `emit` and `emitToWallet` so plugins can broadcast real-time events.
- `BaseObserver` gives plugins the queueing, back-pressure, and telemetry scaffolding used throughout the blockchain pipeline (injected as a constructor, not imported directly).
- `database` provides scoped MongoDB access with automatic collection prefixing for data persistence (see [Plugin Database Access](./plugins-database.md)).
- `logger` delivers a plugin-scoped child logger so every log line includes plugin metadata without manual bindings (see [system-logging.md](../system/system-logging.md) for logging best practices).

This contract keeps plugins decoupled from implementation details while still giving them powerful capabilities.

### Backend implementation pattern

Every backend plugin should follow the same structural playbook:

- Defer heavy logic to dedicated modules under `src/backend/**` and keep the entry file focused on configuration.
- Instantiate observers during `init` by passing the injected `BaseObserver`, `observerRegistry`, and `websocketService` into the feature-specific factory functions you define.
- Subscribe to the transaction types your feature cares about inside those observers, ensuring subscriptions stay encapsulated within the plugin rather than leaking into the blockchain service.
- Emit runtime events exclusively through the injected services so routing, logging, and error handling remain consistent with the rest of the platform.

### Example: Hello World observer

The simplest useful backend plugin wires one observer into the transaction stream. This example pairs the blockchain observer pattern with the plugin context so you can see the entire flow end-to-end.

`packages/plugins/example-alerts/src/backend/hello-world.observer.ts`

```typescript
import type {
    ITransaction,
    IBaseObserver,
    IObserverRegistry,
    IWebSocketService,
    ISystemLogService
} from "@tronrelic/types";

/**
 * Factory that wires a hello-world observer into the registry.
 *
 * The constructor signature mirrors what the backend injects so you can see
 * the dependency flow. It exists to make the observer lifecycle concrete for
 * new plugin authors.
 *
 * @param BaseObserver - Base observer class providing queue management and error isolation, needed to extend functionality for hello world example
 * @param observerRegistry - Registry for subscribing to specific transaction types, allows this observer to receive relevant blockchain events
 * @param websocketService - Service for emitting real-time events to connected clients, enables instant notifications
 * @param logger - Structured logger scoped to the plugin so observer logs inherit plugin metadata
 * @returns Instantiated hello world observer ready to process transactions
 */
export function createHelloWorldObserver(
    BaseObserver: abstract new (logger: ISystemLogService) => IBaseObserver,
    observerRegistry: IObserverRegistry,
    websocketService: IWebSocketService,
    logger: ISystemLogService
): IBaseObserver {
    const scopedLogger = logger.child({ observer: "HelloWorldObserver" });

    /**
     * Internal observer used only inside the plugin.
     *
     * The class extends the injected BaseObserver so it inherits queueing,
     * back-pressure, and telemetry. WebSocket service is captured from the
     * factory closure for use in processing.
     */
    class HelloWorldObserver extends BaseObserver {
        protected readonly name = "HelloWorldObserver";
        private readonly websocketService: IWebSocketService;

        constructor() {
            super(scopedLogger);
            this.websocketService = websocketService;

            // Subscribe to transaction types we care about
            observerRegistry.subscribeTransactionType("TransferContract", this);
        }

        protected async process(transaction: ITransaction): Promise<void> {
            const txId = transaction?.payload?.txId ?? "unknown";
            this.websocketService.emit({
                event: "transaction:hello-world",
                payload: { txId }
            });
        }
    }

    return new HelloWorldObserver();
}
```

Replace the placeholder `init` from the scaffolded backend entry with logic that instantiates the observer factory:

`packages/plugins/example-alerts/src/backend/backend.ts`

```typescript
import { definePlugin, type IPluginContext } from "@tronrelic/types";
import { exampleAlertsManifest } from "../manifest";
import { createHelloWorldObserver } from "./hello-world.observer";

/** Activates the Hello World observer. The init hook proves how to use dependency injection, subscribe to a transaction type, and stay decoupled from backend internals. */
export const exampleAlertsBackendPlugin = definePlugin({
    manifest: exampleAlertsManifest,
    init: async ({ BaseObserver, observerRegistry, websocketService, logger }: IPluginContext) => {
        const observerLogger = logger.child({ feature: "example-alerts" });
        createHelloWorldObserver(BaseObserver, observerRegistry, websocketService, observerLogger);
    }
});
```

Why it works:

- The manifest advertises `backend: true`, so the loader imports this module and calls `init`.
- The observer extends the injected `BaseObserver`, gaining queueing, telemetry, and safety semantics for free.
- `observerRegistry.subscribeTransactionType` connects the observer to enriched `ITransaction` objects without touching the blockchain service.
- Emitting through `websocketService` keeps real-time updates aligned with the rest of the platform, but you can swap the callback for database writes or analytics events just as easily.
- The scoped `logger.child` call ensures every log emitted by the observer carries plugin metadata, making production telemetry searchable.
- Subscription happens in the constructor, ensuring the observer is wired into the registry as soon as it's instantiated.

## Frontend runtime flow

Frontend plugins follow TronRelic's foundational SSR + Live Updates pattern: components render fully on the server with real data (no loading flash), then hydrate for interactivity and WebSocket subscriptions.

**See [react.md](../frontend/react/react.md#ssr--live-updates-pattern) for the complete SSR + Live Updates implementation guide.**

### Build-time Discovery

1. `apps/frontend/scripts/generate-frontend-plugin-registry.mjs` runs before `next dev` or `next build`. It scans `packages/plugins/**/src/frontend/` directories for plugin components.
2. The generator creates registry files with static imports, enabling components to be available during server-side rendering.
3. Static imports (not lazy/dynamic) are required for SSR—lazy-loaded components aren't available when the server renders HTML.

### SSR + Hydration Flow

1. During SSR, the server renders plugin components with pre-fetched data. The complete HTML is sent to the browser.
2. React hydrates the server-rendered HTML, making components interactive.
3. After hydration, components can subscribe to WebSocket events for live data updates.
4. State changes from WebSocket events trigger normal React re-renders.

### Side-Effect Components

Some plugin components exist purely for side effects (WebSocket listeners, toast handlers) rather than visible UI:

1. `PluginLoader` (rendered from `apps/frontend/app/providers.tsx`) mounts on every page.
2. On mount it fetches `/api/plugins/manifests`, filters for `manifest.frontend === true`, then resolves each plugin.
3. Each frontend plugin export is expected to include the same manifest plus a React `component`. The loader renders those components invisibly so they can perform side effects such as listening to WebSockets or registering toasts.

**Key principle:** All visible plugin UI must follow the [SSR + Live Updates pattern](../frontend/react/react.md#ssr--live-updates-pattern) for instant display. Side-effect-only components run after hydration.

### Frontend implementation pattern

Frontend plugins should mirror the same discipline:

- Export a `definePlugin` object from `src/frontend/frontend.ts` that reuses the shared manifest and exposes a React component for side effects or UI.
- Keep the rendered component small and focused—attach socket listeners, manage local state, or render feature-specific UI without assuming the host application will wire anything manually. Avoid dependencies on the main app's Redux store to maintain plugin isolation.
- Register and clean up all listeners inside React effects so fast-refresh and route changes do not leak handlers or duplicate subscriptions.
- Guard against hydration timing issues by checking for client-side initialization before processing events or showing UI.

## Build and release flow

Keeping plugin builds deterministic is essential because the backend trusts artifacts from `dist/` while the frontend imports source files.

1. `scripts/start.sh` orchestrates incremental builds. When it detects changes under a plugin workspace (for example `packages/plugins/whale-alerts`), it runs `npm run build` inside that directory before launching the backend.
2. The backend build (`npm run build --workspace apps/backend`) depends on the plugin having populated `dist/backend`. If the folder is missing, the loader will log a warning and skip initialization.
3. Root-level `npm run build` runs `npm run build:plugin-frontends`, which calls `packages/plugins/build-frontends.mjs`. That script bundles each plugin's frontend entry into `dist/frontend.bundle.js` using esbuild so we have a portable artifact for CDNs or documentation demos.
4. The frontend build triggers `npm run prebuild --workspace apps/frontend`, regenerating the plugin registry to pick up any new plugin ids before Next compiles the app.
5. During production deployments we rely on these generated files (`dist/**`, `plugins.generated.ts`) already existing so both runtimes agree on which plugins shipped.

## Adding or updating a plugin

Follow this flow to keep new plugins consistent with the existing implementation:

1. Scaffold `packages/plugins/<new-id>/` by copying the templates above. Update the workspace name to `@tronrelic/plugin-<new-id>` so npm workspaces and importers resolve it automatically.
2. Run `npm install` from the repo root so the new workspace is linked and type-checking tools can find it. If the frontend or backend should consume the plugin directly, add the workspace dependency in their respective `package.json` files.
3. Define the manifest in `src/manifest.ts` with accurate `backend`/`frontend` booleans, semantic version, and clear description so `/api/plugins/manifests` stays truthful.
4. Implement `src/backend/backend.ts` so it exports `definePlugin({ manifest, init })` and instantiates observers or services using only the injected `IPluginContext`.
5. Build supporting backend modules under `src/backend/**`, extending `BaseObserver` for anything that reacts to blockchain transactions to stay compatible with the observer registry.
6. If the plugin has UI, create `src/frontend/frontend.ts` with `definePlugin({ manifest, component })`. Keep the component focused on side-effects and colocate any shared UI under `src/frontend/`.
7. Run `npm run build --workspace packages/plugins/<new-id>` to emit `dist/` and confirm both `dist/manifest.js` and `dist/backend/backend.js` exist. Missing artifacts cause the backend loader to skip the plugin.
8. Execute `npm run generate:plugins --workspace apps/frontend` so the lazy loader discovers the new frontend entry, then run `npm run build:plugin-frontends` (or `./scripts/start.sh --force-build`) to produce `dist/frontend.bundle.js` for production builds.
9. Verify the plugin appears in `/api/plugins/manifests`, check the backend logs for initialization success, and load the frontend to confirm the component mounts without console warnings.

## Managing plugins via admin interface

The `/system/plugins` admin page provides a web interface for managing plugin lifecycle without editing code or restarting services.

### Accessing the admin interface

1. Navigate to `http://localhost:3000/system/plugins` (or your production domain).
2. Enter your `ADMIN_TOKEN` from the backend `.env` file.
3. The dashboard displays all discovered plugins with their installation and enabled status.

### Plugin operations

**Install**: Runs the plugin's `install()` hook and marks it as installed in the database. The plugin remains disabled until explicitly enabled.

**Uninstall**: Runs the plugin's `uninstall()` hook and always marks it as uninstalled (even if the hook fails). Automatically disables the plugin if currently enabled.

**Enable**: Runs the plugin's `enable()` and `init()` hooks, registers API routes, and marks it as enabled. Requires the plugin to be installed first.

**Disable**: Runs the plugin's `disable()` hook, unregisters API routes, and marks it as disabled. The plugin remains installed.

### State rules

- A plugin must be **installed** before it can be enabled.
- Only plugins that are both **installed AND enabled** will have their components loaded and running.
- Uninstalling automatically disables the plugin.
- Database state persists across application restarts.
- The frontend only loads plugins that are installed + enabled (via `/api/plugins/manifests`).

### Error handling

- Lifecycle hook errors are captured and displayed in the admin UI.
- Installation failures leave the plugin in the `installed: false` state.
- Uninstall failures still mark the plugin as uninstalled (the hook is best-effort cleanup).
- Errors are logged with timestamps for debugging.

### API endpoints

The management system exposes REST endpoints for programmatic control:

- `GET /api/plugin-management/all` - List all plugins with metadata
- `POST /api/plugin-management/:pluginId/install` - Install a plugin
- `POST /api/plugin-management/:pluginId/uninstall` - Uninstall a plugin
- `POST /api/plugin-management/:pluginId/enable` - Enable a plugin
- `POST /api/plugin-management/:pluginId/disable` - Disable a plugin

All management endpoints require admin authentication (to be implemented).

## Plugin Admin Systems

Plugins often need secure settings screens without touching core admin code. Giving each feature a self-contained admin surface keeps configuration isolated, enforces consistent auth, and makes it obvious where future contributors should look when something breaks.

### Why plugin admin systems exist

- **Purpose-built configuration** – Each plugin owns its own settings UI and storage, so toggling features never requires editing shared dashboards.
- **Predictable routing** – Everything lives under `/system/plugins/{plugin-id}` and `/api/plugins/{plugin-id}/system/**`, which keeps links and permissions consistent.
- **Centralised auth** – All admin routes pass through the shared `requireAdmin` middleware so we only maintain one token gate.

### Implementation snapshot

1. **Manifest** – Set `adminUrl` so the platform can surface a "Settings" button in `/system/plugins`.
2. **Backend** – Populate the plugin’s `adminRoutes` array; `PluginApiService` mounts them under `/api/plugins/{plugin-id}/system/**` and applies admin auth automatically.
3. **Frontend** – Register React components in `adminPages`; the dynamic catch-all route loads them with the injected `IFrontendPluginContext`.
4. **Management UI** – Once a plugin is installed and enabled, the system plugins page links directly to the manifest’s `adminUrl`, and the admin token stored in `localStorage` keeps requests authenticated.

### Where to dive deeper

- **Step-by-step UI wiring:** See [Plugin Menu and Page System → Plugin Admin Pages](./plugins-page-registration.md#plugin-admin-pages) for the full walkthrough that covers navigation registration, page components, and styling conventions.
- **Route contracts:** Review [Plugin API Registration](./plugins-api-registration.md) for details on `adminRoutes`, middleware, and HTTP handler structure.
- **Working example:** The whale-alerts plugin (`packages/plugins/whale-alerts/`) shows the manifest, backend admin routes, and frontend admin pages working together.

## Operational guardrails

- Always keep the manifest booleans honest. A missing `frontend: true` means the UI will never load the plugin, even if the component exists.
- Do not import backend singletons directly from a plugin; rely on the injected `IPluginContext` to avoid circular dependencies.
- Treat the `dist/` folder as an artifact. Delete it only through scripted clean builds so the backend never boots with stale or missing plugins.
- When adjusting socket events, confirm `apps/backend/src/services/websocket.service.ts` knows how to route the new event type before emitting it.
- Run `npm run generate:plugins --workspace apps/frontend` after adding or renaming frontend entry files so the registry stays in sync.
- **New plugins start disabled by default**. After building a new plugin, use the admin interface to install and enable it.

## Reference modules

### Plugin examples
- `packages/plugins/whale-alerts/src/manifest.ts` – canonical manifest example.
- `packages/plugins/whale-alerts/src/backend/backend.ts` – backend entry with enable/disable lifecycle hooks.
- `packages/plugins/whale-alerts/src/backend/whale-detection.observer.ts` – observer implementation using the injected context.
- `packages/plugins/whale-alerts/src/frontend/frontend.ts` – frontend entry exporting the plugin definition.
- `packages/plugins/whale-alerts/src/frontend/WhaleAlertsToastHandler.tsx` – example frontend side-effects component that manages socket listeners and displays toast notifications.

### Core infrastructure
- `apps/backend/src/loaders/plugins.ts` – runtime discovery and initialization for backend plugins with database state management.
- `apps/backend/src/services/plugin-metadata.service.ts` – service for managing plugin metadata in MongoDB.
- `apps/backend/src/services/plugin-manager.service.ts` – service for hot reload and dynamic lifecycle management.
- `apps/backend/src/services/plugin-api.service.ts` – service for registering and unregistering plugin API routes.
- `apps/backend/src/database/models/PluginMetadata.ts` – MongoDB model for plugin state persistence.
- `apps/backend/src/api/routes/plugin-management.routes.ts` – REST endpoints for plugin management operations.
- `apps/backend/src/api/routes/plugins.routes.ts` – HTTP endpoint that surfaces active plugin manifests to the frontend.

### Frontend infrastructure
- `apps/frontend/app/(dashboard)/system/plugins/page.tsx` – admin UI for plugin management.
- `apps/frontend/scripts/generate-frontend-plugin-registry.mjs` – generator that keeps the lazy import map in sync with the filesystem.
- `apps/frontend/components/plugins/PluginLoader.tsx` – React component that fetches manifests and mounts frontend plugins.

### Type definitions
- `packages/types/src/plugin/IPlugin.ts` – plugin interface with lifecycle hooks.
- `packages/types/src/plugin/IPluginMetadata.ts` – plugin metadata and management types.
- `packages/types/src/plugin/IPluginManifest.ts` – manifest interface.
- `packages/types/src/plugin/definePlugin.ts` – helper for defining plugins.

### Build tools
- `packages/plugins/build-frontends.mjs` – esbuild task that emits `dist/frontend.bundle.js` for every frontend-enabled plugin.
