# Widget Registration

Backend registration of widgets — manifest fields, route filtering, ordering, lifecycle, and admin introspection. For zones and SSR data flow see [plugins-widget-zones.md](./plugins-widget-zones.md). For component authoring see [plugins-widget-zones-ssr.md](./plugins-widget-zones-ssr.md).

## Why This Matters

Widget config controls *where* (zone), *when* (route filter), *order* (priority), and *what data* (fetchData). Get any of these wrong and the widget either never appears, appears on the wrong pages, fights for ordering with other plugins, or breaks SSR with a slow/throwing data fetch.

## IWidgetConfig

```typescript
interface IWidgetConfig {
    id: string;          // Plugin-namespaced: 'plugin-id:widget-name'
    zone: string;        // 'main-after', 'plugin-content:before', etc.
    routes: string[];    // [] = all routes; ['/'] = homepage only
    order?: number;      // Lower renders first; default 100
    title?: string;      // Optional heading shown above widget
    description?: string;// Admin UI only
    fetchData: (route: string, params: Record<string, string>) => Promise<unknown>;
}
```

`fetchData` receives the resolved route and any params extracted by the host (e.g. `{ address }` on `/u/[address]`). It must return cached, JSON-serializable data quickly — heavy work belongs in a scheduled job that writes to the plugin's MongoDB collection. Errors should resolve to empty data, not throw. The 5s service-side timeout (Promise.race) is enforced.

## Imperative Registration (in `init()`)

Use this when registration depends on context — e.g. conditional registration, or storing a service handle. Always pair with `unregisterAll` in `disable()`.

```typescript
export const myBackendPlugin = definePlugin({
    manifest: myManifest,
    init: async (context: IPluginContext) => {
        await context.widgetService.register({
            id: 'reddit-sentiment:feed',
            zone: 'main-after',
            routes: ['/'],
            order: 10,
            title: 'Community Buzz',
            fetchData: async (route, params) => {
                const cache = await context.database.findOne('feed_cache', {});
                return { posts: cache?.posts ?? [] };
            }
        }, myManifest.id);
    },
    disable: async (context) => {
        await context.widgetService.unregisterAll(myManifest.id);
    }
});
```

## Declarative Registration (on the plugin definition)

Static widgets register before `init()` runs. Cleanup is automatic on disable/uninstall.

```typescript
export const myBackendPlugin = definePlugin({
    manifest: myManifest,
    widgets: [{
        id: 'my-plugin:feed',
        zone: 'main-after',
        routes: ['/'],
        order: 10,
        fetchData: async () => ({ items: [] })
    }],
    init: async (context) => { /* ... */ }
});
```

## Route Filtering

`routes: []` matches every route. `routes: ['/']` matches only the homepage. `routes: ['/dashboard', '/markets']` matches multiple specific paths. The middleware sets `x-pathname` per request, so widget filtering reflects the actual page — not the layout's base path. Cross-plugin injection works by targeting another plugin's page slug, e.g. `routes: ['/whales']` from a memo-tracker widget.

## Ordering

Lower `order` renders first within a zone. Suggested ranges:

| Range | Use |
|-------|-----|
| 0–9 | High-priority alerts, notifications |
| 10–49 | Primary content widgets |
| 50–99 | Secondary widgets |
| 100+ | Default / lowest priority |

When two plugins target the same zone, set explicit `order` to win deterministic placement.

## Lifecycle

Widgets registered in `init()` (or declaratively) are torn down when the plugin is disabled or uninstalled. Imperative registrations must call `context.widgetService.unregisterAll(manifestId)` in `disable()`. Declarative widgets clean up automatically.

## Admin Introspection

All `/all` and `/zones/:zone` endpoints require `X-Admin-Token`.

| Endpoint | Auth | Returns |
|----------|------|---------|
| `GET /api/widgets/all` | Admin | All registered widgets (no fetchData run) |
| `GET /api/widgets/zones/:zone` | Admin | Widgets in a specific zone |
| `GET /api/widgets?route=/path` | None | Widgets matching route, with fetched data |

Example: `curl -H "X-Admin-Token: $ADMIN_API_TOKEN" http://localhost:4000/api/widgets/all`.

## Troubleshooting

**Widget missing.** Confirm the plugin is enabled in `/system/plugins`. Hit `/api/widgets/all` to confirm registration. Hit `/api/widgets?route=/your/path` to confirm route match. Tail backend logs for `widget` keywords; verify `fetchData` completes inside the 5s timeout.

**Widget renders with no data.** Inspect `fetchData` for thrown errors (return empty data instead). Verify the source MongoDB collection is populated. Look for `"Widget data fetch failed"` in logs.

**Wrong order.** Set explicit `order` and remember lower-first. Audit other plugins targeting the same zone.

## Best Practices

Cache widget data in Mongo or Redis; do not compute inside `fetchData`. Refresh on a scheduled job. Namespace IDs as `plugin-id:widget-name`. Target only the routes where the widget adds value. Keep `fetchData` under 100ms for good UX.
