# Widgets Module

Owns every concern of the widget subsystem behind a single public surface: `IWidgetsService`, registered on the service registry as `'widgets'` during `WidgetsModule.run()`. Plugins, core modules, admin controllers, and the SSR router all reach widget functionality through this one service — there is no other entry point.

## Quick Reference

| | |
|---|---|
| Module id | `widgets` |
| Admin UI | `/system/widgets` |
| Public service | `'widgets'` on the service registry (`IWidgetsService`) |
| Backend API base | `/api/admin/system/widgets/placements`, `/api/admin/system/widget-types`, `/api/admin/system/zones` (now also `PATCH /:zoneId/layout`), plus SSR fetch at `/api/widgets` |
| WebSocket event | `widgets:placements-update` (also fired on zone-layout change — no separate event) |
| Types package | `@delphian/tronrelic-types` — `IWidgetsService`, `IRegisterWidgetTypeInput`, `IRegisterZoneInput`, `IRegisterWidgetInput`, `IWidgetPlacement`, `IPlacementInput`, `IPlacementPatch`, `IPlacementListFilter`, `IWidgetType`, `IWidgetPlacementContext`, `IZoneDescriptor`, `IZoneSnapshot`, `IZoneLayoutConfig`, `IWidgetTypeSnapshot` |
| Storage | `module_widgets_placements`, `module_widgets_zone_layouts` (MongoDB) |
| Migration | `module:widgets:001_create_widget_placements` (placements collection + 4 indexes). The zone-layouts collection needs no migration — `ZoneLayoutService.load()` creates its unique index idempotently at boot. |
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
| `zones/zone-registry.ts` | Internal zone registry — instantiated by `WidgetsModule.init()`; each snapshot record carries a descriptor-derived `layoutConfig` default |
| `zones/zone-layout.service.ts` | Internal singleton storing operator flexbox overrides (`module_widgets_zone_layouts`); in-memory cache + `defaultLayoutConfigFor(hint)` |
| `zones/define-zone.ts` | Zone descriptor mint |
| `zones/descriptors.ts` | Core zone descriptors as plain `IRegisterZoneInput[]` (the `Site Header` zone — id `ticker-after` — and `footer`); `WidgetsModule.run()` iterates and registers them via the public service |
| `widget-types/core-widget-types.ts` | Core widget-type catalog, built by `buildCoreWidgetTypeDescriptors(deps)` (`core:raw-html`, `core:world-clocks`, `core:block-ticker`); `WidgetsModule.run()` registers each as `'core'`-owned. Frontend renderers live in `components/widgets/widgets.core.ts` |
| `database/IZoneLayoutDocument.ts` | `module_widgets_zone_layouts` document shape + collection constant |
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

### Zones

| Method | Path | Body | Returns | Notes |
|---|---|---|---|---|
| GET | `/api/admin/system/zones` | — | `IZoneSnapshot` — tracks (one per host) → zones, each carrying its effective `layoutConfig` | |
| PATCH | `/api/admin/system/zones/:zoneId/layout` | `IZoneLayoutConfig` | `{ success, layoutConfig }` | 404 unknown zone; 400 off-enum flex value. Persists the operator's flexbox override |

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
| PATCH | `/api/admin/system/widgets/placements/:id` | `IPlacementPatch` | `{ success, placement }` or 404 | Operator-editable on every row, including plugin-source. `title: null` / `titleUrl: null` clears that field; `titleUrl` must be a root-relative internal path |
| DELETE | `/api/admin/system/widgets/placements/:id` | — | 204 / 400 / 404 | 400 on plugin-source rows (use disable or restore-defaults) |
| POST | `/api/admin/system/widgets/placements/:id/restore-defaults` | — | `{ success, placement }` | 400 on operator rows; 409 when plugin has not registered in this process |

### SSR Fetch

| Method | Path | Returns |
|---|---|---|
| GET | `/api/widgets?route=<path>&params=<json>` | `{ widgets: IWidgetData[], zones: Record<string, IZoneLayoutConfig> }` — pre-fetched data plus each zone's effective flexbox layout, ready for SSR embedding |

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

The placement service emits via a callback `WidgetsModule.init()` wires to `WebSocketService.getInstance().emit(...)`. The zone-layout store reuses this same event (`placementId: ''`, `zoneId` set) on a layout write rather than introducing a new event — the admin editor refetches zones and placements together. Broadcast failures are logged but do not roll back the mutation.

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
| `titleUrl` | string? | Operator-only root-relative URL that links the heading; only renders when `title` is set |
| `instanceConfig` | object? | Per-instance config; the type's data fetcher consumes it |
| `enabled` | boolean | `false` hides the row at SSR resolve |
| `source` | `'plugin'` \| `'operator'` | Discriminator; controls disable vs. delete semantics |
| `pluginId` | string? | Set only when `source === 'plugin'` |
| `createdAt` / `updatedAt` | Date | |

Indexes (migration 001): `(typeId, pluginId)` sparse unique for plugin-row atomicity; `(enabled, zoneId, order)` for SSR queries; `routes` multikey; `source`.

`module_widgets_zone_layouts` collection (one row per zone with an operator override; zones with no row fall back to a descriptor-derived default):

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `zoneId` | string | Zone the override applies to. Unique index (created at boot by `ZoneLayoutService.load()`). |
| `preset` | string? | Last-selected named preset, or `custom` when hand-tuned |
| `flexDirection` / `justifyContent` / `alignItems` / `flexWrap` | string | Flex container properties |
| `gap` | string | Token gap size (`none`/`sm`/`md`/`lg` → `--gap-*`) |
| `updatedAt` | Date | |

## Lifecycle Semantics

**Plugin enable** — Plugin code calls `widgets.registerWidget(input, pluginId)` during `init()`. The service caches the original args under `${pluginId}::${typeId}` (for restore-defaults), mints a type descriptor via `defineWidgetType` and stores it in the type registry, then calls `placementService.ensurePluginPlacement(...)` which upserts the row with `enabled: true` while preserving operator customisations on existing rows via `$setOnInsert`.

**Plugin disable** — `PluginManagerService` looks up the widgets service from the registry and calls `widgets.unregisterAllForOwner(pluginId)`, which soft-disables every plugin-source placement, disposes every owned widget type, and disposes every owned zone. Placement rows stay in MongoDB; operator customisations to `order`, `routes`, `title`, `titleUrl`, `instanceConfig` survive the next enable. The plugin-default cache is *not* cleared so restore-defaults continues to work on soft-disabled rows.

**Operator create/edit/delete** — flows through the admin REST endpoints, which adapt to `IWidgetsService` methods. Operator-source rows go in with `source: 'operator'` and no `pluginId`. Plugin-source rows can be patched (order, routes, title, titleUrl, instanceConfig, enabled) but not deleted via the API.

**Restore-defaults** — only valid on plugin-source rows. The service looks up cached registration args by `(pluginId, typeId)` and applies them atomically via `placementService.restoreToPluginDefaults(id, defaults)`; the row's id and `createdAt` survive. Cache misses (plugin never registered this process) throw with a message that translates to HTTP 409 — re-enable the plugin to repopulate.

## Core Catalog

The platform ships its own zones and widget types, registered by `WidgetsModule.run()` as `'core'`-owned through the same public service plugins use — `registerZone` for zones, `registerType` for types. Core types use `registerType` (not `registerWidget`, which is plugin-only and creates a plugin-source placement); operators then place them from `/system/widgets` as `operator`-source rows.

**Zones** live in `zones/descriptors.ts`. The `Site Header` zone (id `ticker-after`, `host: 'site'`) renders directly below the main nav and is where the block ticker now lives; the `footer` zone (`host: 'site'`) renders below `<main>` inside a semantic `<footer>`. Both reach every route. Adding a zone requires a matching `<WidgetZone>` call site in a layout; descriptor and render site move together.

Each descriptor carries an optional `order` (`IZoneDescriptor.order`) that sets where the zone appears within its host track in the `/system/widgets` editor — lower sorts first, so `footer` (order `90`) follows `ticker-after` (order `10`) rather than leading the site track alphabetically. `snapshot()` sorts by `order` then id; zones omitting it sort after explicitly-ordered ones. This orders the *zones* in the editor, distinct from the placement `order` that sorts widgets within a zone.

**Widget types** are built by `buildCoreWidgetTypeDescriptors(deps)` in `widget-types/core-widget-types.ts` — a factory, not a static array, because one fetcher needs a runtime dependency. Three ship today: `core:raw-html` (operator-authored HTML/text block, read from `instanceConfig`), `core:world-clocks` (configured time-zone row), and `core:block-ticker` (the real-time blockchain status row). The ticker fetcher resolves the `'blockchain'` service from the registry at fetch time and returns `{ block }` — the latest processed block, or `null` when none is indexed (wrapped, never bare-null, so the resolver keeps the placement and the component still mounts to receive live `block:new` updates). raw-html and world-clocks ignore `deps`.

A core widget type needs a matching frontend renderer keyed by its `typeId` in `components/widgets/widgets.core.ts`. That hand-written registry is merged ahead of the generator-owned `widgets.generated.ts` by `components/widgets/getWidgetComponent.ts`, so core components resolve without the plugin-registry generator touching them.

**Per-zone flexbox layout.** Every zone renders as a CSS flex container; placed widgets are flex items. The arrangement (direction, justify, align, wrap, gap) is an `IZoneLayoutConfig` an operator sets per zone from `/system/widgets` and the `WidgetZone` renderer applies via inline CSS custom properties (gap maps to `--gap-*` tokens). Overrides persist in `module_widgets_zone_layouts`; a zone with no row uses a default derived from its descriptor's coarse `layout` hint (`vertical` → stacked column, so untouched zones look unchanged). `WidgetsService.listZones()` merges the override (else the default) into each zone's `layoutConfig`, and `/api/widgets` returns a `zoneId → layoutConfig` map so SSR applies layout without a second call.

## SSR Resolution

`PlacementResolver.resolveForRoute(route, params)` (called via `widgets.fetchWidgetsForRoute(route, params)`) runs at every page render: queries enabled placements matching the route via `placementService.findByRoute`, looks up each type's `defaultDataFetcher` in the widget-type registry, invokes each fetcher with `(route, params, { id, instanceConfig })` where the third arg carries the placement's id and operator-editable instance config, runs them in parallel under a 5-second per-fetcher timeout, validates JSON-serialisability via round-trip, sorts by `(zoneId, order)`, and returns the `IWidgetData[]` bundle the frontend embeds. The resolver substitutes `{}` for `instanceConfig` when a placement carries no overrides, so fetchers can read keys without null-guarding every access.

Failures within a fetcher are logged and the widget is omitted — they never propagate out. Placements whose `typeId` is unregistered (e.g. plugin disabled) are silently skipped, leaving the rest of the route's widgets unaffected.

## Instance-Config Schema Validation

Widget types may declare `configSchema` (JSON Schema Draft 7) on registration. The placement admin API compiles each declared schema once via AJV and validates `instanceConfig` against it on every create and patch. Schema-invalid bodies return 400 with `{ error, errors: [{ path, message }] }`; widget types without a schema fall through to the existing shape-only "plain object" guard. The validator cache is keyed on the schema reference (WeakMap), so re-enabling a plugin mints a fresh descriptor and a fresh compiled validator without explicit invalidation.

Consumers retrieve the schema for an arbitrary `typeId` via `IWidgetsService.getTypeConfigSchema(typeId)` — the controller's single touchpoint into the type-side contract. Adminship still flows through `IWidgetsService`; the registry stays internal to the module.
