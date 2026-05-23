# Widgets Module

Owns every concern of the widget subsystem behind a single public surface: `IWidgetsService`, registered on the service registry as `'widgets'` during `WidgetsModule.run()`. Plugins, core modules, admin controllers, and the SSR router all reach widget functionality through this one service — there is no other entry point.

## Quick Reference

| | |
|---|---|
| Module id | `widgets` |
| Admin UI | `/system/widgets` |
| Public service | `'widgets'` on the service registry (`IWidgetsService`) |
| Backend API base | `/api/admin/system/widgets/placements`, `/api/admin/system/widget-types`, `/api/admin/system/zones`, plus SSR fetch at `/api/widgets` |
| WebSocket event | `widgets:placements-update` |
| Types package | `@delphian/tronrelic-types` — `IWidgetsService`, `IRegisterWidgetTypeInput`, `IRegisterZoneInput`, `IRegisterWidgetInput`, `IWidgetPlacement`, `IPlacementInput`, `IPlacementPatch`, `IPlacementListFilter`, `IWidgetType`, `IZoneDescriptor`, `IZoneSnapshot`, `IWidgetTypeSnapshot` |
| Storage | `module_widgets_placements` (MongoDB) |
| Migration | `module:widgets:001_create_placements_collection` (creates collection + 4 indexes) |
| System menu node | "Widgets" under the System container — seeded by `WidgetsModule.run()` |

## Source Map

| File | Purpose |
|------|---------|
| `WidgetsModule.ts` | `IModule` impl: wires registries, placement service, resolver, widgets service, mounts three admin routers, seeds menu entry |
| `widgets.service.ts` | `WidgetsService` singleton implementing `IWidgetsService`. Composes the three internal collaborators behind one surface; published on the service registry |
| `placements/placement.service.ts` | `IPlacementService` singleton (internal): CRUD, `ensurePluginPlacement`, `softDisableForPlugin`, `findByRoute`, `restoreToPluginDefaults`, broadcast hook |
| `placements/placement-resolver.ts` | SSR-time join of placements ↔ widget-type descriptors with 5s timeout and JSON serialisability check |
| `placements/route-matcher.ts` | `routeMatches` predicate, `normaliseRoutePattern` validator, `partitionRoutePatterns` for the admin path |
| `widget-types/widget-type-registry.ts` | Internal widget-type registry — instantiated by `WidgetsModule.init()` |
| `widget-types/define-widget-type.ts` | Descriptor mint — runtime registry refuses unminted descriptors |
| `zones/zone-registry.ts` | Internal zone registry — instantiated by `WidgetsModule.init()` |
| `zones/define-zone.ts` | Zone descriptor mint |
| `zones/descriptors.ts` | Core zone descriptors as plain `IRegisterZoneInput[]`; `WidgetsModule.run()` iterates and registers them via the public service |
| `api/zones.controller.ts` / `zones.routes.ts` | Read-only zone snapshot adapter over `IWidgetsService.listZones()` |
| `api/widget-types.controller.ts` / `widget-types.routes.ts` | Read-only widget-type snapshot adapter over `IWidgetsService.listTypes()` |
| `api/placements.controller.ts` / `placements.routes.ts` | Placement CRUD + restore-defaults adapter over `IWidgetsService` |
| `database/IWidgetPlacementDocument.ts` | Mongo document shape + collection constant |
| `migrations/001_create_placements_collection.ts` | Initial schema |

## Public Service Contract

`IWidgetsService` (defined in `@delphian/tronrelic-types`) exposes three groups of operations:

**Discovery** — `listZones()`, `listTypes()`, `hasZone(id)`, `hasType(id)`, `fetchWidgetsForRoute(route, params?)`. The last is the SSR entry point that `GET /api/widgets` adapts.

**Registration** — `registerType(input, ownerId)`, `registerZone(input, ownerId)`, `registerWidget(input, ownerId)` (combined type + default placement), `unregisterAllForOwner(ownerId)`. Identity is trust-based: the caller passes `ownerId`, the service trusts it. Matches the rest of the service registry.

**Placement CRUD** — `listPlacements(filter?)`, `findPlacementById(id)`, `createPlacement(input)`, `updatePlacement(id, patch)`, `deletePlacement(id)`, `restorePluginDefaults(id)`. The admin controllers are thin HTTP adapters over these.

Internal types (`IZoneRegistry`, `IWidgetTypeRegistry`, `IPlacementService`, `IPluginPlacementInput`, `IDefineZoneOptions`, `IDefineWidgetTypeOptions`) remain exported from `@delphian/tronrelic-types` because the module's own implementation references them, but consumers must not import them — they are not part of the public surface and the convention is enforced by review, not by the type system.

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
| POST | `/api/admin/system/widgets/placements` | `IPlacementInput` | `{ success, placement }` 201 | Always `source: 'operator'`; rejects unknown `typeId`/`zoneId` |
| PATCH | `/api/admin/system/widgets/placements/:id` | `IPlacementPatch` | `{ success, placement }` or 404 | Operator-editable on every row, including plugin-source. `title: null` clears the override |
| DELETE | `/api/admin/system/widgets/placements/:id` | — | 204 / 400 / 404 | 400 on plugin-source rows (use disable or restore-defaults) |
| POST | `/api/admin/system/widgets/placements/:id/restore-defaults` | — | `{ success, placement }` | 400 on operator rows; 409 when plugin has not registered in this process |

### SSR Fetch

| Method | Path | Returns |
|---|---|---|
| GET | `/api/widgets?route=<path>&params=<json>` | `{ widgets: IWidgetData[] }` — pre-fetched data ready for SSR embedding |

The pre-split admin read endpoints (`/api/widgets/all`, `/api/widgets/zones/:zone`) have been deleted. Admin reads happen on the admin namespace above.

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

**Plugin enable** — Plugin code calls `widgets.registerWidget(input, pluginId)` during `init()`. The service caches the original args under `${pluginId}::${typeId}` (for restore-defaults), mints a type descriptor via `defineWidgetType` and stores it in the type registry, then calls `placementService.ensurePluginPlacement(...)` which upserts the row with `enabled: true` while preserving operator customisations on existing rows via `$setOnInsert`.

**Plugin disable** — `PluginManagerService` looks up the widgets service from the registry and calls `widgets.unregisterAllForOwner(pluginId)`, which soft-disables every plugin-source placement, disposes every owned widget type, and disposes every owned zone. Placement rows stay in MongoDB; operator customisations to `order`, `routes`, `title`, `instanceConfig` survive the next enable. The plugin-default cache is *not* cleared so restore-defaults continues to work on soft-disabled rows.

**Operator create/edit/delete** — flows through the admin REST endpoints, which adapt to `IWidgetsService` methods. Operator-source rows go in with `source: 'operator'` and no `pluginId`. Plugin-source rows can be patched (order, routes, title, enabled) but not deleted via the API.

**Restore-defaults** — only valid on plugin-source rows. The service looks up cached registration args by `(pluginId, typeId)` and applies them atomically via `placementService.restoreToPluginDefaults(id, defaults)`; the row's id and `createdAt` survive. Cache misses (plugin never registered this process) throw with a message that translates to HTTP 409 — re-enable the plugin to repopulate.

## SSR Resolution

`PlacementResolver.resolveForRoute(route, params)` (called via `widgets.fetchWidgetsForRoute(route, params)`) runs at every page render: queries enabled placements matching the route via `placementService.findByRoute`, looks up each type's `defaultDataFetcher` in the widget-type registry, runs them in parallel under a 5-second per-fetcher timeout, validates JSON-serialisability via round-trip, sorts by `(zoneId, order)`, and returns the `IWidgetData[]` bundle the frontend embeds.

Failures within a fetcher are logged and the widget is omitted — they never propagate out. Placements whose `typeId` is unregistered (e.g. plugin disabled) are silently skipped, leaving the rest of the route's widgets unaffected.
