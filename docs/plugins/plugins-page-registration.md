# Plugin Menu and Page System

TronRelic's plugin menu and page system enables plugins to extend the application UI by registering navigation menu items and routable pages. This keeps the navigation and routing infrastructure centralized while allowing plugins to own their complete feature sets.

## Why This System Exists

Before this system, adding new pages required manually editing:
- Navigation components to add menu items
- Route configuration files to map URLs to components
- Multiple core files scattered across the codebase

The menu/page system solves this by:
- **Centralizing discovery** - Plugins declare their UI surfaces in one place
- **Eliminating core changes** - New features require zero modifications to navigation or routing
- **Enabling modularity** - Features can be enabled/disabled by simply installing/removing plugins
- **Supporting dynamic loading** - Pages and menus are discovered at runtime

## Architecture Overview

The system consists of four main components:

### 1. Type Definitions

Plugins use two core interfaces to declare their UI:

**IMenuItemConfig** - Navigation menu items:
```typescript
interface IMenuItemConfig {
    label: string;           // Display text
    href: string;            // URL path
    icon?: string;           // Lucide icon name
    category?: string;       // Menu grouping
    order?: number;          // Sort position (lower = earlier)
    adminOnly?: boolean;     // Requires admin privileges
    featured?: boolean;      // Highlight the item
}
```

**IPageConfig** - Routable pages:
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

### 2. Plugin Registry

The `pluginRegistry` (in `apps/frontend/lib/pluginRegistry.ts`) aggregates menu items and pages from all loaded plugins:

- Stores plugin configurations in memory
- Provides lookup methods for navigation and routing
- Automatically sorts menu items by category and order
- Offers path-based page lookups for dynamic routing
- **Notifies subscribers when plugins are registered** - enabling reactive UI updates

The registry is populated by the PluginLoader during app initialization and provides these methods:

```typescript
pluginRegistry.registerPlugin(plugin);          // Register a plugin and notify subscribers
pluginRegistry.getMenuItems();                  // Get all menu items
pluginRegistry.getPages();                      // Get all pages
pluginRegistry.getPageByPath('/some-path');     // Find specific page
pluginRegistry.subscribe(callback);             // Subscribe to plugin registration events
pluginRegistry.clear();                         // Reset registry
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

**Dynamic Route Handler** (`apps/frontend/app/(dashboard)/[...plugin]/page.tsx`):
- Catches all plugin page requests via Next.js catch-all route
- Looks up page configuration by URL path
- Renders the associated React component
- Shows loading states and 404 errors

## How It Works

### Plugin Definition Flow

1. **Plugin declares UI surfaces** in its frontend entry:
```typescript
export const myPlugin = definePlugin({
    manifest: myManifest,
    menuItems: [
        {
            label: 'My Feature',
            href: '/my-feature',
            icon: 'Activity',
            order: 25
        }
    ],
    pages: [
        {
            path: '/my-feature',
            component: MyFeaturePage,
            title: 'My Feature Dashboard'
        }
    ]
});
```

2. **PluginLoader discovers the plugin** at runtime:
   - Fetches manifests from `/api/plugins/manifests`
   - Filters for plugins with `frontend: true`
   - Lazy loads the plugin module
   - Calls `pluginRegistry.registerPlugin(myPlugin)`

3. **Registry stores the configuration**:
   - Extracts menu items and pages
   - Sorts menu items by order and category
   - Makes them available via getter methods
   - **Notifies all subscribers that a new plugin was registered**

4. **UI components reactively update**:
   - NavBar subscribes to registry changes on mount
   - When notified, NavBar re-fetches menu items and re-renders
   - Dynamic route handler looks up pages by path on navigation
   - Components render based on current URL

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

### Step 1: Define Menu Items and Pages

In your plugin's `src/frontend/frontend.ts`:

```typescript
import { definePlugin } from '@tronrelic/types';
import { myManifest } from '../manifest';
import { MyDashboardPage } from './MyDashboardPage';
import { MySettingsPage } from './MySettingsPage';

export const myFrontendPlugin = definePlugin({
    manifest: myManifest,

    // Navigation menu items
    menuItems: [
        {
            label: 'My Dashboard',
            href: '/my-dashboard',
            icon: 'BarChart3',
            category: 'analytics',
            order: 30
        },
        {
            label: 'Settings',
            href: '/my-settings',
            icon: 'Settings',
            category: 'admin',
            order: 150,
            adminOnly: true
        }
    ],

    // Routable pages
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

### Step 2: Implement Page Components

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

### Step 3: Set Frontend Flag in Manifest

Ensure your manifest declares frontend support:

```typescript
export const myManifest: IPluginManifest = {
    id: 'my-plugin',
    title: 'My Plugin',
    version: '1.0.0',
    frontend: true,  // Required for UI
    backend: true    // Optional
};
```

### Step 4: Build and Register

The system handles everything automatically:

1. Build your plugin: `npm run build --workspace packages/plugins/my-plugin`
2. Generate registry: `npm run generate:plugins --workspace apps/frontend`
3. Restart the app: `./scripts/start.sh`

The plugin loader will:
- Discover your plugin from manifests
- Load your frontend module
- Register menu items and pages
- Render your links in NavBar
- Route your pages dynamically

## Menu Organization

### Categories

Group related menu items using the `category` property:

```typescript
menuItems: [
    { label: 'Analytics', href: '/analytics', category: 'data', order: 10 },
    { label: 'Reports', href: '/reports', category: 'data', order: 11 },
    { label: 'Users', href: '/users', category: 'admin', order: 20 },
    { label: 'Settings', href: '/settings', category: 'admin', order: 21 }
]
```

The registry automatically sorts by category first, then by order within each category.

### Ordering

Control menu item position with the `order` property:

- **0-9**: Core/primary navigation (Overview, Markets, etc.)
- **10-99**: Feature plugins
- **100+**: Admin and system pages

Lower numbers appear first. Items without `order` default to 999 (end of list).

### Access Control

Restrict menu visibility with access flags:

```typescript
menuItems: [
    {
        label: 'Admin Panel',
        href: '/admin',
        adminOnly: true  // Only visible to admins
    }
]
```

**Note**: The current implementation shows all items but relies on page-level auth. Future enhancements will hide menu items based on user permissions.

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
menuItems: [
    { label: 'Dashboard', icon: 'LayoutDashboard', href: '/dashboard' },
    { label: 'Analytics', icon: 'BarChart3', href: '/analytics' },
    { label: 'Settings', icon: 'Settings', href: '/settings' },
    { label: 'Alerts', icon: 'Bell', href: '/alerts' }
]
```

**Current limitation**: Icons are specified by name but not yet rendered. The NavBar component will need updates to import and render Lucide icons dynamically.

## Example: Full Plugin

See `packages/plugins/example-dashboard` for a complete working example that demonstrates:

- Menu item registration
- Page routing
- Component structure
- Documentation

The example plugin adds an "Example" menu item and renders a dashboard page explaining the system.

## Migration from AdminUI

The older `adminUI` property is deprecated in favor of `menuItems` and `pages`:

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
menuItems: [
    {
        label: 'My Feature',
        href: '/admin/my-feature',
        icon: 'Activity',
        adminOnly: true
    }
],
pages: [
    {
        path: '/admin/my-feature',
        component: MyComponent,
        requiresAdmin: true
    }
]
```

The new system provides:
- Multiple menu items per plugin
- Multiple pages per plugin
- Better access control
- Flexible ordering and categorization

## Troubleshooting

### Menu item doesn't appear

1. Check `manifest.frontend === true`
2. Verify plugin builds successfully: `npm run build`
3. Ensure registry regenerated: `npm run generate:plugins`
4. Check browser console for plugin loading errors
5. Verify `menuItems` array is defined and not empty

### Page shows 404

1. Confirm page `path` matches menu item `href`
2. Check `pages` array includes the route
3. Verify plugin registered successfully (check React DevTools)
4. Ensure dynamic route exists at `app/(dashboard)/[...plugin]/page.tsx`
5. Look for path lookup errors in console

### Menu items in wrong order

1. Set explicit `order` properties (default is 999)
2. Remember lower numbers appear first
3. Check categories - items group by category first
4. Review `pluginRegistry` sort logic in browser debugger

### Icons not displaying

This is a known limitation. Icon rendering is not yet implemented. The `icon` property is stored but not used by NavBar.

To add icon support:
1. Import Lucide React icons dynamically in NavBar
2. Map icon strings to components
3. Render icons alongside menu labels

## Advanced: Subscribing to Registry Updates

If you're building custom components that need to react to plugin registration, you can subscribe to the registry:

```typescript
import { useEffect, useState } from 'react';
import { pluginRegistry } from '../../lib/pluginRegistry';

export function MyCustomComponent() {
    const [menuItems, setMenuItems] = useState(pluginRegistry.getMenuItems());

    useEffect(() => {
        // Subscribe to registry updates
        const unsubscribe = pluginRegistry.subscribe(() => {
            // Re-fetch menu items when plugins are registered
            setMenuItems(pluginRegistry.getMenuItems());
        });

        // Cleanup subscription on unmount
        return unsubscribe;
    }, []);

    return (
        <div>
            {menuItems.map(item => (
                <div key={item.href}>{item.label}</div>
            ))}
        </div>
    );
}
```

**Key points:**
- `subscribe(callback)` returns an unsubscribe function
- Always clean up subscriptions in the `useEffect` return
- The callback fires whenever `registerPlugin()` is called
- Subscriptions enable reactive UI updates without polling

## Future Enhancements

Planned improvements to the menu/page system:

### Route Guards

Automatic enforcement of `requiresAuth` and `requiresAdmin`:

```typescript
pages: [
    {
        path: '/admin/users',
        component: UserManagement,
        requiresAdmin: true  // Auto-redirect if not admin
    }
]
```

### Dynamic Metadata

Automatic Next.js metadata generation from page configs:

```typescript
// Generates:
// export const metadata = { title: '...', description: '...' }
```

### Icon Rendering

Full Lucide icon support in NavBar:

```typescript
menuItems: [
    { label: 'Analytics', icon: 'BarChart3', href: '/analytics' }
]
// Renders: <BarChart3Icon className="menu-icon" />
```

### Permission-Based Visibility

Hide menu items based on user permissions:

```typescript
menuItems: [
    {
        label: 'Admin',
        href: '/admin',
        adminOnly: true  // Completely hidden if not admin
    }
]
```

### Nested Menus

Support for dropdown/nested navigation:

```typescript
menuItems: [
    {
        label: 'Analytics',
        href: '/analytics',
        children: [
            { label: 'Dashboard', href: '/analytics/dashboard' },
            { label: 'Reports', href: '/analytics/reports' }
        ]
    }
]
```

### Breadcrumbs

Automatic breadcrumb generation from route hierarchy:

```typescript
// On /analytics/reports:
// Home > Analytics > Reports
```

## Reference Files

Core implementation files:

- **Type definitions**:
  - `packages/types/src/plugin/IMenuItemConfig.ts` - Menu item interface
  - `packages/types/src/plugin/IPageConfig.ts` - Page config interface
  - `packages/types/src/plugin/IPlugin.ts` - Plugin definition (includes menuItems/pages)

- **Registry system**:
  - `apps/frontend/lib/pluginRegistry.ts` - Plugin menu/page registry
  - `apps/frontend/components/plugins/PluginLoader.tsx` - Plugin loader with registry integration

- **UI integration**:
  - `apps/frontend/components/layout/NavBar.tsx` - Navigation with plugin menu items
  - `apps/frontend/app/(dashboard)/[...plugin]/page.tsx` - Dynamic route handler

- **Example**:
  - `packages/plugins/example-dashboard/` - Complete working example

## Best Practices

When building plugins with UI:

1. **Keep paths consistent**: Match `menuItems[].href` with `pages[].path` exactly
2. **Use semantic ordering**: Choose order values that leave room for future plugins
3. **Set categories**: Group related features for better navigation organization
4. **Provide metadata**: Always include page titles and descriptions for SEO
5. **Handle loading states**: Pages should show spinners during data fetching
6. **Error boundaries**: Wrap page content in error boundaries for resilience
7. **Responsive design**: Ensure pages work on mobile and desktop
8. **Document your UI**: Add README.md explaining your plugin's pages and navigation

## Testing and Verification

After implementing a plugin with menu items and pages, verify it works correctly:

### 1. Build and Start

```bash
npm run build --workspace packages/plugins/my-plugin
npm run generate:plugins --workspace apps/frontend
./scripts/start.sh
```

### 2. Check Backend Recognition

Verify the plugin manifest is served:

```bash
curl -s http://localhost:4000/api/plugins/manifests | grep "my-plugin"
```

### 3. Verify Registry (Browser Console)

Open browser developer tools and test the registry:

```javascript
// Check menu items
pluginRegistry.getMenuItems()
// Should show core + plugin menu items

// Check pages
pluginRegistry.getPages()
// Should show registered pages

// Lookup specific page
pluginRegistry.getPageByPath('/my-plugin-page')
// Should return page config
```

### 4. Test Navigation

- Look for your menu item in the navigation bar
- Click the menu item - should navigate to your page
- Navigate directly to the URL - should render your component
- Try invalid URLs - should show 404

### 5. Check Console for Errors

Monitor the browser console for:
- Plugin loading errors
- Registry registration failures
- Component rendering issues
- Route resolution problems

## Migration from AdminUI Pattern

The older `adminUI` property is deprecated. Here's how to migrate:

### Old Approach (Deprecated)

```typescript
export const myPlugin = definePlugin({
    manifest: myManifest,
    adminUI: {
        path: '/admin/my-feature',
        icon: 'Activity',
        component: MyComponent
    }
});
```

**Limitations:**
- Only one UI surface per plugin
- No menu customization
- Limited access controls
- No ordering or categorization

### New Approach (Recommended)

```typescript
export const myPlugin = definePlugin({
    manifest: myManifest,
    menuItems: [
        {
            label: 'My Feature',
            href: '/admin/my-feature',
            icon: 'Activity',
            category: 'admin',
            order: 150,
            adminOnly: true
        }
    ],
    pages: [
        {
            path: '/admin/my-feature',
            component: MyComponent,
            title: 'My Feature',
            requiresAdmin: true
        }
    ]
});
```

**Benefits:**
- Multiple menu items per plugin
- Multiple pages per plugin
- Flexible ordering and categorization
- Better access control
- Metadata support

### Migration Steps

1. Replace `adminUI` with `menuItems` and `pages` arrays
2. Set `label` property (previously inferred from title)
3. Add `order` property for menu positioning
4. Add `category` if grouping with other items
5. Use `adminOnly` instead of path-based admin inference
6. Add page metadata (`title`, `description`)
7. Test thoroughly - URL paths must match exactly

## Implementation Reference

For developers working on the plugin system itself, here are the key files:

### Type Definitions
- `packages/types/src/plugin/IMenuItemConfig.ts` - Menu item interface
- `packages/types/src/plugin/IPageConfig.ts` - Page configuration interface
- `packages/types/src/plugin/IPlugin.ts` - Plugin definition (includes menuItems/pages)
- `packages/types/src/plugin/index.ts` - Type exports

### Frontend Infrastructure
- `apps/frontend/lib/pluginRegistry.ts` - Plugin menu/page registry singleton
- `apps/frontend/components/plugins/PluginLoader.tsx` - Plugin loader with registry integration
- `apps/frontend/components/layout/NavBar.tsx` - Navigation with plugin menu items
- `apps/frontend/app/(dashboard)/[...plugin]/page.tsx` - Dynamic route handler
- `apps/frontend/components/plugins/plugins.generated.ts` - Auto-generated plugin loaders

### Example Plugin
- `packages/plugins/example-dashboard/` - Complete working example
  - `src/manifest.ts` - Plugin metadata
  - `src/frontend/frontend.ts` - Menu + page registration
  - `src/frontend/ExampleDashboardPage.tsx` - Page component
  - `README.md` - Plugin documentation

## Summary

The plugin menu and page system transforms UI extension from a multi-file manual process to a single-file declarative configuration. Plugins declare their navigation and routes, and the system handles discovery, registration, rendering, and routing automatically.

This keeps the codebase modular, enables rapid feature development, and ensures plugins remain self-contained and easy to maintain.

## Related Documentation

**System documentation:**
- [system-menu.md](../system/system-menu.md) - Backend menu service architecture, REST API endpoints, and WebSocket events

**Plugin documentation:**
- [plugins.md](./plugins.md) - Plugin system overview
- [plugins-system-architecture.md](./plugins-system-architecture.md) - Plugin package structure and lifecycle hooks
- [plugins-frontend-context.md](./plugins-frontend-context.md) - Frontend dependency injection and UI components

**Frontend documentation:**
- [frontend.md](../frontend/frontend.md) - Frontend architecture overview
- [frontend-component-guide.md](../frontend/frontend-component-guide.md) - Component styling and design system
