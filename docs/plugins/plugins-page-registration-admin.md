# Plugin Admin Pages

Admin surfaces — settings, internal dashboards, moderation tools — register through the same `IMenuService` and `pages` array as public pages, but parent under the System container so the menu engine and HTTP middleware auto-gate them.

## Why This Matters

Authorization that depends on plugin authors remembering to set `requiresAdmin: true` will eventually leak. The menu service walks the parent chain on every write and forces the flag on any node descending from the System container — a forgotten flag, a typo, or a copy-paste from a non-admin entry all still produce a properly gated node, as long as the parent relationship is correct. Admin HTTP routes mounted under `/api/plugins/<id>/system/**` get `requireAdmin` middleware automatically for the same reason. See [plugins-api-registration.md](./plugins-api-registration.md) for the dual-track HTTP gate.

## How It Works

Plugins parent admin menu entries under `MAIN_SYSTEM_CONTAINER_ID` — a fixed 24-hex sentinel exported from the menu module and seeded during `MenuModule.run()`, so it exists by the time `init()` runs. `MenuService.create/update` walks the parent chain and forces `requiresAdmin: true` on every descendant, overriding caller input either way. `MenuService.getTreeForUser` filters per-cookie at read time: anonymous and non-admin visitors never see the System subtree. There is no separate admin namespace and no separate API endpoint — the public read path returns the right shape for whoever asked.

The sentinel is the literal 24-hex string `'000000000000000000000001'`. The menu module exports it as `MAIN_SYSTEM_CONTAINER_ID` from `src/backend/modules/menu/constants.ts`, but plugins live outside the backend module-resolution graph and cannot import it through a `paths` alias. Hardcode the value; it is a fixed design-time contract that will not change.

```typescript
// src/backend/backend.ts
// Stable sentinel — see src/backend/modules/menu/constants.ts.
const MAIN_SYSTEM_CONTAINER_ID = '000000000000000000000001';

await context.menuService.create({
    namespace: 'main',
    label: 'My Settings',
    url: '/my-settings',
    icon: 'Settings',
    order: 150,
    parent: MAIN_SYSTEM_CONTAINER_ID,
    enabled: true
    // Do not set requiresAdmin — the engine forces it.
});
```

## Page Registration

Declare the corresponding page in the frontend manifest. Set `requiresAdmin: true` for clarity even though the auto-gate enforces independently:

```typescript
// src/frontend/frontend.ts
pages: [
    {
        path: '/my-settings',
        component: MySettingsPage,
        title: 'My Settings',
        requiresAdmin: true
    }
]
```

Some plugins use a separate `adminPages` array (see `trp-ai-assistant`); both patterns work and both auto-guard via admin auth.

## Component Pattern

Admin pages receive `IFrontendPluginContext` like any plugin page:

```typescript
'use client';
import type { IFrontendPluginContext } from '@/types';

export function MySettingsPage({ context }: { context: IFrontendPluginContext }) {
    return (
        <context.ui.Card>
            <h1>Settings</h1>
        </context.ui.Card>
    );
}
```

## Why Auto-Gating Is Non-Bypassable

Setting `requiresAdmin: false` explicitly in the create call does nothing — the engine overrides on every write. The id sentinel is hex so it satisfies the menu controller's `OBJECT_ID_REGEX` and the persistence layer's `new ObjectId(parent)` conversion without special-casing. Combined with the parent-chain walk, this means the only way to expose an admin entry to non-admins is to give it a non-System ancestor — which makes it not an admin entry by definition.

## Migration from `adminUI`

The deprecated `adminUI` property collapses into menu + page registration:

```typescript
// Old
adminUI: { path: '/admin/x', icon: 'Activity', component: X }

// New: backend menu + frontend page
await context.menuService.create({
    namespace: 'main', label: 'X', url: '/admin/x',
    icon: 'Activity', order: 150,
    parent: MAIN_SYSTEM_CONTAINER_ID, enabled: true
});
// pages: [{ path: '/admin/x', component: X, requiresAdmin: true }]
```

## Reference Files

- `src/backend/modules/menu/services/menu.service.ts` — parent-chain walk and admin-flag enforcement
- `src/backend/modules/menu/constants.ts` — `MAIN_SYSTEM_CONTAINER_ID` definition and the rationale for the hex sentinel
- `src/plugins/trp-ai-assistant/` — canonical reference for `adminPages` + `manifest.adminUrl` (the plugin intentionally surfaces only via the System Plugins page, not a custom System nav entry; also demonstrates teardown of stale legacy menu nodes during `init`)
- [Menu Module README → Visibility Gating](../../src/backend/modules/menu/README.md#visibility-gating) — full visibility contract
- [system-auth.md](../system/system-auth.md) — `requireAdmin` admits a Better Auth admin session OR the `ADMIN_API_TOKEN` service token
- [plugins-api-registration.md](./plugins-api-registration.md) — `/api/plugins/<id>/system/**` auto-gating
