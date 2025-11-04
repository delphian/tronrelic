# Menu System

TronRelic's menu system manages hierarchical navigation menus with event-driven validation, real-time WebSocket updates, and support for multiple independent menu trees (namespaces).

## Who This Document Is For

Backend developers implementing plugins that need navigation entries, frontend developers building navigation UI, and administrators managing menu structure through the admin API.

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

**Common namespaces:** `main` (primary navigation), `footer`, `admin-sidebar`, `mobile`

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
- Disappear on backend restart

## Menu Node Lifecycle

**Initialization:** Service loads persisted nodes from MongoDB, builds in-memory tree, creates default Home node if empty, then emits `init` → `ready` → `loaded` events.

**Create:** Emits `before:create` (can halt), saves to MongoDB if `persist=true`, adds to in-memory tree, emits `after:create`, broadcasts WebSocket event.

**Update:** Emits `before:update` (can halt), applies changes to MongoDB if `persist=true`, updates in-memory tree, emits `after:update`, broadcasts WebSocket event.

**Delete:** Emits `before:delete` (can halt), removes from MongoDB if `persist=true`, removes from in-memory tree, emits `after:delete`, broadcasts WebSocket event. **Delete does NOT cascade by default** - subscribers must implement cascade logic.

## REST API Reference

All endpoints require admin authentication via `ADMIN_API_TOKEN` in `x-admin-token` or `Authorization: Bearer` header. See [system-api.md](./system-api.md) for complete authentication patterns.

| Endpoint | Method | Purpose | Key Fields |
|----------|--------|---------|------------|
| `/api/menu` | GET | Get menu tree for namespace | Query: `namespace` (optional, defaults to 'main') |
| `/api/menu/namespaces` | GET | Get all namespaces | Returns array of namespace strings |
| `/api/menu` | POST | Create persisted menu node | Body: `label` (required), `url`, `icon`, `order`, `parent`, `enabled`, `requiredRole` |
| `/api/menu/:id` | PATCH | Update menu node | Body: any fields to update |
| `/api/menu/:id` | DELETE | Delete menu node | Fails if node has children unless cascade logic implemented |

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

The menu service broadcasts `menu:update` events whenever nodes are created, updated, or deleted.

**Event payload:**
```typescript
{
    type: 'menu:update',
    payload: {
        event: 'after:create' | 'after:update' | 'after:delete',
        node: IMenuNode,
        tree: IMenuTree,
        timestamp: Date
    }
}
```

**Frontend subscription:**
```typescript
socket.on('menu:update', (payload) => {
    console.log(`Menu ${payload.event}:`, payload.node.label);
    setMenuTree(payload.tree);
});
```

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

## Related Documentation

- [plugins/plugins.md](../plugins/plugins.md) - Plugin system architecture and integration patterns
- [plugins/plugins-page-registration.md](../plugins/plugins-page-registration.md) - How plugins register frontend pages
- [system-api.md](./system-api.md) - WebSocket event patterns and admin authentication
- [documentation.md](../documentation.md) - Documentation standards and writing style
