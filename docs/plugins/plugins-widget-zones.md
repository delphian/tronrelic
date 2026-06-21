# Plugin Widget Zones

Widget zones let plugins inject SSR-fetched UI into predefined slots on core pages, plugin pages, or the admin shell — without forking the host. The model splits cleanly into three concepts so plugin code, operator overrides, and the rendering pipeline each own one slice.

## Why This Matters

Plugins ship pages and background jobs, but inline UI on someone else's page used to mean editing that page. Zones make injection points first-class: the host layout always renders the zone, the registry resolves what fills it, and the operator can override where any widget appears without redeploy. Cross-plugin injection works the same way — the target plugin never knows another plugin extended it.

## Three Concepts

**Zones** are named slots a layout exposes. Core declares five built-in zones (see [Core Zone Catalog](#core-zone-catalog) below); plugins declare additional zones through the unified widgets service. The zone registry is in-memory, rebuilt from registrations on plugin enable, and lost on restart.

**Widget types** are the renderable units. They are plugin-owned — core ships zero — and register through the unified widgets service. Each type carries the data-fetching function the SSR resolver calls and the component the frontend renders. The widget-type registry is also in-memory.

**Placements** are the persistent mapping of "this type, in this zone, on these routes, with this order and config." Placements live in MongoDB (`module_widgets_placements`) and carry a `source: 'plugin' | 'operator'` discriminator. Plugin-source placements are upserted automatically when the plugin enables, soft-disabled when it disables (operator customizations preserved across that cycle), and never deleted by the API. Operator-source placements are created freely from `/system/widgets` and can be hard-deleted.

Every operation — register, list, mutate, resolve — flows through one named service: **`IWidgetsService`**, registered on the service registry as `'widgets'`. Plugins and core modules consume it via `context.services.get<IWidgetsService>('widgets')`; no per-plugin facade rides on `IPluginContext`. See [plugins-widget-zones-registration.md](./plugins-widget-zones-registration.md) for the full API.

## Core Zone Catalog

| Zone id | Host | Where it renders | Typical use |
|---|---|---|---|
| `ticker-after` | `site` | Root layout, below the block ticker | Reaches every route the root layout serves — scope with route filters |
| `main-before` | `core` | Above page content inside the `(core)` route group | Banners, alerts on front-of-house pages |
| `main-after` | `core` | Below page content inside the `(core)` route group | Feeds, summaries on front-of-house pages |
| `plugin-content:before` | `plugin` | Above each plugin page via `PluginPageWithZones` | Cross-plugin injection above plugin pages |
| `plugin-content:after` | `plugin` | Below each plugin page via `PluginPageWithZones` | Cross-plugin injection below plugin pages |

Source of truth: `src/backend/modules/widgets/zones/descriptors.ts`. Adding a zone requires editing that file *and* adding a matching `<WidgetZone>` call site in a layout — the two must move together. Unknown zone ids in plugin or operator placements are rejected at write time by the admin API; the SSR resolver simply skips placements pointing at zones that no longer exist.

## Rendering Flow

Per request, the host layout reads the `x-pathname` middleware header and calls `fetchWidgetsForRoute(route, params)`. The backend (`/api/widgets?route=...`) joins matching placements against the widget-type registry, runs each type's `defaultDataFetcher(route, params)` in parallel under a 5-second timeout, validates JSON-serialisability, and returns the bundle. The matching React component renders with that data already populated — no loading flash, no client-side fetch on initial render. Interactive widgets hydrate and may attach WebSocket subscriptions in `useEffect`.

## Operator Editing

`/system/widgets` is the placement editor. Each placement appears as a bubble in its zone; operators can toggle, edit, reorder (drag-and-drop, including cross-zone), restore plugin defaults, or delete operator-created rows. A zone (or a `core:layout-group` nested in one) also exposes its flexbox arrangement, a per-row relative-width control, and a `collapseBelow` breakpoint that stacks a side-by-side row into a column on narrow containers — see the [Widgets Module README](../../src/backend/modules/widgets/README.md#single-level-grouping) for the per-child width and container-query collapse mechanism. Mutations broadcast `widgets:placements-update` over WebSocket so every open admin tab refetches and public pages re-pull widget data. The full REST contract is in [system-api-widgets.md](../system/system-api-widgets.md).

## Detail Documents

| Document | Covers |
|---|---|
| [plugins-widget-zones-registration.md](./plugins-widget-zones-registration.md) | Backend: registering widget types, declaring plugin zones, plugin placements via `IWidgetsService.registerWidget`, operator-overridable fields, lifecycle semantics |
| [plugins-widget-zones-ssr.md](./plugins-widget-zones-ssr.md) | Frontend: `widgetComponents` registry, `IWidgetComponentProps`, SSR + Live Updates for widgets, hydration gotchas |
| [system-api-widgets.md](../system/system-api-widgets.md) | Admin REST surface: `/api/admin/system/zones`, `/widget-types`, `/widgets/placements`, route grammar, WebSocket event |
| [Widgets Module README](../../src/backend/modules/widgets/README.md) | Canonical backend contract — service signatures, storage schema, indexes, lifecycle |

## Related

- [plugins.md](./plugins.md) — Plugin system overview and extension surfaces
- [plugins-system-architecture.md](./plugins-system-architecture.md) — Backend lifecycle, frontend build that emits the widget registry
- [plugins-frontend-context.md](./plugins-frontend-context.md) — `IFrontendPluginContext` injected into widget components
- [react.md](../frontend/react/react.md) — SSR + Live Updates foundational pattern
- [ui-ssr-hydration.md](../frontend/ui/ui-ssr-hydration.md) — `ClientTime`, two-phase rendering
