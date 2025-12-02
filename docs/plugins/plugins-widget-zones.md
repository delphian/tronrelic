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

Widget zones are integrated into the dashboard layout and automatically render registered widgets:

```tsx
// In apps/frontend/app/(dashboard)/layout.tsx
export default async function DashboardLayout({ children }) {
    const widgets = await fetchWidgetsForRoute('/');
    
    return (
        <div className="dashboard-layout">
            <WidgetZone name="main-before" widgets={widgets} />
            {children}
            <WidgetZone name="main-after" widgets={widgets} />
        </div>
    );
}
```

The `WidgetZone` component:
1. Filters widgets by zone name
2. Sorts by order property
3. Renders each widget with optional title
4. Displays widget data (currently as JSON, plugin components coming soon)

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

```bash
curl http://localhost:4000/api/widgets/all
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

```bash
curl http://localhost:4000/api/widgets/zones/main-after
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

## Frontend Widget Components (Coming Soon)

Currently, widgets display their data as formatted JSON. Future enhancement will add:

```typescript
// Plugin can provide custom React component
widgets: [
    {
        id: 'reddit-feed',
        zone: 'main-after',
        routes: ['/'],
        component: RedditFeedWidget,  // React component
        fetchData: async () => ({ posts: [] })
    }
]
```

The `RedditFeedWidget` component will receive pre-fetched data as props:

```tsx
function RedditFeedWidget({ data }: { data: { posts: RedditPost[] } }) {
    return (
        <div className="reddit-feed">
            {data.posts.map(post => (
                <RedditPostCard key={post.id} post={post} />
            ))}
        </div>
    );
}
```

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

## Future Enhancements

Planned improvements to the widget system:

### ✅ Implemented

- Backend widget service with in-memory registry
- SSR data fetching with timeout protection
- Route-based widget filtering
- Zone-based rendering in dashboard layout
- Declarative and imperative widget registration

### 🚧 Planned

**Custom Widget Components** - Plugins provide React components:
```typescript
widgets: [{
    id: 'my-widget',
    zone: 'main-after',
    component: MyWidgetComponent,
    fetchData: async () => ({})
}]
```

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

**Per-Page Widgets** - Extract actual pathname from request context for per-page widget filtering
