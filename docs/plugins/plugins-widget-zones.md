# Plugin Widget Zones

TronRelic's plugin widget system enables plugins to inject UI components into designated zones on existing core pages. This allows autonomous widget injection without modifying core page code or breaking plugin isolation.

## Why Widget Zones Exist

Before widget zones, plugins had three options for UI:

- **Register a full page** (`/my-feature`) - Works, but requires navigation away from the content
- **Background component** - Can trigger toasts/side effects, but cannot render inline content
- **Modify core pages** - Breaks plugin isolation, requires core code changes per plugin

None of these allowed autonomous widget injection into existing pages. Widget zones solve this by providing predefined injection points where plugins can render components with SSR data fetching.

## Architecture Overview

Widget zones follow the established SSR pattern used by themes, menus, and user data:

| Component | Backend Provides | Frontend Renders |
|-----------|-----------------|------------------|
| Themes | CSS via `/api/system/themes/active` | Injects `<style>` tags |
| User data | User via `getServerUser()` | Hydrates Redux |
| Menu items | Nodes via `IMenuService` | `MenuNavSSR` renders |
| **Widgets** | Data via `/api/widgets` | `WidgetZone` renders |

Benefits of SSR-based approach:
- No loading flash—data arrives with HTML
- Static widgets ship zero JS
- Interactive widgets hydrate with data present
- Backend controls caching/freshness
- Consistent with existing architecture

## Zone Naming Convention

Standard zones available in dashboard layout:

| Zone | Position | Description |
|------|----------|-------------|
| `main-before` | Above page content | Widgets that provide context before the main content |
| `main-after` | Below page content | Widgets that complement or extend the main content |
| `sidebar-top` | Top of sidebar | High-priority sidebar widgets (future) |
| `sidebar-bottom` | Bottom of sidebar | Secondary sidebar widgets (future) |

**Zone validation:** The widget service validates zone names during registration. Unknown zones trigger a warning log but don't prevent registration, allowing future zone additions without breaking existing plugins.

## Backend: Widget Registration

Plugins register widgets in their backend `init()` hook using `context.widgetService`:

```typescript
// In plugin backend init() hook
import { definePlugin, type IPluginContext } from '@tronrelic/types';

export const myBackendPlugin = definePlugin({
    manifest: myManifest,

    init: async (context: IPluginContext) => {
        // Register a widget
        await context.widgetService.register({
            id: 'my-plugin:feed',
            zone: 'main-after',
            routes: ['/'],  // Only show on homepage
            order: 10,      // Lower numbers render first
            title: 'My Feed',
            fetchData: async () => {
                // Return cached data from plugin's MongoDB collection
                const data = await context.database.findOne('feed_cache', {});
                return { items: data?.items || [] };
            }
        }, myManifest.id);

        context.logger.info('Widget registered');
    }
});
```

### Widget Configuration

```typescript
interface IWidgetConfig {
    id: string;                  // Unique identifier (namespaced to plugin)
    zone: string;                // Target zone ('main-after', etc.)
    routes: string[];            // URL paths where widget appears
    order?: number;              // Sort order (default: 100)
    title?: string;              // Optional heading
    description?: string;        // Admin UI description
    fetchData: () => Promise<unknown>;  // SSR data fetcher
}
```

### Route Matching

```typescript
// Show on homepage only
routes: ['/']

// Show on multiple specific routes
routes: ['/dashboard', '/markets']

// Show on all routes
routes: []
```

### Data Fetching Best Practices

The `fetchData()` function should:
- Return cached or precomputed data (avoid heavy computation)
- Handle errors gracefully (return empty data rather than throwing)
- Complete quickly (< 100ms recommended, 5s timeout enforced)
- Return JSON-serializable data

```typescript
fetchData: async () => {
    try {
        const posts = await database.findOne('reddit_cache', {});
        return { posts: posts?.items || [] };
    } catch (error) {
        logger.error('Widget data fetch failed:', error);
        return { posts: [] };  // Return empty data on error
    }
}
```

## Frontend: Automatic Widget Rendering

Widget zones are integrated into layouts and automatically render registered widgets for the current route:

```tsx
// In apps/frontend/app/(dashboard)/layout.tsx
import { headers } from 'next/headers';

export default async function DashboardLayout({ children }) {
    const headersList = await headers();
    const pathname = headersList.get('x-pathname') || '/';
    const widgets = await fetchWidgetsForRoute(pathname);

    return (
        <div className="dashboard-layout">
            <WidgetZone name="main-before" widgets={widgets} />
            {children}
            <WidgetZone name="main-after" widgets={widgets} />
        </div>
    );
}
```

**Per-route support:** Next.js middleware sets an `x-pathname` header on every request, allowing layouts to fetch widgets for the actual page route—not just the layout's base path. This means widgets with `routes: ['/system/users']` appear only on that specific page.

The `WidgetZone` component:
1. Filters widgets by zone name
2. Sorts by order property
3. Renders each widget with optional title
4. Renders custom React components when registered, falls back to JSON display in development

## Complete Example

Here's a complete example of a plugin that displays a feed widget on the homepage:

### Backend: Widget Registration

```typescript
// packages/plugins/reddit-sentiment/src/backend/backend.ts
import { definePlugin, type IPluginContext } from '@tronrelic/types';
import { redditManifest } from '../manifest';

export const redditBackendPlugin = definePlugin({
    manifest: redditManifest,

    install: async (context: IPluginContext) => {
        // Create index for feed cache
        await context.database.createIndex('feed_cache', { updatedAt: -1 });
    },

    init: async (context: IPluginContext) => {
        // Register homepage feed widget
        await context.widgetService.register({
            id: 'reddit-sentiment:feed',
            zone: 'main-after',
            routes: ['/'],
            order: 10,
            title: 'Community Buzz',
            description: 'Latest Reddit discussions about TRON',
            fetchData: async () => {
                const cache = await context.database.findOne('feed_cache', {});
                return {
                    posts: cache?.posts || [],
                    lastUpdated: cache?.updatedAt || null
                };
            }
        }, redditManifest.id);

        // Start background job to update feed cache
        context.scheduler.schedule('reddit-feed', '*/5 * * * *', async () => {
            const posts = await fetchRedditPosts();
            await context.database.updateOne(
                'feed_cache',
                {},
                { $set: { posts, updatedAt: new Date() } },
                { upsert: true }
            );
        });

        context.logger.info('Reddit sentiment widget registered');
    }
});
```

### Manifest

```typescript
// packages/plugins/reddit-sentiment/src/manifest.ts
import type { IPluginManifest } from '@tronrelic/types';

export const redditManifest: IPluginManifest = {
    id: 'reddit-sentiment',
    title: 'Reddit Sentiment',
    version: '1.0.0',
    backend: true,
    frontend: false  // Widget-only plugin, no pages
};
```

## Declarative Widget Registration (Alternative)

Widgets can also be registered declaratively in the plugin definition:

```typescript
export const myBackendPlugin = definePlugin({
    manifest: myManifest,

    widgets: [
        {
            id: 'my-plugin:feed',
            zone: 'main-after',
            routes: ['/'],
            order: 10,
            title: 'My Feed',
            fetchData: async () => ({ items: [] })
        }
    ],

    init: async (context: IPluginContext) => {
        // Widgets are automatically registered before init() runs
        context.logger.info('Plugin initialized');
    }
});
```

**Note:** Widgets are automatically registered during plugin loading, before the `init()` hook runs. Use `context.widgetService.register()` in `init()` for dynamic registration or when you need access to the context.

## Widget Ordering

Control the order of widgets within a zone using the `order` property:

```typescript
// This widget renders first (lower order)
await context.widgetService.register({
    id: 'important-alerts',
    zone: 'main-after',
    routes: ['/'],
    order: 5,
    // ...
});

// This widget renders second
await context.widgetService.register({
    id: 'reddit-feed',
    zone: 'main-after',
    routes: ['/'],
    order: 10,
    // ...
});

// This widget renders last (higher order)
await context.widgetService.register({
    id: 'stats-summary',
    zone: 'main-after',
    routes: ['/'],
    order: 50,
    // ...
});
```

Suggested order ranges:
- **0-9**: High-priority alerts and notifications
- **10-49**: Primary content widgets
- **50-99**: Secondary/supplementary widgets
- **100+**: Lower priority (default if not specified)

## Widget Lifecycle

Widgets are managed through plugin lifecycle hooks:

```typescript
export const myBackendPlugin = definePlugin({
    manifest: myManifest,

    init: async (context: IPluginContext) => {
        // Register widgets when plugin is enabled
        await context.widgetService.register({
            id: 'my-widget',
            zone: 'main-after',
            routes: ['/'],
            order: 10,
            fetchData: async () => ({ data: 'hello' })
        }, myManifest.id);
    },

    disable: async (context: IPluginContext) => {
        // Unregister all widgets when plugin is disabled
        await context.widgetService.unregisterAll(myManifest.id);
        context.logger.info('Widgets unregistered');
    }
});
```

**Automatic cleanup:** Widgets are automatically unregistered when a plugin is disabled or uninstalled via the admin interface.

## Debugging Widgets

### View All Registered Widgets

**Requires admin authentication:**

```bash
curl -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  http://localhost:4000/api/widgets/all
```

Returns all registered widgets (without executing fetchData):

```json
{
  "widgets": [
    {
      "id": "reddit-sentiment:feed",
      "zone": "main-after",
      "routes": ["/"],
      "order": 10,
      "title": "Community Buzz",
      "pluginId": "reddit-sentiment"
    }
  ]
}
```

### View Widgets by Zone

**Requires admin authentication:**

```bash
curl -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  http://localhost:4000/api/widgets/zones/main-after
```

Returns widgets in a specific zone:

```json
{
  "zone": "main-after",
  "widgets": [...]
}
```

### View Widgets for Route (with data)

```bash
curl http://localhost:4000/api/widgets?route=/
```

Returns widgets matching a route with pre-fetched data:

```json
{
  "widgets": [
    {
      "id": "reddit-sentiment:feed",
      "zone": "main-after",
      "pluginId": "reddit-sentiment",
      "order": 10,
      "title": "Community Buzz",
      "data": {
        "posts": [...],
        "lastUpdated": "2024-12-02T05:00:00Z"
      }
    }
  ]
}
```

## Frontend: Widget Components with SSR + Live Updates

Widget components render fully on the server (SSR) for instant display, then hydrate on the client for live data updates. This two-phase approach provides the best user experience: no loading flash on initial page load, plus real-time updates as data changes.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. BUILD TIME                                                    │
│    Generator scans plugins/*/src/frontend/widgets/index.ts      │
│    Creates static imports in widgets.generated.ts               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. SSR (Every Page Request)                                      │
│    Layout calls fetchWidgetsForRoute(pathname)                  │
│    Backend executes fetchData() for matching widgets            │
│    WidgetZone looks up component from static registry           │
│    Component renders with fresh data → HTML sent to browser     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. HYDRATION (Browser)                                           │
│    React hydrates server-rendered HTML                          │
│    Component becomes interactive                                │
│    useEffect runs → WebSocket subscription established          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. LIVE UPDATES (Ongoing)                                        │
│    WebSocket event arrives                                      │
│    Event handler calls setState                                 │
│    Component re-renders with new data                           │
└─────────────────────────────────────────────────────────────────┘
```

### Exporting Widget Components

Plugins export widget components from a standard location. The build-time generator discovers these exports and creates static imports for SSR.

```typescript
// packages/plugins/my-plugin/src/frontend/widgets/index.ts
import type { ComponentType } from 'react';
import { MyFeedWidget } from './MyFeedWidget';

/**
 * Widget component registry for this plugin.
 * Keys must match widget IDs used in backend registration.
 */
export const widgetComponents: Record<string, ComponentType<{ data: unknown }>> = {
    'my-plugin:feed': MyFeedWidget
};
```

**Convention:** Export a `widgetComponents` object from `src/frontend/widgets/index.ts`. The generator scans this file at build time.

### Creating Widget Components

Widget components receive SSR-fetched data as the `data` prop. They render immediately (data is already present from SSR) and can optionally subscribe to WebSocket for live updates.

#### Basic Widget (SSR only)

```tsx
// packages/plugins/my-plugin/src/frontend/widgets/MyFeedWidget.tsx
'use client';

interface FeedData {
    posts: Array<{ id: string; title: string; timestamp: string }>;
}

export function MyFeedWidget({ data }: { data: unknown }) {
    const feedData = data as FeedData;

    if (!feedData?.posts?.length) {
        return (
            <div className="surface surface--padding-md text-center">
                <p className="text-muted">No posts available</p>
            </div>
        );
    }

    return (
        <div className="surface">
            {feedData.posts.map((post) => (
                <div key={post.id} className="surface--padding-sm border-b border-border">
                    <p className="font-semibold">{post.title}</p>
                    <p className="text-sm text-muted">{post.timestamp}</p>
                </div>
            ))}
        </div>
    );
}
```

#### Widget with Live Updates (SSR + WebSocket)

```tsx
// packages/plugins/whale-alerts/src/frontend/widgets/RecentWhalesWidget.tsx
'use client';

import { useState, useEffect } from 'react';

interface WhaleTransaction {
    txId: string;
    fromAddress: string;
    toAddress: string;
    amountTRX: number;
    timestamp: string;
}

interface WhaleData {
    transactions: WhaleTransaction[];
    count: number;
}

export function RecentWhalesWidget({ data }: { data: unknown }) {
    // Initialize state with SSR data - no loading state needed
    const [whaleData, setWhaleData] = useState<WhaleData>(data as WhaleData);

    useEffect(() => {
        // After hydration, subscribe to live updates via WebSocket
        // Widget components can access websocket through global context or props
        const handleNewTransaction = (transaction: WhaleTransaction) => {
            setWhaleData(prev => ({
                ...prev,
                transactions: [transaction, ...prev.transactions].slice(0, 10),
                count: prev.count + 1
            }));
        };

        // Subscribe to plugin-namespaced events
        // Implementation depends on your WebSocket setup

        return () => {
            // Cleanup subscription
        };
    }, []);

    if (!whaleData?.transactions?.length) {
        return (
            <div className="surface surface--padding-md text-center">
                <p className="text-muted">No recent whale activity</p>
            </div>
        );
    }

    return (
        <div className="surface">
            {whaleData.transactions.map((tx) => (
                <div key={tx.txId} className="surface--padding-sm border-b border-border">
                    <span className="font-semibold">
                        {tx.amountTRX.toLocaleString()} TRX
                    </span>
                    <span className="text-sm text-muted font-mono ml-2">
                        {tx.fromAddress.slice(0, 8)}... → {tx.toAddress.slice(0, 8)}...
                    </span>
                </div>
            ))}
        </div>
    );
}
```

### Component Requirements

Widget components must follow these rules for proper SSR:

1. **Export from standard location**: `src/frontend/widgets/index.ts`
2. **Export `widgetComponents` object**: Maps widget IDs to components
3. **Use `'use client'` directive**: Required for useState/useEffect
4. **No loading states for initial data**: SSR data is already present
5. **Initialize state from `data` prop**: `useState(data as MyType)`
6. **WebSocket subscriptions in useEffect**: Client-side only, after hydration
7. **Match widget ID exactly**: Export key must match backend registration ID

### Hydration Gotchas

Hydration errors occur when server-rendered HTML differs from what React generates on first client render. Widgets are especially vulnerable because SSR data arrives via `fetchData()` but components can accidentally discard it.

**Why initializing from SSR data matters:**

```tsx
// ✅ CORRECT: Initialize from SSR data (matches server render)
export function MyWidget({ data }: { data: unknown }) {
    const [items, setItems] = useState((data as MyData).items);
    return <div>{items.map(i => <p key={i.id}>{i.text}</p>)}</div>;
}

// ❌ WRONG: Fetch fresh data on mount (causes hydration mismatch)
export function MyWidget({ data }: { data: unknown }) {
    const [items, setItems] = useState<Item[]>([]);  // Empty initial state
    useEffect(() => {
        fetch('/api/items').then(r => r.json()).then(setItems);
    }, []);
    return <div>{items.map(i => <p key={i.id}>{i.text}</p>)}</div>;
}
```

The wrong pattern renders empty on the client (initial state `[]`) while the server rendered actual data—React detects the mismatch and throws an error.

**Common triggers in widget components:**

| Trigger | Example | Fix |
|---------|---------|-----|
| Fresh fetch on mount | `useEffect(() => fetch(...))` | Initialize state from `data` prop |
| Timestamps | `new Date().toLocaleString()` | Use `ClientTime` component or defer until mounted |
| Random IDs | `Math.random()` for keys | Use stable IDs from data |
| Browser APIs | `window.innerWidth` | Check `typeof window !== 'undefined'` or defer |
| localStorage | Reading user preferences | Initialize as null, update in useEffect |

**The `isMounted` pattern for browser-only rendering:**

When you must render something that differs between server and client (like user timezone), defer it until after hydration:

```tsx
export function MyWidget({ data }: { data: unknown }) {
    const [items, setItems] = useState((data as MyData).items);
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => setIsMounted(true), []);

    return (
        <div>
            {items.map(item => (
                <div key={item.id}>
                    <span>{item.value}</span>
                    {/* Timezone-sensitive: only render after hydration */}
                    <span>
                        {isMounted
                            ? new Date(item.updatedAt).toLocaleString()
                            : item.updatedAt  // Show ISO string on server
                        }
                    </span>
                </div>
            ))}
        </div>
    );
}
```

**Debugging hydration errors:**

React 18 provides detailed mismatch warnings in dev mode:
```
Warning: Text content did not match. Server: "12/2/2025" Client: "2/12/2025"
```

This pinpoints the exact element. The fix is usually: defer that render until `isMounted` is true, or use the `ClientTime` component.

**See [ui-component-styling.md](../frontend/ui/ui-component-styling.md#ssr-and-hydration) for comprehensive hydration guidance** including the `ClientTime` component, two-phase rendering pattern for charts, and additional best practices.

### Regenerating the Widget Registry

After adding or modifying widget components, regenerate the registry:

```bash
npm run generate:plugins --workspace apps/frontend
```

This scans all plugins for `src/frontend/widgets/index.ts` files and creates static imports in `widgets.generated.ts`.

## Troubleshooting

### Widget doesn't appear

1. Check plugin is **enabled** in `/system/plugins` admin UI
2. Verify widget is registered: `GET /api/widgets/all`
3. Check route matches: `GET /api/widgets?route=/`
4. Look for backend errors in logs: `tail -f .run/backend.log | grep widget`
5. Verify fetchData() completes within 5 seconds

### Widget shows but no data

1. Check fetchData() function for errors
2. Verify database collection has data
3. Check backend logs for "Widget data fetch failed"
4. Test data fetching directly: `GET /api/widgets?route=/`

### Widget in wrong order

1. Set explicit `order` property when registering widget
2. Remember lower numbers appear first
3. Check other widgets in the same zone for ordering conflicts

## Best Practices

1. **Cache widget data**: Use MongoDB or Redis to cache widget data, don't compute in fetchData()
2. **Keep it fast**: fetchData() should complete in < 100ms for good UX
3. **Handle errors**: Return empty data rather than throwing errors
4. **Namespace IDs**: Use `plugin-id:widget-name` format for widget IDs
5. **Target specific routes**: Only show widgets where they add value
6. **Test zones**: Verify widgets appear in correct zones and order
7. **Update on schedule**: Use background jobs to keep widget data fresh

## Related Documentation

- [Plugin System Overview](./plugins.md) - Complete plugin system documentation
- [Plugin Backend Context](./plugins-system-architecture.md) - Backend services and lifecycle hooks
- [Plugin Frontend Context](./plugins-frontend-context.md) - Frontend dependency injection
- [Menu Registration](./plugins-page-registration.md) - Registering navigation menu items
- [SSR and Hydration](../frontend/ui/ui-component-styling.md#ssr-and-hydration) - Comprehensive hydration patterns including `ClientTime` component and two-phase rendering

## Future Enhancements

Planned improvements to the widget system:

### ✅ Implemented

- Backend widget service with in-memory registry
- SSR data fetching with timeout protection (5s limit via Promise.race)
- Route-based widget filtering
- Zone-based rendering in dashboard layout
- Declarative and imperative widget registration
- Per-route widget support via middleware (x-pathname header)
- Custom widget components via `registerWidgetComponent()`
- Zone validation with warning logging for unknown zones
- JSON serialization validation for widget data
- Admin authentication for introspection endpoints (`/api/widgets/all`, `/api/widgets/zones/:zone`)

### 🚧 Planned

**Widget Size Hints** - Control widget layout:
```typescript
widgets: [{
    id: 'my-widget',
    zone: 'main-after',
    size: 'full' | 'half' | 'third',  // Width hint
    fetchData: async () => ({})
}]
```

**User Customization** - Allow users to hide/reorder widgets via UI

**More Zones** - Expand to header, footer, and page-specific zones
