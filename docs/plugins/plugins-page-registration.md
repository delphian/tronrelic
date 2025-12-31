# Plugin Menu and Page System

TronRelic's plugin menu and page system enables plugins to extend the application UI by registering navigation menu items through the backend `IMenuService` and routable pages declaratively. This keeps the navigation and routing infrastructure centralized while allowing plugins to own their complete feature sets.

## Why This System Exists

Before this system, adding new pages required manually editing:
- Navigation components to add menu items
- Route configuration files to map URLs to components
- Multiple core files scattered across the codebase

The menu/page system solves this by:
- **Centralizing discovery** - Plugins register menu items via backend service and declare pages in frontend manifests
- **Eliminating core changes** - New features require zero modifications to navigation or routing
- **Enabling modularity** - Features can be enabled/disabled by simply installing/removing plugins
- **Supporting dynamic loading** - Pages and menus are discovered at runtime

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

**See [system-modules-menu.md](../system/system-modules-menu.md) for complete IMenuService documentation.**

### 2. Page Registration (IPageConfig)

Plugins declare routable pages in their frontend manifest:
```typescript
interface IPageConfig {
    path: string;               // URL route
    component: ComponentType;   // React component
    title?: string;             // Page title (metadata)
    description?: string;       // Page description (metadata)
    requiresAuth?: boolean;     // Authentication required
    requiresAdmin?: boolean;    // Admin privileges required
}
```

### 3. Plugin Loader Integration

The `PluginLoader` component (in `apps/frontend/components/plugins/PluginLoader.tsx`) automatically registers plugins with the menu/page system:

1. Fetches plugin manifests from backend
2. Lazy loads frontend plugin modules
3. Registers each plugin with `pluginRegistry`
4. Renders plugin components

This ensures all plugin UI surfaces are discovered before the app renders navigation or routes.

### 4. Dynamic Routing

Two systems consume the registry:

**NavBar** (`apps/frontend/components/layout/NavBar.tsx`):
- Merges core navigation links with plugin menu items
- Sorts combined items by order property
- Renders clickable navigation links
- Respects adminOnly and other access controls

**Dynamic Route Handler** (`apps/frontend/app/(core)/[...plugin]/page.tsx`):
- Catches all plugin page requests via Next.js catch-all route
- Looks up page configuration by URL path
- Renders the associated React component
- Shows loading states and 404 errors

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

2. **PluginLoader discovers pages** at runtime:
   - Fetches manifests from `/api/plugins/manifests`
   - Filters for plugins with `frontend: true`
   - Lazy loads the plugin module
   - Calls `pluginRegistry.registerPlugin(myPlugin)`

3. **Registry stores page configuration**:
   - Extracts pages array
   - Makes them available via `getPageByPath()`
   - Dynamic route handler uses registry for lookups

### URL Routing Flow

When a user navigates to `/my-feature`:

1. Next.js matches the catch-all route `[...plugin]/page.tsx`
2. Dynamic route handler extracts path from URL params
3. Calls `pluginRegistry.getPageByPath('/my-feature')`
4. Retrieves page config with component
5. Renders: `<MyFeaturePage />`

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
import { definePlugin, type IPluginContext } from '@tronrelic/types';
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

        // Register admin settings menu item
        await context.menuService.create({
            namespace: 'main',
            label: 'My Settings',
            url: '/my-settings',
            icon: 'Settings',
            order: 150,
            parent: null,
            enabled: true
            // Note: Access control is handled at page level, not menu level
        });

        context.logger.info('Menu items registered');
    }
});
```

### Step 2: Declare Pages in Frontend

In your plugin's `src/frontend/frontend.ts`:

```typescript
import { definePlugin } from '@tronrelic/types';
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

import type { IFrontendPluginContext } from '@tronrelic/types';

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

1. Build your plugin: `npm run build --workspace packages/plugins/my-plugin`
2. Generate frontend registry: `npm run generate:plugins --workspace apps/frontend`
3. Restart the app: `./scripts/start.sh`
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
import type { IFrontendPluginContext } from '@tronrelic/types';

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

### Page with Metadata

Add SEO and metadata:

```typescript
pages: [
    {
        path: '/my-page',
        component: MyPageComponent,
        title: 'My Feature - TronRelic',
        description: 'Explore my feature with detailed analytics'
    }
]
```

### Page with API and Charts

Use injected context for data fetching and visualization:

```typescript
import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';

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

See `packages/plugins/example-dashboard` for a complete working example that demonstrates:

- Menu item registration
- Page routing
- Component structure
- Documentation

The example plugin adds an "Example" menu item and renders a dashboard page explaining the system.

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
3. Verify plugin registered successfully (check React DevTools)
4. Ensure dynamic route exists at `app/(core)/[...plugin]/page.tsx`
5. Look for path lookup errors in console
6. Verify frontend plugin has `manifest.frontend === true`

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

**See [system-modules-menu.md](../system/system-modules-menu.md) for complete WebSocket event documentation.**

## Future Enhancements

Planned improvements to the menu/page system:

### ✅ Implemented

- **Hierarchical menus** - Container nodes with parent-child relationships (via IMenuService)
- **WebSocket updates** - Real-time menu updates when plugins register/unregister
- **Icon rendering** - Full Lucide icon support in NavBar

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

**Dynamic Metadata** - Automatic Next.js metadata generation from page configs:

```typescript
// Generates:
// export const metadata = { title: '...', description: '...' }
```

**Permission-Based Visibility** - Hide menu items based on user permissions:

```typescript
await context.menuService.create({
    namespace: 'main',
    label: 'Admin Panel',
    url: '/admin',
    icon: 'Shield',
    order: 200,
    parent: null,
    enabled: true,
    requiresAdmin: true  // Completely hidden if not admin
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
  - `apps/backend/src/modules/menu/menu.service.ts` - MenuService implementation
  - `apps/backend/src/modules/menu/menu.routes.ts` - REST API endpoints
  - `packages/types/src/menu/IMenuService.ts` - Menu service interface
  - **See [system-modules-menu.md](../system/system-modules-menu.md) for complete documentation**

- **Type definitions**:
  - `packages/types/src/plugin/IPageConfig.ts` - Page config interface
  - `packages/types/src/plugin/IPlugin.ts` - Plugin definition (includes pages)
  - `packages/types/src/observer/IPluginContext.ts` - Backend context with menuService

- **Page registry system**:
  - `apps/frontend/lib/pluginRegistry.ts` - Plugin page registry
  - `apps/frontend/components/plugins/PluginLoader.tsx` - Plugin loader with registry integration

- **UI integration**:
  - `apps/frontend/components/layout/NavBar.tsx` - Navigation with WebSocket menu updates
  - `apps/frontend/app/(core)/[...plugin]/page.tsx` - Dynamic route handler

- **Example plugins**:
  - `packages/plugins/resource-tracking/` - Uses IMenuService with hierarchical menus
  - `packages/plugins/example-dashboard/` - Basic example

## Best Practices

When building plugins with UI:

1. **Register menus in backend**: Use `context.menuService.create()` in `init()` hook, not declarative `menuItems`
2. **Keep paths consistent**: Match backend menu `url` with frontend page `path` exactly
3. **Use semantic ordering**: Choose order values that leave room for future plugins (0-9 core, 10-99 features, 100+ admin)
4. **Create hierarchies**: Use container nodes (no `url`) to group related menu items
5. **Require backend flag**: Set `manifest.backend = true` even if plugin only registers menus
6. **Provide metadata**: Always include page titles and descriptions for SEO
7. **Handle loading states**: Pages should show spinners during data fetching
8. **Error boundaries**: Wrap page content in error boundaries for resilience
9. **Responsive design**: Ensure pages work on mobile and desktop
10. **Document your UI**: Add README.md explaining your plugin's pages and navigation structure

## Testing and Verification

After implementing a plugin with menu items and pages, verify it works correctly:

### 1. Build and Install Plugin

```bash
# Build plugin
npm run build --workspace packages/plugins/my-plugin

# Generate frontend registry
npm run generate:plugins --workspace apps/frontend

# Restart application
./scripts/start.sh
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
- `apps/backend/src/modules/menu/menu.service.ts` - MenuService singleton implementation
- `apps/backend/src/modules/menu/menu.routes.ts` - REST API endpoints
- `apps/backend/src/modules/menu/menu.model.ts` - MongoDB schema
- `packages/types/src/menu/IMenuService.ts` - Service interface
- `packages/types/src/menu/IMenuNode.ts` - Menu node data structure

### Type Definitions
- `packages/types/src/plugin/IPageConfig.ts` - Page configuration interface
- `packages/types/src/plugin/IPlugin.ts` - Plugin definition (includes pages)
- `packages/types/src/observer/IPluginContext.ts` - Backend context with menuService
- `packages/types/src/plugin/index.ts` - Type exports

### Frontend Infrastructure
- `apps/frontend/lib/pluginRegistry.ts` - Plugin page registry singleton
- `apps/frontend/components/plugins/PluginLoader.tsx` - Plugin loader with registry integration
- `apps/frontend/components/layout/NavBar.tsx` - Navigation with WebSocket menu updates
- `apps/frontend/app/(core)/[...plugin]/page.tsx` - Dynamic route handler
- `apps/frontend/components/plugins/plugins.generated.ts` - Auto-generated plugin loaders

### Example Plugins
- `packages/plugins/resource-tracking/` - Complete example with IMenuService
  - `src/backend/backend.ts` - Menu registration in init() hook
  - `src/frontend/frontend.ts` - Page registration
  - Demonstrates hierarchical menus with container nodes
- `packages/plugins/example-dashboard/` - Basic example

## Related Documentation

**System documentation:**
- [system-modules-menu.md](../system/system-modules-menu.md) - Menu module architecture, REST API endpoints, and WebSocket events

**Plugin documentation:**
- [plugins.md](./plugins.md) - Plugin system overview
- [plugins-system-architecture.md](./plugins-system-architecture.md) - Plugin package structure and lifecycle hooks
- [plugins-frontend-context.md](./plugins-frontend-context.md) - Frontend dependency injection and UI components

**Frontend documentation:**
- [frontend.md](../frontend/frontend.md) - Frontend architecture overview
- [ui-component-styling.md](../frontend/ui/ui-component-styling.md) - Component styling and design system
