# Widgets Module

Splits widget rendering into two persistent concerns: **types** (what a widget *is* — plugin-owned code) and **placements** (where a widget *appears* — operator-editable data). Plugin code keeps calling the legacy `widgetService.register(...)` API; the module's compat shim routes those calls into the type/placement infrastructure transparently. Operators edit placements at `/system/widgets`; changes broadcast over WebSocket so public pages live-refresh.

## Quick Reference

| | |
|---|---|
| Module id | `widgets` |
| Admin UI | `/system/widgets` |
| Backend API base | `/api/admin/system/widgets/placements`, `/api/admin/system/widget-types`, `/api/admin/system/zones` |
| WebSocket event | `widgets:placements-update` |
| Types package | `@delphian/tronrelic-types` — `IPlacementService`, `IWidgetPlacement`, `IPlacementInput`, `IPlacementPatch`, `IPluginPlacementInput`, `PlacementSource`, `IZoneRegistry`, `IZoneSnapshot`, `IWidgetTypeRegistry`, `IWidgetTypeSnapshot` |
| Storage | `module_widgets_placements` (MongoDB) |
| Migration | `module:widgets:001_create_placements_collection` (creates collection + 4 indexes) |
| System menu node | "Widgets" under the System container — seeded by `WidgetsModule.run()` |
| Legacy compat shim | `WidgetService` singleton at `src/backend/services/widget/widget.service.ts` |

## Source Map

| File | Purpose |
|------|---------|
| `WidgetsModule.ts` | `IModule` impl: wires registries, placement service, broadcast callback, mounts three admin routers, seeds menu entry |
| `placements/placement.service.ts` | `IPlacementService` singleton: CRUD, `ensurePluginPlacement`, `softDisableForPlugin`, `findByRoute`, `restoreToPluginDefaults`, broadcast hook |
| `placements/placement-resolver.ts` | SSR-time join of placements ↔ widget-type descriptors with 5s timeout and JSON serialisability check |
| `placements/route-matcher.ts` | `routeMatches` predicate, `normaliseRoutePattern` validator, `partitionRoutePatterns` for the admin path |
| `widget-types/widget-type-registry.ts` | Process-wide widget-type registry — bootstrap-instantiated, threaded into the plugin loader |
| `widget-types/define-widget-type.ts` | Descriptor mint — runtime registry refuses unminted descriptors |
| `widget-types/plugin-widget-types.ts` | Per-plugin facade (`context.widgetTypes`) tagging every registration with the plugin id |
| `zones/zone-registry.ts` | Process-wide zone registry, auto-populated from core descriptors at module load |
| `zones/define-zone.ts` | Zone descriptor mint |
| `zones/descriptors.ts` | Core zone descriptors (`ZONES`) |
| `api/zones.controller.ts` / `zones.routes.ts` | Read-only zone snapshot endpoint |
| `api/widget-types.controller.ts` / `widget-types.routes.ts` | Read-only widget-type snapshot endpoint |
| `api/placements.controller.ts` / `placements.routes.ts` | Placement CRUD + restore-defaults endpoints |
| `database/IWidgetPlacementDocument.ts` | Mongo document shape + collection constant |
| `migrations/001_create_placements_collection.ts` | Initial schema |
| `../../services/widget/widget.service.ts` | Legacy `IWidgetService` compat shim — caches plugin defaults, splits `register()` into type + placement |

## REST Contract

All endpoints require admin auth (cookie path: verified wallet + admin group; service-token path: `ADMIN_API_TOKEN` via `x-admin-token` or `Authorization: Bearer`). All three routers chain `createAdminRateLimiter` before `requireAdmin`.

### Zones — read-only

| Method | Path | Returns |
|---|---|---|
| GET | `/api/admin/system/zones` | `IZoneSnapshot` — tracks (one per host) → zones |

### Widget Types — read-only

| Method | Path | Returns |
|---|---|---|
| GET | `/api/admin/system/widget-types` | `IWidgetTypeSnapshot` — groups (one per declaring plugin) → types |

### Placements — full CRUD

| Method | Path | Body | Returns | Notes |
|---|---|---|---|---|
| GET | `/api/admin/system/widgets/placements` | — | `{ success, placements: IWidgetPlacement[] }` | Query: `zoneId?`, `pluginId?`, `source?` (`plugin`\|`operator`), `enabledOnly?` |
| GET | `/api/admin/system/widgets/placements/:id` | — | `{ success, placement }` or 404 | |
| POST | `/api/admin/system/widgets/placements` | `IPlacementInput` | `{ success, placement }` 201 | Always `source: 'operator'`; rejects unknown `typeId`/`zoneId`/route patterns/order out of `[0,10000]`/title > 80 chars |
| PATCH | `/api/admin/system/widgets/placements/:id` | `IPlacementPatch` | `{ success, placement }` or 404 | Operator-editable on every row, including plugin-source. `title: null` clears the override (`$unset`); omitting `title` leaves it unchanged |
| DELETE | `/api/admin/system/widgets/placements/:id` | — | 204 / 400 / 404 | 400 on plugin-source rows (use disable or restore-defaults) |
| POST | `/api/admin/system/widgets/placements/:id/restore-defaults` | — | `{ success, placement }` | 400 on operator rows; 409 when plugin has not registered in this process |

## Route Pattern Grammar

`routes` arrays accept three forms, validated by `normaliseRoutePattern` and matched by `routeMatches`:

| Form | Matches | Example |
|---|---|---|
| Exact | The literal path, nothing else | `/`, `/markets` |
| Single-segment glob | One trailing segment, no deeper | `/u/*` matches `/u/TXyz`, not `/u/TXyz/holdings` |
| Deep glob | Any depth below the prefix | `/admin/**` matches `/admin/users/edit` |

Empty `routes: []` matches every route. Glob markers are only valid at the trailing position — `/*/markets` is rejected at write time.

## WebSocket Contract

| Event | Direction | Payload | Audience |
|---|---|---|---|
| `widgets:placements-update` | server → all | `{ event: 'placement:created' \| 'placement:updated' \| 'placement:deleted' \| 'placement:restored', placementId, zoneId?, timestamp }` | All connected sockets — public pages must refetch widget data to pick up operator changes |

The placement service emits via a callback `WidgetsModule.init()` wires to `WebSocketService.getInstance().emit(...)`. Broadcast failures are logged but do not roll back the mutation.

## Storage Schema

`module_widgets_placements` collection (one row per placement):

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `typeId` | string | Widget-type id this placement renders |
| `zoneId` | string | Zone id this placement targets |
| `routes` | string[] | Route filter — empty matches every route |
| `order` | number | Sort key within zone (lower renders first); plugin default `100` |
| `title` | string? | Operator override of widget heading |
| `instanceConfig` | object? | Per-instance config; the type's data fetcher consumes it |
| `enabled` | boolean | `false` hides the row at SSR resolve |
| `source` | `'plugin'` \| `'operator'` | Discriminator; controls disable vs. delete semantics |
| `pluginId` | string? | Set only when `source === 'plugin'` |
| `createdAt` / `updatedAt` | Date | |

Indexes (migration 001): `(typeId, pluginId)` sparse unique for plugin-row atomicity; `(enabled, zoneId, order)` for SSR queries; `routes` multikey; `source`.

## Lifecycle Semantics

**Plugin register/enable** — `widgetService.register(config, pluginId)` calls land in the compat shim which (a) caches the original args under `${pluginId}::${typeId}` for restore-defaults, (b) mints a type descriptor via `defineWidgetType` and stores it in the registry, (c) calls `placementService.ensurePluginPlacement(...)` which upserts the row with `enabled: true` while preserving any operator customisations on existing rows.

**Plugin disable** — `widgetService.unregisterAll(pluginId)` calls `placementService.softDisableForPlugin(pluginId)` which flips `enabled: false` on every plugin-source row. Rows stay in the DB so operator customisations survive re-enable. The plugin-default cache is *not* cleared so restore-defaults still works on soft-disabled rows.

**Operator create/edit/delete** — flows through the admin REST endpoints. Operator-source rows go in with `source: 'operator'` and no `pluginId`. Plugin-source rows can be patched (order, routes, title, enabled) but not deleted via the API — the supported reversals are disable and restore-defaults.

**Restore-defaults** — only valid on plugin-source rows. Resolves the cached registration args from the widget service and applies them as a single `$set` (re-enabling, resetting order/routes/title); the row's id and `createdAt` survive. Cache misses (plugin never registered this process) return 409 — re-enable the plugin to repopulate.

## SSR Resolution

`PlacementResolver.resolveForRoute(route, params)` runs at every page render:

1. `placementService.findByRoute(route)` pulls `enabled: true` rows whose `routes` either is empty, matches exactly, or contains a glob suffix (post-filtered by `routeMatches` in-memory for grammar correctness).
2. Each placement joins to its `IWidgetType` descriptor via the registry. Unregistered types (plugin disabled) silently skip.
3. The type's `defaultDataFetcher(route, params)` runs in parallel with a 5s `Promise.race` timeout and a JSON round-trip serialisability check. Failed fetches drop with an error log; one bad widget cannot drag down the page.
4. Results sort by `(zoneId asc, order asc)` and return as `IWidgetData[]` matching the legacy frontend `<WidgetZone>` contract.

## Lifecycle Obligations

- Modules and plugins do not call `defineWidgetType` or `defineZone` directly — use the per-plugin facade (`context.widgetTypes`, `context.zones`) so registrations carry the owning plugin id and clean up on disable.
- Type ids are exclusive — the registry refuses cross-plugin id conflicts and the compat shim refuses to upsert a placement under those conditions.
- The placement service is a singleton (`PlacementService.getInstance()`); always inject via the module rather than re-instantiate. `setDependencies` is idempotent — first call wins.
- Broadcast callback is wired exactly once during `WidgetsModule.init()`. Tests that touch `PlacementService` directly should call `__resetForTests()` between cases.

## Related

- [system-database.md](../../../docs/system/system-database.md) — `IDatabaseService` rules the placement service follows
- [system-hooks.md](../../../docs/system/system-hooks.md) — Adjacent system for *core inviting plugins in*; widgets is the inverse direction (plugins publishing types core renders)
- [plugins-widget-zones.md](../../../docs/plugins/plugins-widget-zones.md) — Plugin-side widget-zone integration patterns
- [plugins-frontend-context-styling.md](../../../docs/plugins/plugins-frontend-context-styling.md) — How widgets render on the frontend
