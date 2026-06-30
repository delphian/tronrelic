# Menu Module

The menu module manages hierarchical navigation menus with event-driven validation, real-time WebSocket updates, and support for multiple independent menu trees (namespaces). It implements the IModule interface with two-phase lifecycle initialization.

## Why This Matters

Navigation is critical infrastructure that every feature depends on:

- **Plugin integration** - Plugins register menu items automatically without touching core navigation code
- **Real-time synchronization** - WebSocket updates ensure all connected clients see menu changes immediately
- **Multi-context navigation** - Separate menu trees (namespaces) allow different navigation contexts without coupling
- **Event-driven validation** - Subscribers enforce naming conventions, prevent deletions, or cascade updates through before:* and after:* events
- **In-memory performance** - Complete menu tree cached for instant `getTree()` calls without database queries

Without the menu system:
- ❌ Plugins hardcode routes in frontend navigation components
- ❌ Menu changes require backend restarts
- ❌ Multiple navigation contexts require separate implementations
- ❌ Every navigation render hits the database

## Core Architecture

### Service Design

The menu service uses a singleton pattern with dependency injection for database access:

- **In-memory tree caching** - All nodes loaded on initialization for fast tree building
- **Event-driven validation** - Before:* events allow subscribers to halt operations, after:* events enable logging and WebSocket broadcasting
- **Dual persistence modes** - Admin API creates persisted database entries, plugins create memory-only runtime entries
- **Namespace isolation** - Multiple independent menu trees share the same service

**Lifecycle events:**
1. `init` - Service initialization begins
2. `ready` - Service accepts API calls and plugin registrations
3. `loaded` - Menu tree fully built and ready

### Menu Namespaces

Namespaces allow multiple independent menu trees to coexist. Each maintains its own hierarchy with separate root nodes.

**Common namespaces:** `main` (primary navigation, including the admin subtree), `footer`, `mobile`. Admin items live under the System container in `main` rather than in a dedicated namespace — see [The System Container](#the-system-container) below.

```typescript
const namespaces = menuService.getNamespaces();
const mainTree = menuService.getTree('main');
```

### Event-Driven Validation

Menu operations emit before:* and after:* events for validation, logging, or cascading updates.

| Event Type | When Emitted | Can Halt | Use Case |
|------------|-------------|----------|----------|
| `before:create` | Before saving new node | Yes | Validate naming, prevent duplicates |
| `after:create` | After node created | No | Log creation, trigger side effects |
| `before:update` | Before applying changes | Yes | Prevent breaking changes |
| `after:update` | After changes saved | No | Update related systems |
| `before:delete` | Before removing node | Yes | Prevent deletion, cascade delete children |
| `after:delete` | After node removed | No | Clean up orphaned data |

```typescript
// Enforce naming convention
menuService.subscribe('before:create', async (event) => {
    if (!event.node.label.match(/^[A-Z]/)) {
        event.validation.continue = false;
        event.validation.error = 'Label must start with capital letter';
    }
});
```

### Dual Persistence Modes

**Persisted entries (persist=true):**
- Created by admin API for manual menu customization
- Saved to MongoDB `menu_nodes` collection
- Survive backend restarts

**Memory-only entries (persist=false, default):**
- Created by plugins for runtime pages
- Stored only in-memory tree
- Re-created by plugins on each startup

### Order Override Persistence

When an admin reorders a memory-only menu item (e.g., changes a plugin's menu position via the admin UI), the service saves the customization to a `menu_node_overrides` collection keyed by `(namespace, url)`. On the next startup, when the plugin re-registers the same menu item, the service looks up any saved overrides and applies them instead of the plugin's defaults. This ensures user-customized ordering survives deployments without requiring plugins to change their registration code.

Override persistence applies to `order`, `label`, `description`, `icon`, and `enabled` fields. Only nodes with a URL are eligible for overrides since the URL serves as the stable identity across restarts.

### Origin Tag (Admin Reads Only)

`IMenuNode` carries no flag distinguishing manual rows from plugin-registered ones, but the service tracks the distinction internally: `persistedNodeIds` holds ids loaded from or written to `menu_nodes`, and a cached set of `(namespace, url)` keys mirrors `menu_node_overrides`. Surfacing that as a stored column would be a drift hazard. Instead `getTreeAdminView()` projects the in-memory tree to `IMenuNodeAdminView` and tags each node with `origin`:

| Value | Meaning |
|-------|---------|
| `manual` | Persisted in `menu_nodes`. Create/update/delete survive restart. |
| `plugin` | Memory-only, no override row. Delete removes only the in-memory copy — the plugin re-registers on next boot. |
| `plugin-overridden` | Memory-only with an admin customization in `menu_node_overrides`. Plugin still owns lifecycle; `order`/`label`/`icon`/`description`/`enabled` survive restarts. |

The origin-tagged projection is served exclusively from `GET /api/menu/manage`, a `requireAdmin`-gated endpoint. `GET /api/menu` is the universal navigation read and never changes shape based on caller privilege — every visitor, admin or not, gets the same per-user filtered, enabled-only tree. Splitting reads this way keeps the navigation chrome consistent for admin operators and confines disabled / gated rows to the editing surface where they belong. Origin is computed at read time, so it never goes stale. The admin UI at `/system/menu` renders the tag as a badge and gates the delete confirm dialog with a "will reappear on next plugin load" warning for `plugin` and `plugin-overridden` rows.

### Auto-Derived URLs for Container Nodes

Container nodes that omit a URL receive one automatically by slugifying their label. For root-level containers, the URL is `/{slug}` (e.g., label "Tools" becomes `/tools`). For nested containers, the URL is `{parent-url}/{slug}`. This auto-derived URL serves as the stable override key and as the route for the auto-generated category landing page. Admins can change the URL at runtime through the admin API, but for memory-only/plugin-registered nodes that change does not persist across restarts via `menu_node_overrides`. Only `order`, `label`, `description`, `icon`, and `enabled` are persisted for memory-only nodes. Persisted database-backed nodes save URL changes normally.

### Category Landing Pages

Every container node with children automatically gets a landing page at its URL. The page renders a card grid showing each child's icon, title, and description. This is handled by the frontend catch-all route (`[...slug]/page.tsx`) which calls `GET /api/menu/resolve?url=...` to fetch the container and its children. Plugin or custom pages registered at the same URL take precedence over the auto-generated page.

### Description Field

Menu nodes support an optional `description` field for short text describing the item's purpose. Descriptions appear on auto-generated category landing pages as card subtitle text. Like `label` and `icon`, descriptions are overridable by admins and persist in the `menu_node_overrides` collection.

## Service Discovery

MenuService is reachable two ways. Modules and plugins receive it directly via constructor / context injection (`menuService` on shared module deps, `context.menuService` on plugins). It is also published on the service registry as `'menu'` during `MenuModule.run()`, so late-binding consumers can discover it without depending on bootstrap wiring.

Use the registry path when consumption is optional or happens outside the init/run boot order — for example, a plugin route handler that wants to read the menu without taking a hard dependency on the module being initialized first. Use direct injection when the consumer always needs the service at boot.

```typescript
import type { IMenuService } from '@/types';

const menu = context.services.get<IMenuService>('menu');
if (menu) {
    const tree = menu.getTree('main');
}
```

## Menu Node Lifecycle

**Initialization:** Service loads persisted nodes from MongoDB, builds in-memory tree, creates default Home node if empty, then emits `init` → `ready` → `loaded` events.

**Create:** Emits `before:create` (can halt), saves to MongoDB if `persist=true`, adds to in-memory tree, emits `after:create`, broadcasts WebSocket event.

**Update:** Emits `before:update` (can halt), applies changes to MongoDB if `persist=true`, updates in-memory tree, emits `after:update`, broadcasts WebSocket event.

**Delete:** Emits `before:delete` (can halt), removes from MongoDB if `persist=true`, removes from in-memory tree, emits `after:delete`, broadcasts WebSocket event. **Delete does NOT cascade by default** - subscribers must implement cascade logic.

## Visibility Gating

Menu nodes can be gated on two independent fields, ANDed together. The
backend filters menu reads at request time using the Better Auth session
resolved onto `req.authSession`. `GET /api/menu` applies this per-visitor
filter to every caller; the origin-tagged admin view at `GET /api/menu/manage`
(behind `requireAdmin`) returns the full tree including disabled and gated
rows so the admin UI can render and edit them.

| Field | Shape | Semantics |
|-------|-------|-----------|
| `requiresGroups` | `string[]?` | Visible if the user is a member of *any* listed group id (OR-of-membership). Group ids reference `module_user_groups` rows managed by the identity module. |
| `requiresAdmin` | `boolean?` | Visible only when the viewer's admin flag is true — `isAdmin(req)` derived from the Better Auth session and resolved once per request by `resolveViewer`. |

The filter lives in `MenuService.getTreeForUser(namespace, user?)` and
`getChildrenForUser(parentId, namespace, user?)`. Both are called by the
public read endpoints (`GET /api/menu`, `GET /api/menu/resolve`) after the
`attachAuthSession` middleware has populated `req.authSession`. Anonymous
visitors pass `undefined` and only see nodes with no group/admin gates.

The admin predicate looks up `'user-groups'` from the service registry
lazily — the identity module registers the service in its `run()` phase, so by
the time anyone calls `GET /api/menu` it's available. If the registry entry
is missing (tests, or a deployment where the identity module hasn't initialized
yet), `requiresAdmin: true` nodes are hidden from everyone except the
shared-admin-token holder.

`requiresAdmin` is **not** the same as the `requireAdmin` middleware. The
middleware is a shared-token gate (`x-admin-token` against
`ADMIN_API_TOKEN`) for operators and CI tooling. `requiresAdmin` is a
per-user check keyed off cookie identity. They coexist: mutating menu
endpoints stay behind `requireAdmin` (token-gated), while menu *reads*
filter per-user via `requiresAdmin` so admin items remain invisible to
ordinary visitors.

### The System Container

All admin menu items live as a subtree of `main` rooted at a
hard-coded container whose id is the fixed sentinel
`MAIN_SYSTEM_CONTAINER_ID` (a 24-hex ObjectId string exported from the
menu module — `src/backend/modules/menu/index.ts`). The container is
seeded by `MenuModule.run()` and every module or plugin that wants to
register an admin item imports the constant and parents directly under
it:

```typescript
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';

await menuService.create({
    namespace: 'main',
    label: 'Logs',
    url: '/system/logs',
    icon: 'ScrollText',
    order: 30,
    parent: MAIN_SYSTEM_CONTAINER_ID,
    enabled: true
});
```

The id is hex (not a colon-string like `'main:system'`) because the
controller validates `parent` and `:id` path params with
`OBJECT_ID_REGEX` and the persistence layer wraps `parent` in
`new ObjectId(...)` for `menu_nodes` writes. A non-hex id would force
every admin CRUD endpoint, the persistence path, and
`IMenuNodeDocument.parent`'s type to special-case the container —
exactly the kind of cross-layer invariant that drifts and breaks
silently. Constants stay symbolic in code; the wire/storage shape is
plain ObjectId.

Callers do not set `requiresAdmin` themselves. `MenuService.create` and
`MenuService.update` walk the parent chain on every write; if the
container id appears anywhere above the node (or the node itself has
that id), `requiresAdmin: true` is forced regardless of caller input.
This makes the admin gate non-bypassable: a misconfigured registration,
a forgotten flag, or an explicit `requiresAdmin: false` all still end
up gated as long as the node lives in the System subtree. Reparenting
INTO the subtree via `update()` applies the same rule; reparenting OUT
preserves the flag (clearing the gate is an explicit operator decision,
not something the engine infers from the move).

There is no separate `system` namespace anymore — read protection is
per-node via `requiresAdmin`, applied by `getTreeForUser` against the
cookie-resolved user. The `ADMIN_NAMESPACES` constant remains in place
as a typed extension point for any future namespace that needs
namespace-level suppression, but is currently empty.

### Real-time updates

`menu:update` WebSocket events no longer ship the full tree — per-user
gating means there is no single shape that fits every connected client.
The event is now a refetch signal carrying `{ event, namespace, nodeId,
timestamp }`; clients re-request `GET /api/menu` with their own cookie and
the server returns the filtered view.

## REST API Reference

Navigation reads are public — the frontend chrome fetches them without an admin token, with per-user gating applied from the Better Auth session. The admin management read (`GET /api/menu/manage`) and every mutating endpoint go through `requireAdmin`, which accepts either a Better Auth admin session or `ADMIN_API_TOKEN` via `x-admin-token` / `Authorization: Bearer`. See [system-api.md](../../../../docs/system/system-api.md) for complete authentication patterns.

**Public (no auth):**

| Endpoint | Method | Purpose | Key Fields |
|----------|--------|---------|------------|
| `/api/menu` | GET | Get menu tree for namespace | Query: `namespace` (optional, defaults to 'main') |
| `/api/menu/resolve` | GET | Resolve URL to category node with children | Query: `url` (required), `namespace` (optional) |
| `/api/menu/namespaces` | GET | Get all namespaces | Returns array of namespace strings |
| `/api/menu/namespace/:namespace/config` | GET | Get namespace configuration | Returns `IMenuNamespaceConfig` (defaults if unset) |

**Admin (requires `requireAdmin`):**

| Endpoint | Method | Purpose | Key Fields |
|----------|--------|---------|------------|
| `/api/menu/manage` | GET | Origin-tagged tree for the menu admin UI — includes disabled and gated rows | Query: `namespace` (optional, defaults to 'main') |
| `/api/menu` | POST | Create persisted menu node | Body: `label` (required), `description`, `url`, `icon`, `order`, `parent`, `enabled`, `requiresGroups`, `requiresAdmin` |
| `/api/menu/:id` | PATCH | Update menu node | Body: any fields to update |
| `/api/menu/:id` | DELETE | Delete menu node | Does **not** cascade — children become orphans unless a `before:delete` subscriber handles them |
| `/api/menu/namespace/:namespace/config` | PUT | Replace namespace configuration | Body: `overflow`, `icons`, `layout`, `styling` |
| `/api/menu/namespace/:namespace/config` | DELETE | Reset namespace configuration to defaults | — |

**Example response structure:**
```json
{
    "success": true,
    "tree": {
        "roots": [{ /* IMenuNode with children */ }],
        "all": [/* flat list */]
    }
}
```

## WebSocket Real-Time Updates

The menu service broadcasts `menu:update` refetch signals whenever nodes are
created, updated, or deleted. Per-user gating means the server cannot ship a
single tree shape that fits every connected client — receivers re-request
`GET /api/menu?namespace=...` with their own cookie and the gating filter
returns their personalized view.

**Event payload:**
```typescript
{
    type: 'menu:update',
    payload: {
        event: 'after:create' | 'after:update' | 'after:delete',
        namespace: string,
        nodeId: string,
        timestamp: string
    }
}
```

**Frontend subscription:**
```typescript
socket.on('menu:update', (payload) => {
    // Refetch via the user's cookie context; the signal carries no tree body
    fetch(`/api/menu?namespace=${payload.namespace}`, { credentials: 'include' })
        .then(r => r.json())
        .then(({ tree }) => setMenuTree(tree));
});
```

**Admin items rely on per-user gating, not namespace suppression.** The `menu:update` signal is a refetch trigger, not a tree body, so a non-admin client refetching after an admin-item mutation receives a tree filtered by their own gating — admin entries never appear. The legacy `ADMIN_NAMESPACES` set remains in the source as a typed extension point but is currently empty.

**Note:** Lifecycle events (init, ready, loaded) are NOT broadcast via WebSocket because clients are not connected during backend startup.

## Plugin Integration

### Registering Plugin Pages

Plugins register menu items during initialization by subscribing to the `ready` event.

```typescript
export const myPluginBackendPlugin = definePlugin({
    manifest: myManifest,

    init: async (context: IPluginContext) => {
        const { menuService } = context;

        menuService.subscribe('ready', async () => {
            await menuService.create({
                namespace: 'main',
                label: 'My Plugin',
                url: `/plugins/${myManifest.id}`,
                icon: 'Puzzle',
                order: 100,
                parent: null,
                enabled: true
            });
            // persist defaults to false (memory-only)
        });
    }
});
```

**Cleanup pattern:** Track menu node IDs during registration, then delete them in the `disable()` hook to remove navigation entries when plugin is disabled.

## Submenu Pattern (Namespaced Tab Rows)

An admin page's submenu — the in-page tab row on a surface like `/system/account-history` (tracked accounts / settings / schedules) — is just a menu, and backing it with the menu service is **the only authorized pattern for core and module admin pages.** Hand-rolled `<button>` arrays with local `activeTab` state, bare `.segmented-control` strips, and per-page `styles.tab` rows are **not permitted** for these surfaces: they duplicate the same code across pages and forfeit the per-user gating, ordering, live `menu:update` refresh, and runtime extensibility the menu service provides — a *different* plugin can even contribute a tab into the row by registering a node, which a hand-rolled array cannot.

**Reference implementation:** `/system/account-history`. `AccountHistoryModule.run()` registers the `account-history` namespace nodes; `AccountHistoryAdminClient.tsx` renders them with `MenuNavClient`. Copy that surface when building a new admin page's tab row.

### How It Works

Register each tab as a leaf node in a dedicated namespace (not `main`), memory-only (`persist=false`). Keeping it out of `main` keeps the tabs out of the global nav chrome — only the page's own submenu component reads that namespace. The namespace also sits outside the System container, so the non-bypassable `requiresAdmin` force does **not** apply: the caller owns security and sets `requiresAdmin` per node explicitly (see [The System Container](#the-system-container)).

The frontend renders the row with `MenuNavClient` (`src/frontend/components/layout/MenuNav/`). Two additive, opt-in props govern behavior; both default to undefined, so existing navigation consumers are unchanged:

| Prop | Effect when set |
|------|-----------------|
| `onItemSelect(item, event)` | Leaf clicks call this and suppress navigation, letting the page drive `activeTab` (e.g. sync a `?tab=` query param) instead of routing. |
| `activeUrl` | Highlights the leaf whose `url` matches, bypassing pathname matching — required because the route is identical across tabs. |

The click decision is the caller's: omit `onItemSelect` and a tab navigates like any link; provide it and the tab drives in-page state. Because `onItemSelect` is a function it cannot cross the server boundary — the consumer is the page's own client component (which already holds `activeTab` state and the SSR-fetched namespace tree), rendering `MenuNavClient` directly rather than the server `MenuNavSSR` wrapper.

**Core admin pages** (modules) render `MenuNavClient` directly. **Plugins** cannot import core components across the workspace boundary, so they consume `context.layout.SubMenu` from `IFrontendPluginContext` — a thin wrapper over `MenuNavClient` with a friendlier `onSelect(item)` callback. A plugin registers its tabs in its own namespace via `context.menuService.create(...)`, fetches that namespace tree SSR-first through its `serverDataFetcher`, and renders the row with `context.layout.SubMenu`. See [plugins-frontend-context-ui.md](../../../../docs/plugins/plugins-frontend-context-ui.md#submenu--in-page-tab-navigation).

### Example

```typescript
// Backend: register the tabs in the page's own namespace. A core module
// registers in `run()` (the menu service is already up); a plugin registers in
// a `menuService.subscribe('ready', ...)` callback. Memory-only, requiresAdmin
// per node since the namespace sits outside the System container.
await menuService.create({
    namespace: 'account-history',
    label: 'Tracked Accounts',
    url: '/system/account-history?tab=accounts',
    icon: 'List',
    order: 0,
    parent: null,
    enabled: true,
    requiresAdmin: true // caller owns gating outside the System subtree
});
// ...Ingestion Settings, Schedules
```

```tsx
// Frontend (core page client component): render the row as in-page tabs.
<MenuNavClient
    namespace="account-history"
    items={submenuTree}
    generatedAt={generatedAt}
    activeUrl={`/system/account-history?tab=${activeTab}`}
    onItemSelect={(item) => setActiveTab(tabFromUrl(item.url))}
/>
```

## Pre-Implementation Checklist

Before implementing menu integration or navigation UI:

- [ ] MenuService initialized during application bootstrap
- [ ] Plugins subscribe to `ready` event before registering menu items
- [ ] Menu items use memory-only mode (persist=false) for runtime entries
- [ ] Admin API uses persisted mode (persist=true) for manual entries
- [ ] Cleanup logic implemented in plugin `disable()` hook
- [ ] Namespace chosen appropriately for navigation context
- [ ] Event subscribers handle validation errors gracefully
- [ ] Frontend subscribes to `menu:update` WebSocket events
- [ ] Access control checked in frontend before rendering menu items
- [ ] Tests use `MockPluginDatabase` instead of real MongoDB

## Troubleshooting

### Menu Items Not Appearing

**Diagnosis:**
```typescript
const tree = menuService.getTree();
console.log('Total nodes:', tree.all.length);

const namespaces = menuService.getNamespaces();
console.log('Namespaces:', namespaces);
```

**Resolution:**
- Ensure `menuService.initialize()` called during bootstrap
- Verify plugin subscribes to `ready` event (not `loaded` or `init`)
- Check that `enabled: true` is set on menu nodes
- Confirm frontend fetches correct namespace

### WebSocket Updates Not Received

**Diagnosis:**
```typescript
socket.on('connect', () => console.log('WebSocket connected'));
socket.on('menu:update', (payload) => console.log('Menu update:', payload));
```

**Resolution:**
- Verify `ENABLE_WEBSOCKETS=true` in backend environment
- Ensure frontend subscribes to `menu:update` event
- Check that WebSocket service is initialized
- Confirm socket.io client is connected

### Event Validation Failing

**Diagnosis:**
```typescript
menuService.subscribe('before:create', async (event) => {
    console.log('Validating node:', event.node);
    if (!event.validation.continue) {
        console.log('Validation failed:', event.validation.error);
    }
});
```

**Resolution:**
- Check subscriber logic for incorrect validation conditions
- Ensure subscribers set `validation.continue = false` only when necessary
- Review validation error messages in exceptions

### Orphaned Menu Nodes

**Diagnosis:**
```typescript
const tree = menuService.getTree();
const orphans = tree.all.filter(node => {
    if (!node.parent) return false;
    return !menuService.getNode(node.parent);
});
console.log('Orphaned nodes:', orphans);
```

**Resolution:**
- Implement proper cleanup in plugin `disable()` hook
- Subscribe to `before:delete` to cascade delete children
- Run migration script to fix orphaned nodes (set parent to null)

