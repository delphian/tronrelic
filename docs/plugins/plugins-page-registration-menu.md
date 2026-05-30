# Plugin Menu Registration

Plugins register navigation entries through the backend `IMenuService` — never through the legacy frontend `menuItems` array. This keeps the menu tree in one place (database, hierarchical, gated) and lets the system reflect plugin enable/disable in real time.

## Why This Matters

Frontend-declared menus cannot nest, cannot persist, and cannot be filtered per-user. `IMenuService.create()` produces a database node, emits a `menu:updated` WebSocket event, and is read back by the NavBar through `MenuService.getTreeForUser` so visibility filters by the cookie-resolved visitor. Hardcoding entries in a navigation component or duplicating them between plugins fragments the tree and bypasses the gate.

## How It Works

The plugin's backend `init()` hook calls `context.menuService.create()`. The service writes the node, emits `menu:updated`, the NavBar refetches `/api/admin/system/menu/nodes?namespace=main`, and re-renders. Plugin `disable()` should remove the node so toggling cleans up.

```typescript
// src/backend/backend.ts
export const myBackendPlugin = definePlugin({
    manifest: myManifest,
    init: async (context: IPluginContext) => {
        await context.menuService.create({
            namespace: 'main',
            label: 'My Dashboard',
            url: '/my-dashboard',
            icon: 'BarChart3',     // Lucide icon name
            order: 30,
            parent: null,
            enabled: true
        });
    }
});
```

## Menu Node Fields

| Field | Purpose |
|-------|---------|
| `namespace` | Menu context, almost always `'main'` |
| `label` | Display text |
| `url` | Route path; omit for container/category nodes |
| `icon` | Lucide icon name (e.g. `BarChart3`, `Activity`, `Settings`) |
| `order` | Sort position; lower = earlier; default 999 |
| `parent` | Parent node `_id`, or `null` for top-level |
| `enabled` | Visibility toggle |
| `allowedIdentityStates` | **Vestigial** — the `UserIdentityState` taxonomy it gated was removed in the Better Auth cutover; gate on `requiresGroups` / `requiresAdmin` instead |
| `requiresGroups` | OR-of-membership across admin-defined groups |
| `requiresAdmin` | Visibility predicate via `IUserGroupService.isAdmin` |

`order` convention: `0–9` core nav, `10–99` feature plugins, `100+` admin/system.

## Hierarchies with Container Nodes

A node without `url` is a container. Children reference its `_id` as `parent`:

```typescript
const analytics = await context.menuService.create({
    namespace: 'main', label: 'Analytics', icon: 'BarChart3',
    order: 30, parent: null, enabled: true
    // no url — container
});

await context.menuService.create({
    namespace: 'main', label: 'Reports', url: '/analytics/reports',
    icon: 'FileText', order: 10, parent: analytics._id!, enabled: true
});
```

## Visibility Gating

Two optional fields filter menu visibility per visitor at read time:

- `requiresGroups` — OR-membership across admin-defined groups.
- `requiresAdmin` — routes through `IUserGroupService.isAdmin`.

The menu config's `requiresAdmin` is a *visibility* predicate. It is unrelated to the `requireAdmin` HTTP middleware in [plugins-api-registration.md](./plugins-api-registration.md), which gates routes (Better Auth session or `x-admin-token`).

> **Note.** `allowedIdentityStates` (the legacy `UserIdentityState` taxonomy) was removed in the Better Auth cutover. Gate menu visibility on `requiresGroups` / `requiresAdmin` (group membership) instead. See [system-auth.md](../system/system-auth.md).

```typescript
await context.menuService.create({
    namespace: 'main', label: 'Premium Tools',
    url: '/plugins/my-plugin/premium', icon: 'Sparkles',
    order: 200, parent: null, enabled: true,
    requiresGroups: ['premium']
});
```

See [Menu Module README → Visibility Gating](../../src/backend/modules/menu/README.md#visibility-gating) for the full contract.

## WebSocket Updates

`MenuService.create/update/delete` emits `menu:updated`. The NavBar subscribes and refetches. Custom components can subscribe directly:

```typescript
socket.on('menu:updated', async () => {
    const res = await fetch('/api/admin/system/menu/nodes?namespace=main');
    setMenuItems((await res.json()).nodes);
});
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Menu missing | `manifest.backend === true`, plugin enabled, `init()` ran, `GET /api/admin/system/menu/nodes?namespace=main` |
| Wrong order | Set explicit `order`; lower first; verify parent chain |
| Icon blank | Valid Lucide name; check console for import errors |
| Stale entry on rebuild | Add idempotent cleanup in `init()` and removal in `disable()` |

## Reference Files

- `src/backend/modules/menu/services/menu.service.ts` — service implementation
- `src/backend/modules/menu/api/menu.controller.ts` — REST endpoints
- `packages/types/src/menu/IMenuService.ts` — service interface
- `packages/types/src/menu/IMenuNode.ts` — node data structure
- [Menu Module README](../../src/backend/modules/menu/README.md) — full module documentation
