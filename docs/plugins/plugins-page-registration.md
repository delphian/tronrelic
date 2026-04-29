# Plugin Menu and Page System

TronRelic's plugin menu and page system enables plugins to extend the application UI by registering navigation menu items through the backend `IMenuService` and routable pages declaratively. This keeps the navigation and routing infrastructure centralized while allowing plugins to own their complete feature sets.

## Why This System Exists

Adding new pages previously required editing navigation components, route configuration files, and multiple core files. The menu/page system centralizes this so plugins register their own menu items via `IMenuService` and declare routable pages in their frontend manifest — no core code changes required.

## Menu Registration: IMenuService vs Declarative

TronRelic supports two menu registration approaches:

1. **IMenuService (Recommended)** - Register menu items in backend plugin `init()` hook using `context.menuService.create()`. Provides full control over menu hierarchy, ordering, and runtime updates.

2. **Declarative menuItems (Legacy)** - Define menu items in frontend plugin manifest. Simple but limited - no hierarchical menus, no runtime updates, and redundant with backend menu service.

**This guide documents the recommended IMenuService approach.** All new plugins should use backend menu registration for consistency with existing plugins like resource-tracking.

## Architecture Overview

The system consists of three main components:

### 1. Backend Menu Service (IMenuService)

Plugins register menu items through `context.menuService` in their backend `init()` hook:

```typescript
// In backend plugin init() hook
await context.menuService.create({
    namespace: 'main',       // Menu context ('main', 'admin', etc.)
    label: 'My Feature',     // Display text
    url: '/my-feature',      // URL path
    icon: 'Activity',        // Lucide icon name
    order: 30,               // Sort position (lower = earlier)
    parent: null,            // Parent menu item ID (null = top-level)
    enabled: true            // Visibility toggle
});
```

**See [Menu Module README](../../src/backend/modules/menu/README.md) for complete IMenuService documentation.**

### 2. Page Registration (IPageConfig)

Plugins declare routable pages in their frontend manifest:
```typescript
interface IPageConfig {
    path: string;                 // URL route
    component: ComponentType;     // React component
    title?: string;               // Page title (metadata)
    description?: string;         // Page description (metadata)
    keywords?: string[];          // SEO keywords
    ogImage?: string;             // Open Graph image
    ogType?: 'website' | 'article';
    canonical?: string;           // Canonical URL override
    noindex?: boolean;            // Set true on admin pages
    structuredData?: Record<string, unknown>;  // Schema.org JSON-LD
    serverDataFetcher?: (ctx) => Promise<unknown>;  // SSR data hook
    requiresAuth?: boolean;       // Authentication required
    requiresAdmin?: boolean;      // Admin privileges required
}
```

**For SEO fields and the `serverDataFetcher` SSR pattern in detail (with bazi-fortune as the canonical example), see [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md).** This guide focuses on routing and menu integration; SEO and server-side data fetching live in the dedicated doc.

### 3. Plugin Registry Bootstrap

Plugin frontends are statically imported into `src/frontend/components/plugins/plugins.generated.ts` by the `generate:plugins` script and registered with `pluginRegistry` (`src/frontend/lib/pluginRegistry.ts`) at module load time. The registry is populated synchronously on both server and client — no fetch, no polling, no loading flash.

The `PluginLoader` component (`src/frontend/components/plugins/PluginLoader.tsx`) no longer loads plugins. Its only remaining job is to mount the global side-effect components some plugins ship (toast handlers, notification listeners) and to filter them by enabled state via a single `/api/plugins/manifests` fetch.

### 4. Dynamic Routing

Two systems consume the registry:

**NavBar** (`src/frontend/components/layout/NavBar.tsx`):
- Merges core navigation links with plugin menu items
- Sorts combined items by order property
- Renders clickable navigation links
- Respects adminOnly and other access controls

**Catch-all Route Handler** (`src/frontend/app/[...slug]/page.tsx`):
- Catches all plugin page requests via Next.js catch-all route
- Resolves the page through the server-side registry (`src/frontend/lib/serverPluginRegistry.ts`), filtering by currently-enabled plugin manifests
- Calls `notFound()` server-side for unknown URLs and disabled plugins
- Generates `<head>` metadata from `IPageConfig` SEO fields and awaits `serverDataFetcher` to forward `initialData` to the page component

## How It Works

### Menu Registration Flow (Backend)

1. **Plugin registers menu in backend init() hook**:
```typescript
export const myBackendPlugin = definePlugin({
    manifest: myManifest,

    init: async (context: IPluginContext) => {
        // Register menu item with IMenuService
        await context.menuService.create({
            namespace: 'main',
            label: 'My Feature',
            url: '/my-feature',
            icon: 'Activity',
            order: 30,
            parent: null,
            enabled: true
        });

        context.logger.info('Menu item registered');
    }
});
```

2. **MenuService stores menu node**:
   - Creates database entry (or memory-only based on config)
   - Assigns unique ObjectId
   - Emits WebSocket event: `menu:updated`

3. **Frontend NavBar receives update**:
   - Subscribes to `menu:updated` WebSocket event
   - Fetches fresh menu items from `/api/admin/system/menu/nodes?namespace=main`
   - Re-renders navigation with new item

### Page Registration Flow (Frontend)

1. **Plugin declares pages** in frontend entry:
```typescript
export const myFrontendPlugin = definePlugin({
    manifest: myManifest,

    // No menuItems - registered via backend
    pages: [
        {
            path: '/my-feature',
            component: MyFeaturePage,
            title: 'My Feature Dashboard'
        }
    ]
});
```

2. **Generator script picks up the new plugin** at build time:
   - `generate:plugins` reads each plugin's `package.json` `exports."./frontend"` field. New plugins ship a compiled entry (`dist/frontend/frontend.js`); legacy plugins still on source mode fall back to `src/frontend/frontend.ts`. See [plugins-system-architecture.md](./plugins-system-architecture.md#frontend-build) for the build pipeline.
   - Emits a static-import line into `src/frontend/components/plugins/plugins.generated.ts`
   - The registry is populated at module load via `pluginRegistry.bootstrap()`

3. **Catch-all route resolves the page** server-side:
   - `getEnabledPluginPageConfig(slug)` looks up the path in the server-side registry
   - Filters by the currently-enabled plugin manifests
   - Returns `null` for disabled plugins, triggering `notFound()`

### URL Routing Flow

When a user navigates to `/my-feature`:

1. Next.js matches the catch-all route `app/[...slug]/page.tsx`
2. The route resolves the slug via `getEnabledPluginPageConfig('/my-feature')`
3. `generateMetadata` reads `IPageConfig` SEO fields and emits the `<head>` metadata
4. The page render awaits `serverDataFetcher` (if defined) and forwards `initialData`
5. `<PluginPageHandler>` looks the page up synchronously in the client registry and renders `<MyFeaturePage context={...} initialData={...} />`

### Menu Rendering Flow

When the NavBar mounts and when plugins are registered:

1. NavBar subscribes to `pluginRegistry` on mount
2. Fetches core navigation links (hardcoded defaults)
3. Calls `pluginRegistry.getMenuItems()` for plugin menu items
4. Merges core + plugin items and sorts by `order` property
5. Renders `<Link>` for each item
6. **When new plugins register**, registry notifies NavBar
7. NavBar re-fetches menu items and re-renders with new links
8. Subscription is cleaned up when NavBar unmounts

## Creating a Plugin with Menu and Page

Follow this pattern to add UI to a plugin:

### Step 1: Register Menu in Backend

In your plugin's `src/backend/backend.ts`:

```typescript
import { definePlugin, type IPluginContext } from '@/types';
import { myManifest } from '../manifest.js';

export const myBackendPlugin = definePlugin({
    manifest: myManifest,

    init: async (context: IPluginContext) => {
        // Register navigation menu item
        await context.menuService.create({
            namespace: 'main',
            label: 'My Dashboard',
            url: '/my-dashboard',
            icon: 'BarChart3',
            order: 30,
            parent: null,
            enabled: true
        });

        // Register admin settings menu item under the System container.
        // The menu service walks the parent chain on create and forces
        // requiresAdmin: true on anything below the container. Don't
        // set the flag yourself — the engine handles it, and that's
        // what makes the gate non-bypassable.
        await context.menuService.create({
            namespace: 'main',
            label: 'My Settings',
            url: '/my-settings',
            icon: 'Settings',
            order: 150,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });

        context.logger.info('Menu items registered');
    }
});
```

### Admin Menu Items

Plugins that ship admin surfaces (settings pages, internal dashboards,
moderation tools) parent their menu entries under the System container
in `main` rather than registering into a separate namespace. The System
container's id is the fixed sentinel `MAIN_SYSTEM_CONTAINER_ID`
(a 24-hex ObjectId string), exported from the menu module — import it
from `'../menu/index.js'` (relative path varies by plugin location)
and use the constant rather than hardcoding the value. The id is hex
so it satisfies the menu controller's `OBJECT_ID_REGEX` validation and
the persistence layer's `new ObjectId(parent)` conversion without
special-casing. The menu service seeds the container during
`MenuModule.run()`, so it is always present by the time plugin `init`
hooks run.

The admin gate (`requiresAdmin: true`) is auto-applied by the menu
service: `MenuService.create` and `MenuService.update` walk the parent
chain on every write and force the flag on any node whose ancestor
chain reaches the container. Plugin code should not set the flag
explicitly, and should not try to bypass it by setting
`requiresAdmin: false` — the engine overrides caller input either way.
This keeps gating impossible to misconfigure: a forgotten flag, a typo,
or a copy-paste from a non-admin entry all still produce a properly
gated node, as long as the parent relationship is correct.

Reads are filtered per-user via `MenuService.getTreeForUser` against
the cookie-resolved visitor. An anonymous visitor or a non-admin user
never sees the System container or its descendants in the API
response; an admin sees them inline with the rest of the main
navigation. There is no separate admin namespace and no separate
admin-only API endpoint — the existing public read path returns the
right tree shape for whoever asked.

### Step 2: Declare Pages in Frontend

In your plugin's `src/frontend/frontend.ts`:

```typescript
import { definePlugin } from '@/types';
import { myManifest } from '../manifest';
import { MyDashboardPage } from './MyDashboardPage';
import { MySettingsPage } from './MySettingsPage';

export const myFrontendPlugin = definePlugin({
    manifest: myManifest,

    // No menuItems - registered via backend IMenuService
    pages: [
        {
            path: '/my-dashboard',
            component: MyDashboardPage,
            title: 'My Dashboard',
            description: 'Analytics dashboard for my feature'
        },
        {
            path: '/my-settings',
            component: MySettingsPage,
            title: 'Settings',
            requiresAdmin: true
        }
    ]
});
```

### Step 3: Implement Page Components

Create React components for each page. **All page components must accept `context` prop**:

```typescript
// src/frontend/MyDashboardPage.tsx
'use client';

import type { IFrontendPluginContext } from '@/types';

/**
 * My Dashboard Page.
 *
 * Receives IFrontendPluginContext as a prop, providing access to UI components,
 * API client, charts, and WebSocket. Do NOT import from apps/frontend directly.
 */
export function MyDashboardPage({ context }: { context: IFrontendPluginContext }) {
    const { ui } = context;

    return (
        <div className="container mx-auto px-4 py-8">
            <ui.Card>
                <h1 className="text-4xl font-bold mb-4">My Dashboard</h1>
                <p>Dashboard content goes here...</p>
            </ui.Card>
        </div>
    );
}
```

See [Plugin Frontend Context](./plugins-frontend-context.md) for complete examples of using the context.

### Step 4: Set Frontend Flag in Manifest

Ensure your manifest declares both frontend and backend support:

```typescript
export const myManifest: IPluginManifest = {
    id: 'my-plugin',
    title: 'My Plugin',
    version: '1.0.0',
    frontend: true,  // Required for pages
    backend: true    // Required for menu registration
};
```

### Step 5: Build and Enable Plugin

1. Build your plugin: `npm run build --workspace src/plugins/my-plugin`
2. Generate frontend registry: `npm run generate:plugins`
3. Restart the app (Ctrl+C then `npm run dev`)
4. Navigate to `/system/plugins` admin UI
5. Install and enable your plugin

When enabled, the backend `init()` hook will:
- Register menu items with IMenuService
- Emit WebSocket events to update frontend NavBar
- Frontend will automatically discover and route pages

## Menu Organization

### Hierarchical Menus with Container Nodes

Create nested menus by setting the `parent` property to a container node's ID:

```typescript
// Backend plugin init() hook

// 1. Create container node (no URL)
const analyticsCategory = await context.menuService.create({
    namespace: 'main',
    label: 'Analytics',
    icon: 'BarChart3',
    order: 30,
    parent: null,
    enabled: true
    // No url - this is a container/category node
});

// 2. Create child items under container
await context.menuService.create({
    namespace: 'main',
    label: 'Dashboard',
    url: '/analytics/dashboard',
    icon: 'LayoutDashboard',
    order: 10,
    parent: analyticsCategory._id!,  // Nest under Analytics
    enabled: true
});

await context.menuService.create({
    namespace: 'main',
    label: 'Reports',
    url: '/analytics/reports',
    icon: 'FileText',
    order: 20,
    parent: analyticsCategory._id!,  // Nest under Analytics
    enabled: true
});
```

**Container nodes** (no `url` field) group child items. **Leaf nodes** (with `url` field) link to pages.

### Ordering

Control menu item position with the `order` property:

- **0-9**: Core/primary navigation (Overview, Markets, etc.)
- **10-99**: Feature plugins
- **100+**: Admin and system pages

Lower numbers appear first. Items without `order` default to 999 (end of list).

### Access Control

Menu items are always visible. Access control happens at the page level:

```typescript
// Page requires admin authentication
pages: [
    {
        path: '/admin/settings',
        component: AdminSettings,
        requiresAdmin: true  // Enforced by page, not menu
    }
]
```

**Rationale**: The MenuService manages structure, not authorization. Page-level guards prevent unauthorized access even if users navigate directly to URLs.

## Page Configuration

**Important**: All plugin page components receive `IFrontendPluginContext` as a prop. This provides access to UI components, API client, charts, and WebSocket through dependency injection. See [Plugin Frontend Context](./plugins-frontend-context.md) for details.

### Basic Page

Minimum configuration:

```typescript
import type { IFrontendPluginContext } from '@/types';

// Page component receives context prop
function MyPageComponent({ context }: { context: IFrontendPluginContext }) {
    return (
        <context.ui.Card>
            <h1>My Page</h1>
        </context.ui.Card>
    );
}

pages: [
    {
        path: '/my-page',
        component: MyPageComponent
    }
]
```

### Page with SEO and SSR

Plugin pages can declare full SEO metadata (title, description, keywords, ogImage, structuredData, noindex) and a `serverDataFetcher` for pre-fetching body data server-side. The catch-all route reads these fields during SSR, populates `<head>` via Next.js Metadata, and forwards `serverDataFetcher`'s return value to the page component as `initialData`.

**See [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) for the full reference**, including the SEO field table, the `serverDataFetcher` contract, common pitfalls (timezone-sensitive data, JSON serialization), and bazi-fortune as the canonical implementation example.

### Page with API and Charts

Use injected context for data fetching and visualization:

```typescript
import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@/types';

function AnalyticsPage({ context }: { context: IFrontendPluginContext }) {
    const { ui, charts, api } = context;
    const [data, setData] = useState([]);

    useEffect(() => {
        async function loadData() {
            const result = await api.get('/plugins/my-plugin/metrics');
            setData(result.metrics);
        }
        void loadData();
    }, [api]);

    return (
        <div className="page">
            <ui.Card>
                <h1>Analytics</h1>
                <charts.LineChart
                    series={[{
                        id: 'metrics',
                        label: 'Activity',
                        data: data
                    }]}
                />
            </ui.Card>
        </div>
    );
}

pages: [
    {
        path: '/analytics',
        component: AnalyticsPage,
        title: 'Analytics Dashboard'
    }
]
```

### Protected Page

Require authentication or admin:

```typescript
pages: [
    {
        path: '/admin/dashboard',
        component: AdminDashboard,
        requiresAuth: true,
        requiresAdmin: true
    }
]
```

**Note**: These flags are declarative but enforcement must be implemented in the page component or middleware. Future enhancements will add automatic route guards.

## Icons

Menu items support icons from [Lucide React](https://lucide.dev/icons):

```typescript
// Backend plugin init() hook
await context.menuService.create({
    namespace: 'main',
    label: 'Dashboard',
    url: '/dashboard',
    icon: 'LayoutDashboard',  // Lucide icon name
    order: 10,
    parent: null,
    enabled: true
});
```

Common icons: `LayoutDashboard`, `BarChart3`, `Settings`, `Bell`, `Activity`, `TrendingUp`, `FileText`

**See [Lucide Icons](https://lucide.dev/icons) for complete list.**

## Example: Full Plugin

> If `src/plugins/trp-ai-assistant/` is not present in your checkout, populate `src/plugins/` by running `./scripts/setup.sh` (driven by `plugins.json`) before following along.

See `src/plugins/trp-ai-assistant` for the canonical reference implementation demonstrating:

- Menu item registration in the backend `init()` hook via `context.menuService.create()`
- Admin page registration with the `adminPages` array (auto-guarded by admin auth)
- Global side-effect component via the plugin's top-level `component` property
- Stale menu cleanup during init to handle version upgrades
- Lifecycle-aware teardown (`disable` removes the menu entry and unregisters the service)

## Migration from AdminUI and Declarative MenuItems

### From AdminUI (Deprecated)

The older `adminUI` property is deprecated in favor of backend menu registration + frontend pages:

**Old approach:**
```typescript
adminUI: {
    path: '/admin/my-feature',
    icon: 'Activity',
    component: MyComponent
}
```

**New approach:**
```typescript
// Backend: src/backend/backend.ts
init: async (context: IPluginContext) => {
    await context.menuService.create({
        namespace: 'main',
        label: 'My Feature',
        url: '/admin/my-feature',
        icon: 'Activity',
        order: 150,
        parent: null,
        enabled: true
    });
}

// Frontend: src/frontend/frontend.ts
pages: [
    {
        path: '/admin/my-feature',
        component: MyComponent,
        requiresAdmin: true
    }
]
```

### From Declarative MenuItems (Legacy)

The declarative `menuItems` array in frontend plugin manifests still works but is not recommended:

**Legacy approach (works but not recommended):**
```typescript
// Frontend only
menuItems: [
    {
        label: 'My Feature',
        href: '/my-feature',
        icon: 'Activity',
        order: 30
    }
]
```

**Recommended approach:**
```typescript
// Backend init() hook
await context.menuService.create({
    namespace: 'main',
    label: 'My Feature',
    url: '/my-feature',
    icon: 'Activity',
    order: 30,
    parent: null,
    enabled: true
});
```

**Why IMenuService is better:**
- Hierarchical menus with container nodes
- Runtime menu updates via WebSocket
- Consistent with existing plugins (resource-tracking, etc.)
- Single source of truth in backend
- Database persistence for menu state

## Troubleshooting

### Menu item doesn't appear

1. Check `manifest.backend === true` (required for IMenuService)
2. Verify plugin is **enabled** in `/system/plugins` admin UI
3. Check backend logs for `init()` hook execution
4. Verify `context.menuService.create()` was called successfully
5. Check menu API: `GET /api/admin/system/menu/nodes?namespace=main` (requires admin token)
6. Look for WebSocket `menu:updated` events in browser console
7. Verify frontend NavBar is subscribed to menu updates

### Page shows 404

1. Confirm page `path` in frontend matches menu item `url` in backend
2. Check `pages` array includes the route
3. Verify the plugin is enabled in `/system/plugins` — disabled plugins return 404 server-side
4. Confirm `plugins.generated.ts` includes the plugin (re-run `npm run generate:plugins` if missing)
5. Verify frontend plugin has `manifest.frontend === true`

### Menu items in wrong order

1. Set explicit `order` properties when calling `context.menuService.create()`
2. Remember lower numbers appear first
3. Check parent-child relationships for nested menus
4. Verify menu API returns correct order: `GET /api/admin/system/menu/nodes?namespace=main`

### Icons not displaying

Icons are specified by Lucide icon names (e.g., `'Activity'`, `'BarChart3'`). Ensure:
1. Icon name is valid Lucide icon (see https://lucide.dev/icons)
2. NavBar component renders icons correctly
3. Check browser console for icon import errors

## Advanced: WebSocket Menu Updates

The menu system uses WebSocket events for real-time updates. When a plugin registers menu items:

1. Backend calls `context.menuService.create()`
2. MenuService emits `menu:updated` WebSocket event
3. Frontend NavBar subscribes to `menu:updated`
4. NavBar fetches fresh menu data via API
5. NavBar re-renders with new menu items

**Custom components can subscribe to menu updates:**

```typescript
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export function MyCustomMenu() {
    const [menuItems, setMenuItems] = useState([]);

    useEffect(() => {
        const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL);

        // Listen for menu updates
        socket.on('menu:updated', async () => {
            // Fetch fresh menu data
            const response = await fetch('/api/admin/system/menu/nodes?namespace=main');
            const data = await response.json();
            setMenuItems(data.nodes);
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    return (
        <div>
            {menuItems.map(item => (
                <div key={item._id}>{item.label}</div>
            ))}
        </div>
    );
}
```

**See [Menu Module README](../../src/backend/modules/menu/README.md) for complete WebSocket event documentation.**

## Future Enhancements

Planned improvements to the menu/page system:

### ✅ Implemented

- **Hierarchical menus** - Container nodes with parent-child relationships (via IMenuService)
- **WebSocket updates** - Real-time menu updates when plugins register/unregister
- **Icon rendering** - Full Lucide icon support in NavBar
- **Dynamic metadata** - Automatic Next.js metadata generation from `IPageConfig` SEO fields, including OpenGraph tags, Twitter cards, JSON-LD structured data, and per-page `noindex`. See [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md).
- **Server-side data fetching** - `IPageConfig.serverDataFetcher` for pre-fetching plugin page data during SSR, eliminating the loading flash on plugin pages. See [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md).

### ✅ Implemented (cont.)

**Per-user menu visibility gating** — Menu nodes carry three optional
gating fields that the backend evaluates against the cookie-resolved
visitor at read time: `allowedIdentityStates: UserIdentityState[]` (allow-list
of `'anonymous' | 'registered' | 'verified'`), `requiresGroups: string[]`
(OR-of-membership across admin-defined groups), and `requiresAdmin: boolean`
(routes through `IUserGroupService.isAdmin`). The filter is in
`MenuService.getTreeForUser`; the admin UI surfaces the fields as a
checkbox/multi-select fieldset on `/system/menu`. See the
[Menu Module README → Visibility Gating](../../src/backend/modules/menu/README.md#visibility-gating)
for the full contract. Note the menu config's `requiresAdmin` is purely a
visibility predicate (resolves through `IUserGroupService.isAdmin` against
the cookie-identified visitor) and is unrelated to the `requireAdmin`
middleware that gates HTTP routes. The middleware admits *either* a Verified
admin user via cookie *or* a service token via `x-admin-token` — see
[plugins-api-registration.md](./plugins-api-registration.md) and
[admin authentication — dual-track](../../src/backend/modules/user/README.md#admin-authentication--dual-track).

### 🚧 Planned

**Route Guards** - Automatic enforcement of `requiresAuth` and `requiresAdmin`:

```typescript
pages: [
    {
        path: '/admin/users',
        component: UserManagement,
        requiresAdmin: true  // Auto-redirect if not admin
    }
]
```

Plugin-registered menu nodes can use the same gating fields documented in
the [Menu Module README → Visibility Gating](../../src/backend/modules/menu/README.md#visibility-gating).
Pass `allowedIdentityStates`, `requiresGroups`, and/or `requiresAdmin`
directly to `context.menuService.create()`:

```typescript
// Hidden from anonymous and registered visitors
await context.menuService.create({
    namespace: 'main',
    label: 'Premium Tools',
    url: '/plugins/my-plugin/premium',
    icon: 'Sparkles',
    order: 200,
    parent: null,
    enabled: true,
    allowedIdentityStates: [UserIdentityState.Verified]
});

// Visible only to admins (per-user check via IUserGroupService.isAdmin)
await context.menuService.create({
    namespace: 'main',
    label: 'Plugin Admin',
    url: '/plugins/my-plugin/admin',
    icon: 'Shield',
    order: 250,
    parent: null,
    enabled: true,
    requiresAdmin: true
});
```

**Breadcrumbs** - Automatic breadcrumb generation from menu hierarchy:

```typescript
// On /analytics/reports:
// Home > Analytics > Reports
```

## Reference Files

Core implementation files:

- **Backend menu service**:
  - `src/backend/src/modules/menu/menu.service.ts` - MenuService implementation
  - `src/backend/src/modules/menu/menu.routes.ts` - REST API endpoints
  - `packages/types/src/menu/IMenuService.ts` - Menu service interface
  - **See [Menu Module README](../../src/backend/modules/menu/README.md) for complete documentation**

- **Type definitions**:
  - `packages/types/src/plugin/IPageConfig.ts` - Page config interface
  - `packages/types/src/plugin/IPlugin.ts` - Plugin definition (includes pages)
  - `packages/types/src/observer/IPluginContext.ts` - Backend context with menuService

- **Page registry system**:
  - `src/frontend/lib/pluginRegistry.ts` - Client-side plugin registry, self-bootstrapped from `plugins.generated.ts`
  - `src/frontend/lib/serverPluginRegistry.ts` - Server-only registry that filters by enabled manifests
  - `src/frontend/components/plugins/plugins.generated.ts` - Auto-generated static-import registry
  - `src/frontend/components/plugins/PluginLoader.tsx` - Mounts global side-effect components for enabled plugins

- **UI integration**:
  - `src/frontend/components/layout/NavBar.tsx` - Navigation with WebSocket menu updates
  - `src/frontend/app/[...slug]/page.tsx` - Catch-all route handler (custom pages + plugin pages)
  - `src/frontend/components/PluginPageHandler.tsx` - Client-side synchronous registry lookup
  - `src/frontend/components/PluginPageWithZones.tsx` - Server wrapper with widget zones

- **Example plugins**:
  - `src/plugins/trp-ai-assistant/` - Canonical reference: admin page registration, menu registration via `context.menuService.create()`, global side-effect component
  - `src/plugins/resource-tracking/` - Uses IMenuService with hierarchical menus

## Best Practices

When building plugins with UI:

1. **Register menus in backend**: Use `context.menuService.create()` in `init()` hook, not declarative `menuItems`
2. **Keep paths consistent**: Match backend menu `url` with frontend page `path` exactly
3. **Use semantic ordering**: Choose order values that leave room for future plugins (0-9 core, 10-99 features, 100+ admin)
4. **Create hierarchies**: Use container nodes (no `url`) to group related menu items
5. **Require backend flag**: Set `manifest.backend = true` even if plugin only registers menus
6. **Provide metadata**: Always include page titles and descriptions for SEO
7. **Render with SSR data, not loading spinners**: Pre-fetch via `serverDataFetcher` and initialize state from `initialData` so the first render contains real content. See [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md). Loading spinners are only appropriate for user-triggered actions (form submission, pagination), not initial render
8. **Error boundaries**: Wrap page content in error boundaries for resilience
9. **Responsive design**: Ensure pages work on mobile and desktop
10. **Document your UI**: Add README.md explaining your plugin's pages and navigation structure

## Testing and Verification

After implementing a plugin with menu items and pages, verify it works correctly:

### 1. Build and Install Plugin

```bash
# Build plugin
npm run build --workspace src/plugins/my-plugin

# Generate frontend registry
npm run generate:plugins

# Restart application (Ctrl+C first if running, then:)
npm run dev
```

### 2. Enable Plugin

Navigate to `/system/plugins` admin UI:
- Find your plugin in the list
- Click "Install" (runs install hook)
- Click "Enable" (runs init hook and registers menus)

### 3. Verify Menu Registration

Check menu was registered via API:

```bash
# Requires ADMIN_API_TOKEN in .env
curl -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  http://localhost:4000/api/admin/system/menu/nodes?namespace=main | jq '.nodes[] | select(.label == "My Feature")'
```

Should return menu node with your label, url, icon, and order.

### 4. Check Backend Logs

Verify init() hook executed:

```bash
tail -100 .run/backend.log | grep "my-plugin"
# Should see: "Menu item registered" or similar log message
```

### 5. Test Frontend Navigation

- Look for your menu item in NavBar
- Click the menu item - should navigate to your page
- Navigate directly to the URL - should render your component
- Try invalid URLs - should show 404

### 6. Verify WebSocket Updates

Open browser console and watch for WebSocket events:

```javascript
// Should see menu:updated event when plugin enables
// NavBar should automatically re-fetch menu data
```

### 7. Check Console for Errors

Monitor the browser console for:
- Plugin loading errors (frontend)
- Menu registration failures (backend logs)
- Component rendering issues
- Route resolution problems

## Summary

The plugin menu and page system enables self-contained UI extension through:

1. **Backend menu registration** via `context.menuService.create()` in plugin `init()` hook
2. **Frontend page declaration** via `pages` array in frontend plugin manifest
3. **WebSocket synchronization** for real-time menu updates
4. **Dynamic routing** via Next.js catch-all route handler

This keeps the codebase modular, enables rapid feature development, and ensures plugins remain self-contained and easy to maintain.

**Key architectural decision:** Menus are registered in the backend (not frontend) because:
- Enables hierarchical menu structures with container nodes
- Provides runtime menu updates via WebSocket
- Maintains single source of truth in backend MenuService
- Allows database persistence for menu state
- Consistent with existing plugins (resource-tracking, etc.)

## Implementation Reference

For developers working on the plugin system itself, here are the key files:

### Backend Menu Service
- `src/backend/src/modules/menu/menu.service.ts` - MenuService singleton implementation
- `src/backend/src/modules/menu/menu.routes.ts` - REST API endpoints
- `src/backend/src/modules/menu/menu.model.ts` - MongoDB schema
- `packages/types/src/menu/IMenuService.ts` - Service interface
- `packages/types/src/menu/IMenuNode.ts` - Menu node data structure

### Type Definitions
- `packages/types/src/plugin/IPageConfig.ts` - Page configuration interface
- `packages/types/src/plugin/IPlugin.ts` - Plugin definition (includes pages)
- `packages/types/src/observer/IPluginContext.ts` - Backend context with menuService
- `packages/types/src/plugin/index.ts` - Type exports

### Frontend Infrastructure
- `src/frontend/lib/pluginRegistry.ts` - Client-side plugin registry singleton, self-bootstrapped at module load
- `src/frontend/lib/serverPluginRegistry.ts` - Server-only registry that filters by currently-enabled plugin manifests
- `src/frontend/components/plugins/PluginLoader.tsx` - Mounts global side-effect components for enabled plugins
- `src/frontend/components/PluginPageHandler.tsx` - Client-side synchronous registry lookup
- `src/frontend/components/PluginPageWithZones.tsx` - Server wrapper with widget zones
- `src/frontend/components/layout/NavBar.tsx` - Navigation with WebSocket menu updates
- `src/frontend/app/[...slug]/page.tsx` - Catch-all route handler (handles custom pages and plugin pages)
- `src/frontend/components/plugins/plugins.generated.ts` - Auto-generated static-import registry of all plugin frontends

### Example Plugins
- `src/plugins/trp-ai-assistant/` - Canonical reference
  - `src/backend/backend.ts` - Menu registration in init() hook, lifecycle-aware teardown
  - `src/frontend/frontend.ts` - `adminPages` registration plus global side-effect component
  - Demonstrates admin-only menus, stale menu cleanup, and service registry publication
- `src/plugins/resource-tracking/` - Hierarchical menus with container nodes

## Related Documentation

**System documentation:**
- [Menu Module README](../../src/backend/modules/menu/README.md) - Menu module architecture, REST API endpoints, and WebSocket events

**Plugin documentation:**
- [plugins.md](./plugins.md) - Plugin system overview
- [plugins-system-architecture.md](./plugins-system-architecture.md) - Plugin package structure and lifecycle hooks
- [plugins-frontend-context.md](./plugins-frontend-context.md) - Frontend dependency injection and UI components

**Frontend documentation:**
- [frontend.md](../frontend/frontend.md) - Frontend architecture overview
- [ui-scss-modules.md](../frontend/ui/ui-scss-modules.md) - SCSS Modules, naming conventions, and component styling workflow
