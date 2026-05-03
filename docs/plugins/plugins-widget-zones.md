# Plugin Widget Zones

Widget zones let plugins inject SSR-fetched UI components into predefined slots on core or other-plugin pages. No target-page edits, no plugin coupling.

## Why Widget Zones Exist

Plugins ship pages and background jobs, but had no way to add inline UI to existing pages without forking them. Zones are predefined injection points the host layout always renders; plugins register against a zone + route filter and the layout pulls in their data and components automatically. Cross-plugin injection works the same way — the target plugin never knows.

## Zone Catalog

| Zone | Host | Position | Use |
|------|------|----------|-----|
| `main-before` | `app/(core)/layout.tsx` | Above core page content | Banners, alerts above core pages |
| `main-after` | `app/(core)/layout.tsx` | Below core page content | Feeds, summaries below core pages |
| `plugin-content:before` | `PluginPageWithZones` wrapper | Above plugin page | Cross-plugin context above plugin pages |
| `plugin-content:after` | `PluginPageWithZones` wrapper | Below plugin page | Cross-plugin context below plugin pages |
| `sidebar-top` | (planned) | Top of sidebar | High-priority sidebar (not yet wired) |
| `sidebar-bottom` | (planned) | Bottom of sidebar | Secondary sidebar (not yet wired) |

Core pages (`/`, `/markets`, `/system/*`) expose `main-*`. Plugin pages (`/whales`, `/tron-memo-tracker`, etc.) expose `plugin-content:*` via the `PluginPageWithZones` server component.

Unknown zone names log a warning at registration but don't fail — additive rollouts are safe.

## SSR Data Flow

Per request the host layout reads the `x-pathname` middleware header, calls `fetchWidgetsForRoute(pathname, params)`, and passes results to `<WidgetZone>`. The backend resolves matching widgets, runs each `fetchData(route, params)` (5s timeout, JSON-validated), and the matching React component renders with that data — no loading flash, no client fetch on initial render.

Static widgets ship zero JS. Interactive widgets hydrate with data already present and may attach WebSocket subscriptions in `useEffect`.

## Detail Documents

| Document | Covers |
|----------|--------|
| [plugins-widget-zones-registration.md](./plugins-widget-zones-registration.md) | `IWidgetConfig`, imperative + declarative registration, route matching, ordering, lifecycle, debugging endpoints |
| [plugins-widget-zones-ssr.md](./plugins-widget-zones-ssr.md) | `widgetComponents` registry, `IWidgetComponentProps`, SSR + Live Updates for widgets, hydration gotchas |

## Related

- [plugins.md](./plugins.md) — Plugin system overview
- [plugins-system-architecture.md](./plugins-system-architecture.md) — Backend lifecycle, frontend build that emits the widget registry
- [plugins-frontend-context.md](./plugins-frontend-context.md) — `IFrontendPluginContext` injected into widget components
- [plugins-page-registration.md](./plugins-page-registration.md) — Menu and full-page registration
- [ui-ssr-hydration.md](../frontend/ui/ui-ssr-hydration.md) — `ClientTime`, two-phase rendering
- [react.md](../frontend/react/react.md) — SSR + Live Updates foundational pattern
