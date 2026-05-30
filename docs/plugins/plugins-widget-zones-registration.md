# Plugin Widget Registration

Backend registration is how a plugin tells the platform "I have a renderable widget — here's where it goes by default." The platform splits that single intent into a *widget type* (the renderable unit and its data fetcher) and a *plugin-source placement* (the row in `module_widgets_placements` that wires the type to a zone). Operators then refine the placement from `/system/widgets`. For zones, ownership, and rendering flow see [plugins-widget-zones.md](./plugins-widget-zones.md); for the component side see [plugins-widget-zones-ssr.md](./plugins-widget-zones-ssr.md).

## Why This Matters

Getting registration wrong fails in operator-visible ways: the widget never appears, lands on the wrong routes, fights another plugin for order, or breaks SSR with a slow or throwing data fetcher. Beyond correctness, every plugin-registered placement must be tagged with the calling plugin's id so the platform can soft-disable it on plugin disable without losing operator overrides — that tagging happens automatically when the plugin passes `ownerId` to the unified widgets service.

## What You Register

A plugin registers a **widget type** — an id, label, a `defaultDataFetcher`, and default placement parameters (zone, routes, order, optional title). The platform stores the type descriptor in an in-memory type registry and upserts a `source: 'plugin'` row into `module_widgets_placements` keyed by `(typeId, pluginId)`. From that point forward the placement is operator-owned: `zoneId`, `routes`, `order`, `title`, `instanceConfig`, and `enabled` are all overridable through `/system/widgets`. The plugin's stated defaults are cached so an operator can revert via restore-defaults.

A plugin may *additionally* register **zones** if it wants to expose new injection points other plugins (or operators) can target. Zones are runtime-only — they live for the plugin's enabled lifetime and disappear on disable. Most plugins consume zones rather than declare them.

## The Unified Widgets Service

Every widget operation flows through `IWidgetsService`, published on the service registry as `'widgets'`. Plugins look it up, then call `registerWidget` (combined type + default placement), `registerType` (type only), `registerZone` (new injection point), or read methods like `listZones` / `listTypes` / `findPlacementsForRoute`. No per-plugin facade rides on `IPluginContext` — the entire surface is one named service.

```typescript
import {
    definePlugin,
    type IPluginContext,
    type IWidgetsService
} from '@delphian/tronrelic-types';

export const myPlugin = definePlugin({
    manifest: myManifest,
    init: async (context: IPluginContext) => {
        const widgets = context.services.get<IWidgetsService>('widgets');
        if (!widgets) return; // service registry is empty — defensive, should never fire in production

        await widgets.registerWidget({
            id: 'my-plugin:feed',
            label: 'Community Buzz',
            description: 'Latest community posts',
            defaultZoneId: 'main-after',
            defaultRoutes: ['/'],
            defaultOrder: 10,
            defaultTitle: 'Community Buzz',
            defaultDataFetcher: async (route, params) => {
                const cache = await context.database.findOne('feed_cache', {});
                return { posts: cache?.posts ?? [] };
            }
        }, myManifest.id);
    }
});
```

Note: plugins do *not* implement a `disable()` hook to unregister widgets. The plugin manager calls `widgets.unregisterAllForOwner(pluginId)` automatically on disable — placements soft-disable, types and zones unregister, and operator customisations on placements survive the next enable cycle.

## Declaring Plugin-Owned Zones

If your plugin renders a page that should expose injection points for *other* plugins (or for operator-placed widgets), register zones in `init`. They are torn down automatically on disable.

```typescript
init: async (context: IPluginContext) => {
    const widgets = context.services.get<IWidgetsService>('widgets');
    if (!widgets) return;

    widgets.registerZone({
        id: 'my-plugin:sidebar',
        label: 'My plugin sidebar',
        description: 'Right rail on the My Plugin page.',
        host: 'plugin',
        layout: 'vertical'
    }, myManifest.id);
}
```

## Registering a Type Without a Default Placement

Rare but valid — e.g. a widget meant to be placed only by operators. Use `registerType` instead of `registerWidget`. The type becomes available in the `/system/widgets` type picker; no placement is created automatically.

```typescript
widgets.registerType({
    id: 'my-plugin:standalone',
    label: 'Standalone Widget',
    description: 'Operator-only placement',
    defaultDataFetcher: async () => ({ /* … */ })
}, myManifest.id);
```

## Operator Overrides

Once a plugin-source row exists, the operator can edit it from `/system/widgets`. Editable fields are `zoneId`, `routes`, `order`, `title`, `instanceConfig`, and `enabled`. The plugin's original `registerWidget(input, ownerId)` arguments are cached in process so the operator can revert via the restore-defaults action — which resets everything except the row's id and `createdAt`. Operators can also create entirely new placements of the same widget type pointing at different zones or routes; those new rows are `source: 'operator'` and can be deleted outright.

Treat the values in `IRegisterWidgetInput` as *defaults*, not invariants. Anything an operator might reasonably want to retarget — zone, route filter, order, instance config — belongs in those defaults rather than hardcoded in the data fetcher.

## Route Filtering

`defaultRoutes: []` matches every route. Otherwise the array must hold one or more patterns from this grammar:

| Form | Matches | Example |
|---|---|---|
| Exact | The literal path, nothing else | `/markets` |
| Single-segment glob | One trailing segment, no deeper | `/u/*` matches `/u/TXyz`, not `/u/TXyz/holdings` |
| Deep glob | Any depth below the prefix | `/admin/**` matches `/admin/users/edit` |

Patterns must start with `/`, contain no whitespace, and place glob markers only at the trailing position (`/*/markets` is rejected). The matcher is `routeMatches` in `src/backend/modules/widgets/placements/route-matcher.ts`; the admin API validates inputs through `normaliseRoutePattern` before reaching the placement service.

Cross-plugin injection works by targeting another plugin's page slug — `defaultRoutes: ['/whales']` from a memo-tracker widget places it on the whale-alerts page without coupling the two plugins.

## Ordering

Lower `defaultOrder` renders first within a zone. Default is `100`. The valid range is `[0, 10000]`.

| Range | Use |
|---|---|
| 0–9 | High-priority alerts, notifications |
| 10–49 | Primary content widgets |
| 50–99 | Secondary widgets |
| 100+ | Default / lowest priority |

When two plugins target the same zone, set explicit `defaultOrder` to win deterministic placement. Operators can reorder by drag-and-drop in `/system/widgets`, which renumbers every affected row in steps of 10.

## Lifecycle Semantics

**Plugin enable / re-enable.** Each `registerWidget(input, ownerId)` call caches the original args, registers the widget type, and calls `placementService.ensurePluginPlacement(...)` internally. The placement upsert is atomic: it flips `enabled: true` and updates `updatedAt` on existing rows, but uses `$setOnInsert` for `zoneId`, `routes`, `order`, `title`, and `instanceConfig`, so operator customisations on existing rows are preserved across enable cycles.

**Plugin disable.** `PluginManagerService` calls `widgets.unregisterAllForOwner(pluginId)`, which soft-disables every plugin-source placement (`enabled: false`), removes every widget type the plugin owned, and removes every plugin-declared zone. Placement rows stay in MongoDB. The plugin-default cache is *not* cleared, so restore-defaults continues to work on soft-disabled rows as long as the process is alive.

**Plugin uninstall.** Same path as disable. Rows remain on disk until a future cleanup migration or a manual operator delete (operator-source rows only).

**Process restart.** The widget-type and zone registries rebuild from plugin `init` calls; the plugin-default cache is empty until the plugin enables and re-registers. Placements survive in MongoDB across restarts.

## Data Fetchers

`defaultDataFetcher(route, params, placement?)` receives the resolved route, any params the host extracted (e.g. `{ address }` on `/u/[address]`), and a per-placement `IWidgetPlacementContext` — `{ id, instanceConfig }` — that lets one widget type produce per-placement variation without shipping a type per permutation. The third argument is optional, so existing fetchers that ignore placement-scoped config remain valid. The resolver substitutes an empty object for `instanceConfig` when a placement carries no overrides, so fetchers can read keys unconditionally.

Fetchers must return JSON-serialisable data quickly — heavy work belongs in a scheduled job that writes to a plugin-owned MongoDB collection that the fetcher then reads. A 5-second per-fetcher timeout is enforced by the SSR resolver via `Promise.race`. Failures should resolve to empty data, never throw — a throw is converted to an empty payload but logged as a fetcher error.

```typescript
defaultDataFetcher: async (_route, _params, placement) => {
    const cap = Number(placement?.instanceConfig?.maxPosts);
    const maxPosts = Number.isFinite(cap) ? Math.min(20, Math.max(1, Math.floor(cap))) : 5;
    return { posts: await service.recent(maxPosts) };
}
```

## Per-Placement Configuration Schemas

A widget type may declare `configSchema` — a JSON Schema Draft 7 object — to constrain the `instanceConfig` operators attach to its placements. When a schema is declared, the placement admin API validates `instanceConfig` against it on every create and patch using AJV, rejecting invalid bodies with a structured 400 listing per-field errors:

```json
{
    "success": false,
    "error": "instanceConfig failed widget-type schema validation",
    "errors": [
        { "path": "/maxPosts", "message": "must be <= 20" }
    ]
}
```

The schema flows through `IRegisterWidgetTypeInput.configSchema` (and the convenience `IRegisterWidgetInput.configSchema`) into the widget type descriptor; the validation path retrieves it via `IWidgetsService.getTypeConfigSchema(typeId)`. Validators compile once per schema reference and cache for the descriptor's lifetime — re-enabling a plugin invalidates the cache by minting a fresh descriptor.

Widget types that declare no schema accept any plain JSON object as `instanceConfig` (the shape-only "must be a plain object" guard still applies). For the smoothest operator-UX path keep top-level schema properties as primitives (`string`, `number`, `boolean`, `enum`) — the `/system/widgets` JSON-textarea editor surfaces the structured field errors inline regardless of nesting.

```typescript
widgets.registerWidget({
    id: 'my-plugin:feed',
    label: 'Feed',
    description: 'Recent posts',
    defaultZoneId: 'main-after',
    defaultRoutes: [],
    defaultInstanceConfig: { maxPosts: 5 },
    configSchema: {
        type: 'object',
        properties: {
            maxPosts: { type: 'integer', minimum: 1, maximum: 20 }
        },
        additionalProperties: false
    },
    defaultDataFetcher: async (_route, _params, placement) => { /* ... */ }
}, ownerId);
```

## Admin Introspection

`/system/widgets` is the operator-facing UI. The three admin REST endpoints behind it:

| Method | Path | Returns |
|---|---|---|
| GET | `/api/admin/system/zones` | `IZoneSnapshot` — tracks (one per host) → zones |
| GET | `/api/admin/system/widget-types` | `IWidgetTypeSnapshot` — groups (one per declaring plugin) → types |
| GET / POST / PATCH / DELETE | `/api/admin/system/widgets/placements[/:id]` | Placement CRUD; see [system-api-widgets.md](../system/system-api-widgets.md) |

All three chain `createAdminRateLimiter` before `requireAdmin` — admits the Better Auth admin session or the `x-admin-token` header.

The pre-split read endpoints (`/api/widgets/all`, `/api/widgets/zones/:zone`) have been deleted. The SSR data endpoint `/api/widgets?route=...` remains.

## Troubleshooting

**Widget never appears.** Confirm the plugin is enabled in `/system/plugins`. Hit `/api/admin/system/widgets/placements?pluginId=<id>` to confirm the placement was upserted. Check `enabled: true` and that `zoneId` matches a real zone (`/api/admin/system/zones`). Verify the route filter against the page you're loading.

**Widget renders blank.** The `defaultDataFetcher` threw, timed out, or returned non-serialisable data. Check backend logs for `"Widget data fetch failed"`. Confirm the source MongoDB collection is populated. Return empty data on error instead of throwing.

**Wrong order.** Set explicit `defaultOrder` in your `registerWidget` call; remember lower-first. If an operator reordered the row, restore-defaults reverts it to your default. Two plugins targeting the same zone with no explicit order get insertion-order — never rely on that.

**Plugin disable removed my placement.** It didn't — it was soft-disabled. Inspect the row at `/api/admin/system/widgets/placements/:id` and confirm `enabled: false, source: 'plugin'`. Re-enable the plugin and the row flips back to `enabled: true` with operator overrides intact.

**`services.get('widgets')` returns undefined.** Defensive check only — the widgets service is registered during `WidgetsModule.run()`, which runs before any plugin's `init()`. If the lookup misses, the widgets module failed to bootstrap; check backend startup logs.

## Best Practices

Cache widget data in MongoDB or Redis; never compute inside the data fetcher. Refresh the cache on a scheduled job. Namespace widget ids as `plugin-id:widget-name` so operator pickers stay disambiguated. Pick conservative default route filters — `defaultRoutes: []` means every page, which is usually wrong; scope to the routes where the widget adds value and let operators broaden if they want. Keep the fetcher under 100ms for good SSR latency; 5s is the kill ceiling, not a target.

## Further Reading

- [plugins-widget-zones.md](./plugins-widget-zones.md) — Overview, three concepts, core zone catalog, rendering flow
- [plugins-widget-zones-ssr.md](./plugins-widget-zones-ssr.md) — Component authoring, `IWidgetComponentProps`, SSR + Live Updates
- [system-api-widgets.md](../system/system-api-widgets.md) — Admin REST contract, route grammar, WebSocket event
- [Widgets Module README](../../src/backend/modules/widgets/README.md) — Canonical backend contract, storage schema, indexes
- [plugins-service-registry.md](./plugins-service-registry.md) — How services are published and discovered
- [plugins-frontend-context.md](./plugins-frontend-context.md) — `IFrontendPluginContext` injected into widget components
