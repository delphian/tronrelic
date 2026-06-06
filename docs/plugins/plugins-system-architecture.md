# Plugin System Architecture

Package layout, manifest contract, runtime flow, build modes, and the new-plugin walkthrough. For lifecycle states and extension surfaces overview, see [plugins.md](./plugins.md).

## Why This Matters

Plugins ship backend and frontend from one workspace and load through generated static-import registries. Skipping the conventions below produces broken SSR (lazy imports lose the server render), build drift (registries out of sync with `package.json` exports), or hidden duplicate React instances (externals not hoisted). Each rule traces to a real failure mode.

## Plugin Package Layout

Every plugin lives at `src/plugins/trp-<plugin-id>/`, colocating backend and frontend because a feature almost always spans both runtimes. Naming is three-layered: the repo and directory carry a `trp-` prefix (`trp-memo-tracker`), the manifest `id` drops it (`memo-tracker`), and the workspace name is `@tronrelic/plugin-<plugin-id>`. The manifest `id` is authoritative — the registry generators read it from `src/manifest.ts` (falling back to the `package.json` name suffix), never from the directory name — and it drives all runtime surfaces: the `plugin_<plugin-id>_` collection prefix, `/api/plugins/<plugin-id>/` routes, and `/system/plugins/<plugin-id>` admin pages.

### Directory Essentials

- `package.json` — workspace package; `exports` map points backend at `dist/backend/backend.js` and frontend at `dist/frontend/frontend.js` (compiled mode) or `src/frontend/frontend.ts` (legacy source mode, being migrated). See [Frontend Build Modes](#frontend-build-modes).
- `tsconfig.json` — backend TypeScript, excludes `src/frontend/**`.
- `tsconfig.frontend.json` — standalone frontend config (must NOT extend backend config; see [Frontend Build Modes](#frontend-build-modes)).
- `src/manifest.ts` — metadata shared by both runtimes; sets `backend: true` and/or `frontend: true`.
- `src/backend/backend.ts` — exports `definePlugin({ manifest, init })`.
- `src/backend/*.ts` — observers, services, routes.
- `src/frontend/frontend.ts` — exports `definePlugin({ manifest, component, ... })` and imports plugin CSS.
- `src/frontend/*.tsx` — React components.
- `src/frontend/public/` (optional) — plugin-owned static assets needing stable, unfingerprinted URLs (OG images, manifest icons, favicons). Mirrored to `src/frontend/public/plugins/<plugin-id>/` by the registry generator before `next build`; served at `/plugins/<plugin-id>/<file>`. See [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md#plugin-owned-og-images). Distinct from `src/frontend/assets/`, which webpack hashes.
- `src/shared/` (optional) — types, constants, utilities shared between backend and frontend.
- `dist/` — compiled artifacts: `manifest.js`, `manifest.d.ts`, `backend/backend.js`, `frontend/*.js` plus mirrored SCSS.

### Shared Code: `src/shared/` vs `@/types`

Use `src/shared/` for plugin-specific data models, config interfaces, WebSocket payload types, and constants used in both `src/backend/` and `src/frontend/`. Both sides import via simple relative paths (`../shared/types`) — no project references needed.

Use `@/types` for framework contracts (`IPluginContext`, `IPluginManifest`), core blockchain primitives (`ITransaction`, `IBlock`), and platform-wide interfaces consumed across plugins.

## Frontend Build Modes

Plugins are migrating from **source mode** (raw TSX imported into core's webpack via `transpilePackages`) to **compiled mode** (plugin emits its own `dist/frontend/`, core imports the artifact). Both coexist so plugins migrate one at a time. Reference implementation: `src/plugins/trp-ai-assistant/`.

### Why compiled mode

Source mode couples every plugin to core's webpack and blocks per-plugin build isolation. Compiled mode makes each plugin standalone-buildable and is prerequisite to runtime-loadable plugins. Core still owns externals and SCSS even in compiled mode — see below.

### How core selects the mode

`scripts/generate-frontend-plugin-registry.mjs` reads each plugin's `package.json` `exports` map. When `exports."./frontend"` points at `.js`/`.mjs`/`.cjs`, the generator emits a static import at that path and `next.config.mjs` omits the plugin from `transpilePackages`. When the entry still points at `.ts`, core falls back to transpiling the source.

### Frontend export contract

Every plugin's frontend entry — compiled or raw — must expose an IPlugin-shaped value (an object whose `manifest` has non-empty string `id` and `title`) under any named export. **`export default` is permitted but not required.** The generator imports every plugin under a namespace binding (`import * as foo_module from '...'`); the runtime discovers the IPlugin via `Object.values(foo_module).find(isIPluginShape)`. Plugins whose module exposes no IPlugin-shaped value are dropped with a logged error and surfaced via `failedPluginLoads` — the rest of the registry loads normally.

The widget registry follows the same defense-in-depth pattern: each plugin's `widgets/index.ts` is imported as a namespace and merged via `safeMergeWidgets`, which refuses missing or non-object `widgetComponents` exports instead of crashing the spread at module load.

This contract supersedes the prior default-import path for compiled-mode plugins, which silently produced `undefined` whenever a plugin shipped only a named export and crashed SSR for every route at the first `.menuItems` access. The `.d.ts` sidecar core generates next to each compiled artifact remains as a TS-resolution affordance; its declared shape does not constrain the plugin's public API.

### What core still owns in compiled mode

Externals (`react`, `next/*`, `lucide-react`, `@delphian/tronrelic-types`, etc.) resolve through core's hoisted `node_modules` so there is one React instance at runtime. SCSS Modules are still compiled by core's webpack via the `/src/plugins/` include extension in `next.config.mjs:113-151` — only the TypeScript compile moves into the plugin. SCSS edits in `src/frontend/**/*.scss` propagate automatically through `next dev` because core reads from source; the `copy-frontend-assets.mjs` step mirrors them into `dist/frontend/` only when `npm run build:frontend` runs, so production consumers of `dist/` see stale SCSS until then. A new plugin version still requires rebuilding the core Docker image because `plugins.generated.ts` imports the entry statically at `next build` time.

### Required compiled-mode files

1. `tsconfig.frontend.json` — **standalone (no `extends`)**, includes `src/frontend/**/*`, `src/shared/**/*`, `src/manifest.ts`, `src/global.d.ts`. Set `rootDir: ./src`, `outDir: ./dist`, `moduleResolution: Bundler`, `declaration: false`. Extending the backend config inherits `declarationDir` and triggers TS5069 once declarations are disabled — keep them independent.
2. `src/global.d.ts` — ambient `*.module.scss` and `*.module.css` declarations (two-line module declaration; copy from any plugin already shipping one).
3. `scripts/copy-frontend-assets.mjs` — mirrors `*.scss` and `*.css` from `src/frontend/` into `dist/frontend/` after tsc emits. Compiled JS references these via relative imports, so they must exist alongside the JS.
4. `package.json` `build:frontend` script: `tsc -p tsconfig.frontend.json && node scripts/copy-frontend-assets.mjs`. Default `build` script must chain it (`tsc && npm run build:frontend`); the backend `tsconfig.json` excludes `src/frontend/**`, so `npm run build` alone will not emit the artifact `exports."./frontend".import` points at.
5. `exports."./frontend".import` set to `./dist/frontend/frontend.js`. If the plugin ships widgets, also set `exports."./frontend/widgets"` to `./dist/frontend/widgets/index.js`.

Run `npm run build` inside the plugin before `npm run generate:plugins` at the repo root so the generator finds the compiled artifact.

## Manifest Contract

The manifest is the single source of truth for plugin identity and surface availability — kept in TypeScript so both runtimes share one definition via `IPluginManifest` from `@/types`.

The backend loader trusts the compiled `dist/manifest.js` to decide whether the plugin exposes backend code. The frontend fetches manifests over HTTP and only loads plugins where `frontend: true`. Anything in the manifest becomes part of `/api/plugins/manifests`, keeping UI and backend aligned without separate config files.

Author `src/manifest.ts` exporting an `IPluginManifest` constant. Reference it from both backend and frontend entry points via `definePlugin`. `tsc` emits `dist/manifest.js` as the runtime artifact for both loaders.

## Backend Runtime Flow

Loaded during API bootstrap (`src/backend/src/index.ts`) in two phases.

### Discovery Phase

`scripts/generate-backend-plugin-registry.mjs` runs at dev startup, scanning `src/plugins/` for directories with `src/backend/backend.ts` or `src/manifest.ts`, and produces `src/backend/loaders/plugins.generated.ts` with static imports.

1. `loadPlugins` (in `src/backend/src/loaders/plugins.ts`) imports the generated registry.
2. Each discovered plugin is registered in the `plugin_metadata` MongoDB collection with default state `installed: false, enabled: false`. Existing plugins have title and version refreshed.
3. A plugin-scoped `IDatabaseService` is created using the plugin id for namespace isolation.
4. An `IPluginContext` is assembled with `ObserverRegistry.getInstance()`, `WebSocketService.getInstance()`, the service registry (`context.services`), the `BaseObserver` class, the scoped database service, and a plugin-scoped child logger.
5. The plugin and its context are registered with `PluginManagerService` for dynamic lifecycle.

### Initialization Phase (Installed AND Enabled Only)

1. The loader queries for plugins where `installed: true AND enabled: true`.
2. For each active plugin: `install(context)` (if not yet installed) → `enable(context)` → `init(context)`, each in try/catch with plugin-id-tagged error logging.
3. API routes register with `PluginApiService`.

### Injected Context

Plugins never reach into `src/backend/src` directly. They consume the injected context:

- `observerRegistry` — subscribe to TRON transaction types, receive enriched `ITransaction`.
- `websocketService` — `emit` and `emitToWallet` for real-time events.
- `BaseObserver` — class injected as a constructor argument (do not import). Provides queueing, back-pressure, telemetry.
- `database` — scoped MongoDB access with auto-prefix (`plugin_<id>_*`). See [system-database.md](../system/system-database.md#plugins).
- `logger` — plugin-scoped child logger; every log line carries plugin metadata.

Account, wallet, and group data are not on the context — reach them through the published service registry (`services.get('accounts')` / `'wallets'` / `'user-groups'`). See the [Identity Module README](../../src/backend/modules/identity/README.md#published-service-contracts).

### Backend Implementation Pattern

Defer heavy logic to modules under `src/backend/**`; keep the entry file focused on wiring. Instantiate observers in `init` by passing injected dependencies into factory functions. Subscribe to transaction types inside the observer constructor so wiring happens at instantiation. Emit events only through injected services.

```typescript
// src/plugins/trp-<id>/src/backend/hello-world.observer.ts
export function createHelloWorldObserver(
    BaseObserver: abstract new (logger: ISystemLogService) => IBaseObserver,
    observerRegistry: IObserverRegistry,
    websocketService: IWebSocketService,
    logger: ISystemLogService
): IBaseObserver {
    class HelloWorldObserver extends BaseObserver {
        protected readonly name = "HelloWorldObserver";
        constructor() {
            super(logger.child({ observer: "HelloWorldObserver" }));
            observerRegistry.subscribeTransactionType("TransferContract", this);
        }
        protected async process(tx: ITransaction): Promise<void> {
            websocketService.emit({ event: "transaction:hello-world", payload: { txId: tx?.payload?.txId } });
        }
    }
    return new HelloWorldObserver();
}

// src/plugins/trp-<id>/src/backend/backend.ts
export const helloWorldBackendPlugin = definePlugin({
    manifest: helloWorldManifest,
    init: async ({ BaseObserver, observerRegistry, websocketService, logger }: IPluginContext) => {
        createHelloWorldObserver(BaseObserver, observerRegistry, websocketService, logger.child({ feature: "hello-world" }));
    }
});
```

## Frontend Runtime Flow

Plugin UI follows the [SSR + Live Updates pattern](../frontend/react/react.md#ssr--live-updates-pattern): server renders fully, client hydrates and subscribes.

### Build-Time Discovery

`scripts/generate-frontend-plugin-registry.mjs` runs before `next dev` and `next build`, scanning `src/plugins/**/src/frontend/`. It emits **static** imports into `src/frontend/components/plugins/plugins.generated.ts` and `src/frontend/components/widgets/widgets.generated.ts`, then mirrors `src/frontend/public/` assets into `src/frontend/public/plugins/<plugin-id>/`. Lazy/dynamic imports break SSR — components must be available when the server renders HTML.

### Side-Effect Components

`PluginLoader` (rendered from `src/frontend/app/providers.tsx`) mounts on every page, fetches `/api/plugins/manifests`, filters for `frontend: true`, and renders each plugin's exported `component` invisibly so it can attach WebSocket listeners or register toasts. Visible plugin UI uses page registration or widget zones, not the side-effect component slot.

### Frontend Implementation Pattern

Export `definePlugin({ manifest, component, ... })` from `src/frontend/frontend.ts` reusing the shared manifest. Keep the side-effect component small. Register and clean up listeners inside `useEffect` so fast-refresh and route changes do not leak handlers. Receive `IFrontendPluginContext` as a prop — never import from `apps/frontend`. See [plugins-frontend-context.md](./plugins-frontend-context.md).

## Build and Release Flow

### Development

`npm run dev` runs both registry generators, then starts Next.js. For source-mode plugins, tsx and Next.js compile TSX on-the-fly via `transpilePackages`. For compiled-mode plugins, run `npm run build:frontend` inside the plugin first — core does not transpile compiled-mode source. Restart `npm run dev` after adding a new plugin so registries regenerate.

### Production

Root-level `npm run build`: each plugin's `tsc -p tsconfig.json` compiles backend to `dist/backend/`; each plugin's `npm run build:frontend` compiles frontend to `dist/frontend/`; registries regenerate; Docker images bundle the pre-compiled artifacts so `next build` resolves to compiled outputs.

## Adding or Updating a Plugin

`trp-ai-assistant/` is the canonical reference — exercises lifecycle hooks, scheduler jobs, service registry publication, admin routes, and SSR-first pages.

> **Prerequisite:** `src/plugins/trp-ai-assistant/` is not present on a fresh clone. Populate via `./scripts/setup.sh` with `trp-ai-assistant` enabled in `plugins.json` first.

1. `cp -R src/plugins/trp-ai-assistant src/plugins/trp-<new-id>`. Update workspace name to `@tronrelic/plugin-<new-id>` so npm workspaces resolve it.
2. `npm install` from repo root to link the workspace.
3. Update `src/manifest.ts`: id, title, version, accurate `backend`/`frontend` booleans, description (becomes part of `/api/plugins/manifests`).
4. Implement `src/backend/backend.ts` exporting `definePlugin({ manifest, init })` using only the injected `IPluginContext`.
5. Build supporting modules under `src/backend/**`. Anything reacting to blockchain transactions extends the injected `BaseObserver`.
6. For UI, create `src/frontend/frontend.ts` with `definePlugin({ manifest, component })`. Keep the component focused on side-effects; colocate shared UI under `src/frontend/`.
7. Strip what you don't need — most plugins do not register scheduler jobs or publish a service.
8. Restart `npm run dev` — registries regenerate, source-mode plugins compile on-the-fly. Compiled-mode plugins need `npm run build` inside the plugin first.
9. Verify the plugin appears in `/api/plugins/manifests`, install and enable through `/system/plugins`, check backend logs for init success, load the frontend.

### CSS Conventions

Use SCSS Modules (`Component.module.scss`, colocated, scoped class names). Reference semantic CSS variables (`var(--card-padding-md)`, `var(--color-primary)`) — never hardcoded values. Use container queries for component responsiveness, not viewport media queries. See [ui-scss-modules.md](../frontend/ui/ui-scss-modules.md) and [plugins-frontend-context-styling.md](./plugins-frontend-context-styling.md).

## Admin Interface

`/system/plugins` lists all discovered plugins with installed/enabled state and lifecycle controls (Install, Uninstall, Enable, Disable). Hook errors are captured and shown in the UI. Uninstall always sets `installed: false` even if the hook fails — the hook is best-effort cleanup. Plugins must be installed before they can be enabled; uninstalling auto-disables. Database state persists across restarts. Frontend only loads plugins that are installed AND enabled.

REST endpoints under `/api/plugin-management/`: `GET /all`, `POST /:pluginId/install`, `POST /:pluginId/uninstall`, `POST /:pluginId/enable`, `POST /:pluginId/disable`. All require admin authentication via the Better Auth session cookie — same-origin fetches carry it automatically.

For plugin-owned admin pages (settings UI under `/system/plugins/<id>/`, admin REST routes under `/api/plugins/<id>/system/**`), see [plugins-page-registration-admin.md](./plugins-page-registration-admin.md) and [plugins-api-registration.md](./plugins-api-registration.md).

## Operational Guardrails

Manifest booleans must be honest — a missing `frontend: true` means the UI never loads the plugin even if the component exists. Never import backend singletons from a plugin; rely on the injected `IPluginContext` to avoid circular dependencies. New plugins start disabled; install and enable via the admin interface.

## Further Reading

- [plugins.md](./plugins.md) — Lifecycle states, extension surfaces overview
- [plugins-frontend-context.md](./plugins-frontend-context.md) — `IFrontendPluginContext`, UI/api/websocket DI
- [plugins-page-registration.md](./plugins-page-registration.md) — Menus, pages, routes
- [plugins-page-registration-admin.md](./plugins-page-registration-admin.md) — Admin pages and System container auto-gate
- [plugins-blockchain-observers.md](./plugins-blockchain-observers.md) — Observer pattern, transaction handling
- [plugins-api-registration.md](./plugins-api-registration.md) — REST routes, middleware, admin endpoints
- [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md) — Namespaced subscription management
- [plugins-service-registry.md](./plugins-service-registry.md) — Cross-component service sharing
- [system-database.md](../system/system-database.md#plugins) — Namespaced storage helpers
