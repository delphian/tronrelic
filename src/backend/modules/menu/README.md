# Menu Module

Owns hierarchical navigation: multiple independent menu trees (namespaces), event-driven validation, per-user visibility gating, and real-time refetch signals. The in-memory tree makes every read instant; MongoDB persists only what must survive a restart.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `menu` |
| Module class | `src/backend/modules/menu/MenuModule.ts` |
| Service registry name | `'menu'` → `IMenuService` (also direct DI: `menuService` on module deps, `context.menuService` on plugins) |
| Admin page | `/system/menu` (menu item `Menu`, order 50, under the System container) |
| Mounted routes | `/api/menu/*` (public reads + `requireAdmin` mutations) |
| Types package | `@delphian/tronrelic-types` → `IMenuService`, `IMenuNode`, `IMenuTree`, `IMenuNodeAdminView`, `IMenuEvent`, `IMenuNamespaceConfig`, `IMenuViewer` |
| Collections | `menu_nodes`, `menu_node_overrides`, `menu_namespace_config` (legacy-unprefixed; predate the `module_*` convention) |
| WebSocket events | `menu:update` (refetch signal), `menu:namespace-config:update` |
| System container | `MAIN_SYSTEM_CONTAINER_ID = '000000000000000000000001'` (exported from `constants.ts` / module index) |
| Bootstrap order | `MenuModule.init()` runs before all other feature modules so they can register menu items during their `run()` |

## Source Map

| Path | Responsibility |
|------|----------------|
| `MenuModule.ts` | Two-phase lifecycle; seeds System container, registers `'menu'`, mounts `/api/menu` |
| `services/menu.service.ts` | `MenuService` singleton (`setDependencies`/`getInstance`); tree cache, events, gating, overrides, WS broadcasts |
| `api/menu.controller.ts` | Zod-validated request handlers; resolves `IMenuViewer` from `req.authSession` for gated reads |
| `constants.ts` | `MAIN_SYSTEM_CONTAINER_ID`; `ADMIN_NAMESPACES` (empty typed extension point for namespace-level suppression) |
| `database/IMenuNodeDocument.ts` | `menu_nodes` document (persisted nodes only) |
| `database/IMenuNodeOverrideDocument.ts` | `menu_node_overrides` document, keyed `(namespace, url)` |
| `database/IMenuNamespaceConfigDocument.ts` | `menu_namespace_config` document, keyed `namespace` |
| `migrations/` | `002`–`005`: dropped obsolete collections, gating fields, `system`→`main` namespace merge |

## Service Contract: `'menu'` → `IMenuService`

| Method | Purpose |
|--------|---------|
| `initialize()` | Load `menu_nodes`, build in-memory tree, seed default Home node if empty, emit `init` → `ready` → `loaded`. Idempotent |
| `subscribe(eventType, callback)` | Register an event subscriber (see [Events](#events)) |
| `create(nodeData, persist=false)` | Create a node; auto-derives URL for container nodes; forces `requiresAdmin` under the System container |
| `update(id, updates)` | Update a node (concrete `MenuService` takes trailing `persist=false`; memory-only nodes get overrides saved instead) |
| `delete(id)` | Delete a node (concrete trailing `persist=false`). **Does not cascade** — children orphan unless a `before:delete` subscriber handles them |
| `getTree(namespace='main')` | Full unfiltered tree (`{ roots, all, generatedAt }`) from memory |
| `getTreeAdminView(namespace)` | Unfiltered tree projected to `IMenuNodeAdminView` with `origin` tag; caller must be admin |
| `getTreeForUser(namespace, viewer)` | Tree filtered by `requiresGroups`/`requiresAdmin` against the viewer; `undefined` viewer = anonymous |
| `getChildrenForUser(parentId, namespace, viewer)` | Viewer-filtered children, sorted by order |
| `getChildren(parentId, namespace)` | Unfiltered children, sorted by order |
| `getNode(id)` | One node from memory, or undefined |
| `getNamespaces()` | All namespace ids in use |
| `getNamespaceConfig(namespace)` | Rendering config (`overflow`, `icons`, `layout`, `styling`), defaults if unset |
| `setNamespaceConfig(namespace, config)` | Merge-update config; broadcasts `menu:namespace-config:update` |
| `deleteNamespaceConfig(namespace)` | Reset config to defaults; broadcasts |

The interface exposes `persist` only on `create`; the concrete `MenuService` (what DI and the registry both hand out) accepts it on `update`/`delete` too, and the admin controller passes `true` for all three.

## Events

Subscribers run in registration order. `before:*` handlers can halt the operation (`event.validation.continue = false`, optional `event.validation.error`); `after:*` cannot. Only create/update/delete emit — the `reorder`/`move` members of `MenuEventType` are declared but never fired. Lifecycle events (`init`, `ready`, `loaded`) fire during `initialize()` and are **not** broadcast over WebSocket (no clients are connected during startup).

| Event | Can halt | Fired |
|-------|----------|-------|
| `before:create` / `after:create` | Yes / No | Around node creation |
| `before:update` / `after:update` | Yes / No | Around node update (previous state on `event.previousNode`) |
| `before:delete` / `after:delete` | Yes / No | Around node deletion |
| `init`, `ready`, `loaded` | No | Service startup; plugins register nodes on `ready` |

```typescript
menuService.subscribe('before:create', async (event) => {
    if (!event.node.label.match(/^[A-Z]/)) {
        event.validation.continue = false;
        event.validation.error = 'Label must start with capital letter';
    }
});
```

## REST Endpoints

Reads are public — the frontend chrome fetches without a token; per-user gating is applied from the Better Auth session (`attachAuthSession` → `req.authSession`). `/manage` and all mutations chain a per-IP rate limiter then `requireAdmin` (Better Auth admin session or `ADMIN_API_TOKEN`). See [system-api.md](../../../../docs/system/system-api.md).

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/menu` | Public | Viewer-filtered tree. Query: `namespace` (default `main`). Returns `{ success, tree: { roots, all } }` |
| GET | `/api/menu/resolve` | Public | Resolve `url` to a container node + enabled children (category landing pages). Query: `url` (required), `namespace`. Admins bypass gating; 404 when node or children absent |
| GET | `/api/menu/namespaces` | Public | All namespace ids |
| GET | `/api/menu/namespace/:namespace/config` | Public | `IMenuNamespaceConfig` (defaults if unset) |
| GET | `/api/menu/manage` | `requireAdmin` | Origin-tagged full tree incl. disabled/gated rows (admin UI only) |
| POST | `/api/menu` | `requireAdmin` | Create persisted node. Body: `label` (required), `description`, `url`, `icon`, `order`, `parent` (24-hex ObjectId), `enabled`, `requiresGroups`, `requiresAdmin` |
| PATCH | `/api/menu/:id` | `requireAdmin` | Update node (any fields) |
| DELETE | `/api/menu/:id` | `requireAdmin` | Delete node — no cascade |
| PUT | `/api/menu/namespace/:namespace/config` | `requireAdmin` | Replace config. Body: `overflow`, `icons`, `layout`, `styling` |
| DELETE | `/api/menu/namespace/:namespace/config` | `requireAdmin` | Reset config to defaults |

## WebSocket Events

| Event | Payload | Semantics |
|-------|---------|-----------|
| `menu:update` | `{ event: 'after:create'\|'after:update'\|'after:delete', namespace, nodeId, timestamp }` | Refetch signal only — no tree body. Per-user gating means no single tree shape fits every client; receivers re-request `GET /api/menu?namespace=...` with their own cookie and get their filtered view. Admin-item mutations are therefore safe to broadcast globally |
| `menu:namespace-config:update` | `{ namespace, config, timestamp }` | Config changed or reset; carries the full config (not gated) |

## Storage

| Collection | Keyed by | Contents |
|------------|----------|----------|
| `menu_nodes` | `_id` | Persisted (`persist=true`) nodes only — admin-created entries. Memory-only nodes never appear here |
| `menu_node_overrides` | `(namespace, url)` | Admin customizations of memory-only nodes: `order`, `label`, `description`, `icon`, `enabled`. Applied over plugin defaults on every re-registration, so customizations survive restarts without plugin code changes. URL is the stable identity — URL-less nodes are ineligible; a URL change on a memory-only node does not survive restart |
| `menu_namespace_config` | `namespace` | Per-namespace rendering config (`overflow`, `icons`, `layout`, `styling`) |

## Node Semantics

**Dual persistence.** `persist=false` (default) creates a memory-only node — plugins and modules use this for runtime pages, re-registering on every boot. `persist=true` writes to `menu_nodes` — the admin API's mode for manual entries.

**Origin tag (admin reads only).** `IMenuNode` carries no manual-vs-plugin flag; storing one would drift. `getTreeAdminView()` computes `origin` at read time from `persistedNodeIds` and the cached override keys, served exclusively from `GET /api/menu/manage`. `GET /api/menu` never changes shape by privilege.

| Origin | Meaning |
|--------|---------|
| `manual` | Persisted in `menu_nodes`; CRUD survives restart |
| `plugin` | Memory-only, no override row; delete removes only the in-memory copy — reappears on next boot |
| `plugin-overridden` | Memory-only with a `menu_node_overrides` row; plugin owns lifecycle, overrides survive restarts |

**Auto-derived URLs.** Container nodes that omit `url` get one by slugifying the label: `/{slug}` at root, `{parent-url}/{slug}` nested. The derived URL is the override key and the category-landing-page route. Slugification producing an empty string throws.

**Category landing pages.** Every container with children gets an auto page at its URL: the frontend catch-all route (`app/[...slug]/page.tsx`) calls `GET /api/menu/resolve?url=...` and renders a card grid of children (icon, label, `description`). A real page registered at the same URL takes precedence.

## Visibility Gating

Two independent node fields, ANDed. The filter lives in `getTreeForUser`/`getChildrenForUser`; the controller builds `IMenuViewer` (`{ groups, isAdmin }`) from `req.authSession` per request. Anonymous visitors pass `undefined` and see only ungated nodes.

| Field | Shape | Semantics |
|-------|-------|-----------|
| `requiresGroups` | `string[]?` | Visible if the viewer is in *any* listed group id (OR-of-membership; ids reference `module_user_groups`) |
| `requiresAdmin` | `boolean?` | Visible only when the viewer's admin flag is true |

`requiresAdmin` (per-user, cookie-identity read filter) is **not** the `requireAdmin` middleware (shared-token/admin-session gate on mutating endpoints). They coexist: mutations stay token-gated while reads filter per-user, so admin items are invisible to ordinary visitors.

### The System Container

All admin menu items live in `main` as a subtree rooted at the fixed sentinel `MAIN_SYSTEM_CONTAINER_ID`, seeded by `MenuModule.run()`. Register admin items by importing the constant and parenting under it:

```typescript
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';

await menuService.create({
    namespace: 'main', label: 'Logs', url: '/system/logs',
    icon: 'ScrollText', order: 30, parent: MAIN_SYSTEM_CONTAINER_ID, enabled: true
});
```

The id is a 24-hex ObjectId string (not a colon-string like `'main:system'`) because the controller validates `parent`/`:id` with `OBJECT_ID_REGEX` and persistence wraps `parent` in `new ObjectId(...)` — a non-hex sentinel would force special-casing across every layer, an invariant that drifts silently.

Callers never set `requiresAdmin` themselves under System: `create`/`update` walk the parent chain and force `requiresAdmin: true` whenever the container appears above the node, making the gate non-bypassable even against an explicit `requiresAdmin: false`. Reparenting *into* the subtree applies the rule; reparenting *out* preserves the flag (clearing a gate is an explicit operator decision). There is no `system` namespace — `ADMIN_NAMESPACES` remains an empty typed extension point.

## Plugin Integration

Plugins register memory-only nodes in a `menuService.subscribe('ready', ...)` callback during `init()` (core modules register directly in `run()` — the service is already up). Track created node ids and delete them in `disable()`.

```typescript
menuService.subscribe('ready', async () => {
    await menuService.create({
        namespace: 'main', label: 'My Plugin', url: `/plugins/${manifest.id}`,
        icon: 'Puzzle', order: 100, parent: null, enabled: true
    }); // persist defaults to false (memory-only)
});
```

## Submenu Pattern (Namespaced Tab Rows)

An admin page's submenu — the in-page tab row on a surface like `/system/account-history` — is just a menu, and backing it with the menu service is **the only authorized pattern for core and module admin pages.** Hand-rolled `<button>` arrays, `.segmented-control` strips, and per-page `styles.tab` rows are **not permitted**: they duplicate code and forfeit per-user gating, ordering, live `menu:update` refresh, and runtime extensibility — a *different* plugin can contribute a tab by registering a node, which a hand-rolled array cannot.

**Reference implementation:** `/system/account-history`. `AccountHistoryModule.run()` registers the `account-history` namespace nodes; `AccountHistoryAdminClient.tsx` renders them with `MenuNavClient`. Copy that surface.

Register each tab as a memory-only leaf in a dedicated namespace (not `main`) — keeping it out of `main` keeps tabs out of the global nav chrome. The namespace sits outside the System container, so the non-bypassable `requiresAdmin` force does **not** apply: the caller owns security and sets `requiresAdmin` per node explicitly (see [The System Container](#the-system-container)).

The frontend renders the row with `MenuNavClient` (`src/frontend/components/layout/MenuNav/`). Two additive opt-in props; both default undefined, so existing navigation consumers are unchanged:

| Prop | Effect when set |
|------|-----------------|
| `onItemSelect(item, event)` | Leaf clicks call this and suppress navigation — the page drives `activeTab` (e.g. a `?tab=` query param) instead of routing |
| `activeUrl` | Highlights the leaf whose `url` matches, bypassing pathname matching — required because the route is identical across tabs |

Because `onItemSelect` is a function it cannot cross the server boundary — the consumer is the page's own client component (holding `activeTab` state and the SSR-fetched namespace tree), rendering `MenuNavClient` directly rather than `MenuNavSSR`. **Core admin pages** render `MenuNavClient` directly. **Plugins** cannot import core components, so they consume `context.layout.SubMenu` (a thin wrapper with a friendlier `onSelect(item)` callback), register tabs via `context.menuService.create(...)`, and fetch the namespace tree SSR-first through `serverDataFetcher`. See [plugins-frontend-context-ui.md](../../../../docs/plugins/plugins-frontend-context-ui.md#submenu--in-page-tab-navigation).

```typescript
// Backend: core module in run(); plugin inside subscribe('ready', ...).
await menuService.create({
    namespace: 'account-history', label: 'Tracked Accounts',
    url: '/system/account-history?tab=accounts', icon: 'List',
    order: 0, parent: null, enabled: true,
    requiresAdmin: true // caller owns gating outside the System subtree
});
```

```tsx
// Frontend (core page client component)
<MenuNavClient
    namespace="account-history"
    items={submenuTree}
    generatedAt={generatedAt}
    activeUrl={`/system/account-history?tab=${activeTab}`}
    onItemSelect={(item) => setActiveTab(tabFromUrl(item.url))}
/>
```

## Lifecycle

**`init()`** (deps: `database`, `serviceRegistry`, `app`) wires the `MenuService` singleton (`setDependencies` → `getInstance`), awaits `initialize()` (loads `menu_nodes`, builds the tree, emits `init`/`ready`/`loaded`), and constructs the controller. **`run()`** publishes `'menu'` on the service registry, seeds the System container (memory-only, order 9999) and the `/system/menu` admin item, then mounts `/api/menu`. Runs before every other feature module so their `run()` registrations find the service ready.

## Related

- [Module Architecture](../../../../docs/system/modules/modules-architecture.md) — IModule contract, bootstrap order, service registry
- [plugins-page-registration-menu.md](../../../../docs/plugins/plugins-page-registration-menu.md) — plugin-side menu registration patterns
- [system-api-websockets.md](../../../../docs/system/system-api-websockets.md) — real-time event catalog
