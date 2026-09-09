# Widgets Module

Owns every concern of the widget subsystem behind a single public surface: `IWidgetsService`, registered on the service registry as `'widgets'` during `WidgetsModule.run()`. Plugins, core modules, admin controllers, and the SSR router all reach widget functionality through this one service — there is no other entry point.

## Quick Reference

| | |
|---|---|
| Module id | `widgets` |
| Admin UI | `/system/widgets` — Placements tab (the editor, `src/frontend/modules/widgets/`) and Database tab (`CollectionBrowser` scoped to `module_widgets_`) |
| Public service | `'widgets'` on the service registry (`IWidgetsService`) |
| Backend API base | `/api/admin/system/widgets/placements`, `/api/admin/system/widget-types`, `/api/admin/system/zones` (now also `PATCH /:zoneId/layout`), plus SSR fetch at `/api/widgets` |
| WebSocket event | `widgets:placements-update` (also fired on zone-layout change — no separate event) |
| Types package | `@delphian/tronrelic-types` — `IWidgetsService`, `IRegisterWidgetTypeInput`, `IRegisterZoneInput`, `IRegisterWidgetInput`, `IWidgetPlacement`, `IPlacementInput`, `IPlacementPatch`, `WidgetTitleSize`, `IPlacementListFilter`, `IWidgetType`, `IWidgetPlacementContext`, `IZoneDescriptor`, `IZoneSnapshot`, `IZoneLayoutConfig`, `IWidgetTypeSnapshot` |
| Storage | `module_widgets_placements`, `module_widgets_zone_layouts` (MongoDB) |
| Migration | `module:widgets:001_create_widget_placements` (placements collection + 4 indexes); `module:widgets:002_seed_block_ticker_placement` (idempotent seed of one operator-source `core:block-ticker` placement in `ticker-after`, guarded on absence so it runs once and never fights an operator edit); `module:widgets:003_add_parent_id_index` (sparse `parentId` index for child grouping); `module:widgets:004_repair_plugin_placement_index` (drops the mis-scoped sparse unique `(typeId, pluginId)` index and recreates it partial — `partialFilterExpression: { pluginId: { $exists: true } }` — so operators can place a widget type more than once). The zone-layouts collection needs no migration — `ZoneLayoutService.load()` creates its unique index idempotently at boot. |
| System menu node | "Widgets" under the System container — seeded by `WidgetsModule.run()` |
| Submenu namespace | `widgets` — memory-only tab nodes (`?tab=placements`, `?tab=database`) seeded by `WidgetsModule.run()`; the page renders them with `MenuNavClient` (menu module's Submenu Pattern) |

## Source Map

| File | Purpose |
|------|---------|
| `WidgetsModule.ts` | `IModule` impl: wires registries, placement service, resolver, widgets service, mounts three admin routers, seeds menu entry |
| `widgets.service.ts` | `WidgetsService` singleton implementing `IWidgetsService`. Composes the three internal collaborators behind one surface; published on the service registry |
| `placements/placement.service.ts` | `IPlacementService` singleton (internal): CRUD, `ensurePluginPlacement`, `softDisableForPlugin`, `findByRoute`, `restoreToPluginDefaults`, `detachChildrenOf` (container-delete child relocation), broadcast hook |
| `placements/placement-resolver.ts` | SSR-time join of placements ↔ widget-type descriptors with 5s timeout and JSON serialisability check |
| `placements/route-matcher.ts` | `routeMatches` predicate, `normaliseRoutePattern` validator, `partitionRoutePatterns` for the admin path |
| `widget-types/widget-type-registry.ts` | Internal widget-type registry — instantiated by `WidgetsModule.init()` |
| `widget-types/define-widget-type.ts` | Descriptor mint — runtime registry refuses unminted descriptors |
| `zones/zone-registry.ts` | Internal zone registry — instantiated by `WidgetsModule.init()`; each snapshot record carries a descriptor-derived `layoutConfig` default |
| `zones/zone-layout.service.ts` | Internal singleton storing operator flexbox overrides (`module_widgets_zone_layouts`); in-memory cache + `defaultLayoutConfigFor(hint)` |
| `zones/define-zone.ts` | Zone descriptor mint |
| `zones/descriptors.ts` | Core zone descriptors as plain `IRegisterZoneInput[]` (`site-top`, the `Site Header` zone — id `ticker-after` — and `footer`); `WidgetsModule.run()` iterates and registers them via the public service |
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
| PATCH | `/api/admin/system/zones/:zoneId/layout` | `IZoneLayoutConfig` | `{ success, layoutConfig }` | 404 unknown zone; 400 off-enum flex value. Persists the operator's flexbox override, including the optional `collapseBelow` breakpoint |

### Widget Types — read-only

| Method | Path | Returns |
|---|---|---|
| GET | `/api/admin/system/widget-types` | `IWidgetTypeSnapshot` — groups (one per declaring plugin) → types |

### Placements — full CRUD

| Method | Path | Body | Returns | Notes |
|---|---|---|---|---|
| GET | `/api/admin/system/widgets/placements` | — | `{ success, placements: IWidgetPlacement[] }` | Query: `zoneId?`, `pluginId?`, `source?` (`plugin`\|`operator`), `enabledOnly?` |
| GET | `/api/admin/system/widgets/placements/:id` | — | `{ success, placement }` or 404 | |
| POST | `/api/admin/system/widgets/placements` | `IPlacementInput` | `{ success, placement }` 201 | Always `source: 'operator'`; rejects unknown `typeId`/`zoneId`. Optional `parentId` nests the row in a layout group (400 if the parent isn't a top-level `core:layout-group`); a nested row's `zoneId` is forced to the parent's zone and its `routes` cleared |
| PATCH | `/api/admin/system/widgets/placements/:id` | `IPlacementPatch` | `{ success, placement }` or 404 | Operator-editable on every row, including plugin-source. `title: null` / `titleUrl: null` clears that field; `titleUrl` must be a root-relative internal path. `titleSize` is three-state like `title` — one of the `heading-*` tokens sets the chrome-title size, `null` reverts it to the default `heading-md`, omission leaves it unchanged. `parentId` is three-state like `title` — a 24-hex id attaches (forcing zone, and clearing routes when the patch does not state a filter of its own), `null` detaches to the zone and copies the former container's `routes` onto the row when the row has no filter of its own, unless the same patch states its own `routes`; omission leaves nesting unchanged. A non-empty `routes` on a row that is still nested once the patch applies is rejected 400, whether the patch omits `parentId`, echoes the current one, or states a new one — detach it in the same patch to scope it. `layoutWeight` is three-state too — an integer 1–12 sets the row's relative width, `null` clears it to auto, omission leaves it unchanged |
| DELETE | `/api/admin/system/widgets/placements/:id` | — | 204 / 400 / 404 | 400 on plugin-source rows (use disable or restore-defaults). Deleting a `core:layout-group` container detaches its children back to the zone (clears their `parentId`, and copies the container's `routes` onto each child) rather than cascade-deleting them |
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
| Single-segment glob | One trailing segment, no deeper | `/tools/*` matches `/tools/energy-estimator`, not `/tools/energy-estimator/faq` |
| Deep glob | Any depth below the prefix | `/system/**` matches `/system/plugins/trp-forum` |

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
| `parentId` | ObjectId? | Set only on a child nested in a `core:layout-group`; references the container row's `_id`. Exposed publicly as the hex string `parentId`. Sparse-indexed (migration 003) |
| `routes` | string[] | Route filter — empty matches every route |
| `order` | number | Sort key within zone (lower renders first); plugin default `100` |
| `layoutWeight` | number? | Relative row width as a flex weight (`flex-grow` against a zero basis) when the container lays out in a row; absent means auto width. Bounded 1–12 at the admin boundary. Cleared on restore-defaults alongside `parentId` |
| `title` | string? | Operator override of widget heading |
| `titleUrl` | string? | Operator-only root-relative URL that links the heading; only renders when `title` is set |
| `titleSize` | string? | Operator-only heading-size token (`heading-xs`\|`sm`\|`md`\|`lg`\|`xl`) for the chrome title; absent renders `heading-md` |
| `instanceConfig` | object? | Per-instance config; the type's data fetcher consumes it |
| `enabled` | boolean | `false` hides the row at SSR resolve |
| `source` | `'plugin'` \| `'operator'` | Discriminator; controls disable vs. delete semantics |
| `pluginId` | string? | Set only when `source === 'plugin'` |
| `createdAt` / `updatedAt` | Date | |

Indexes: `(typeId, pluginId)` unique for plugin-row atomicity — **partial**, `partialFilterExpression: { pluginId: { $exists: true } }` (migration 004; migration 001 created it `sparse`, which wrongly indexed pluginId-less operator rows and blocked a second operator placement of the same `typeId`); `(enabled, zoneId, order)` for SSR queries; `routes` multikey; `source` (all migration 001). Because the unique index covers only plugin rows, operator-source placements may repeat a `typeId` in any zone freely.

`module_widgets_zone_layouts` collection (one row per zone with an operator override; zones with no row fall back to a descriptor-derived default):

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `zoneId` | string | Zone the override applies to. Unique index (created at boot by `ZoneLayoutService.load()`). |
| `preset` | string? | Last-selected named preset, or `custom` when hand-tuned |
| `flexDirection` / `justifyContent` / `alignItems` / `flexWrap` | string | Flex container properties |
| `gap` | string | Token gap size (`none`/`sm`/`md`/`lg` → `--gap-*`) |
| `collapseBelow` | string? | Container width below which the zone collapses to a stacked column (`never`/`mobile-sm`/`mobile-md`/`mobile-lg`/`tablet`/`desktop`). Absent/`never` keeps the row at every width |
| `updatedAt` | Date | |

## Lifecycle Semantics

**Plugin enable** — Plugin code calls `widgets.registerWidget(input, pluginId)` during `init()`. The service caches the original args under `${pluginId}::${typeId}` (for restore-defaults), mints a type descriptor via `defineWidgetType` and stores it in the type registry, then calls `placementService.ensurePluginPlacement(...)` which upserts the row with `enabled: true` while preserving operator customisations on existing rows via `$setOnInsert`.

**Plugin disable** — `PluginManagerService` looks up the widgets service from the registry and calls `widgets.unregisterAllForOwner(pluginId)`, which soft-disables every plugin-source placement, disposes every owned widget type, and disposes every owned zone. Placement rows stay in MongoDB; operator customisations to `order`, `routes`, `title`, `titleUrl`, `instanceConfig` survive the next enable. The plugin-default cache is *not* cleared so restore-defaults continues to work on soft-disabled rows.

**Operator create/edit/delete** — flows through the admin REST endpoints, which adapt to `IWidgetsService` methods. Operator-source rows go in with `source: 'operator'` and no `pluginId`. Plugin-source rows can be patched (order, routes, title, titleUrl, instanceConfig, enabled) but not deleted via the API.

**Restore-defaults** — only valid on plugin-source rows. The service looks up cached registration args by `(pluginId, typeId)` and applies them atomically via `placementService.restoreToPluginDefaults(id, defaults)`; the row's id and `createdAt` survive. Cache misses (plugin never registered this process) throw with a message that translates to HTTP 409 — re-enable the plugin to repopulate.

## Core Catalog

The platform ships its own zones and widget types, registered by `WidgetsModule.run()` as `'core'`-owned through the same public service plugins use — `registerZone` for zones, `registerType` for types. Core types use `registerType` (not `registerWidget`, which is plugin-only and creates a plugin-source placement); operators then place them from `/system/widgets` as `operator`-source rows. The one exception is `core:block-ticker`: because it was historically rendered unconditionally in the root layout, migration `002_seed_block_ticker_placement` seeds one operator-source placement in `ticker-after` so the site-wide ticker renders by default — operators remain free to move, reconfigure, or delete it.

**Zones** live in `zones/descriptors.ts`. The `Site top` zone (id `site-top`, `host: 'site'`) is the first element inside `<body>`, above `MainHeader`, and is the only zone that can put a widget above the site navigation. The `Site Header` zone (id `ticker-after`, `host: 'site'`) renders directly below the main nav and is where the block ticker is seeded; the `footer` zone (`host: 'site'`) renders below `<main>` inside a semantic `<footer>`. All three reach every route the root layout serves, admin pages included. Adding a zone requires a matching `<WidgetZone>` call site in a layout; descriptor and render site move together.

`site-top` deliberately applies no width constraint or styling of its own, so it can hold either a full-bleed strip or content aligned to the header. An operator shapes it through the zone's `layoutConfig` — arrangement, gap, `collapseBelow`, and `customCss` — the same controls every other zone exposes.

Each descriptor carries an optional `order` (`IZoneDescriptor.order`) that sets where the zone appears within its host track in the `/system/widgets` editor — lower sorts first, so the site track reads `site-top` (order `0`), `ticker-after` (order `10`), `footer` (order `90`) rather than sorting alphabetically. `snapshot()` sorts by `order` then id; zones omitting it sort after explicitly-ordered ones. This orders the *zones* in the editor, distinct from the placement `order` that sorts widgets within a zone.

**Widget types** are built by `buildCoreWidgetTypeDescriptors(deps)` in `widget-types/core-widget-types.ts` — a factory, not a static array, because one fetcher needs a runtime dependency. Four ship today: `core:raw-html` (operator-authored HTML/text block, read from `instanceConfig`), `core:world-clocks` (configured time-zone row), `core:layout-group` (the structural container — see [Single-level grouping](#single-level-grouping)), and `core:block-ticker` (the real-time blockchain status row). The ticker fetcher resolves the `'blockchain'` service from the registry at fetch time and returns `{ block }` — the latest processed block, or `null` when none is indexed (wrapped, never bare-null, so the resolver keeps the placement and the component still mounts to receive live `block:new` updates). raw-html, world-clocks, and layout-group ignore `deps`.

A core widget type needs a matching frontend renderer keyed by its `typeId` in `components/widgets/widgets.core.ts`. That hand-written registry is merged ahead of the generator-owned `widgets.generated.ts` by `components/widgets/getWidgetComponent.ts`, so core components resolve without the plugin-registry generator touching them. **`core:layout-group` is the one exception** — it has no registry entry because it has no UI of its own; `WidgetZone` special-cases its `typeId`, drawing its children inside a nested flex container.

## Single-level grouping

An operator can group widgets inside a zone by placing a `core:layout-group` container and nesting other widgets in it, giving that subset its own flexbox arrangement (a row of widgets inside a column zone, say) without a new zone or render site. Nesting is intentionally **one level deep**: a container is always top-level, and a child is always a leaf.

A child points at its container through the placement `parentId`. `WidgetsService` enforces the contract on create/attach — the parent must exist, be a `core:layout-group`, and be top-level; a layout group can never itself be nested — and forces the child into the parent's zone with an empty route filter so the container alone governs where the group renders (`InvalidParentPlacementError` → HTTP 400 otherwise). Deleting a container calls `IPlacementService.detachChildrenOf(id, routes)`, relocating its children back to the zone (`$unset parentId`) so operator-configured widgets survive. A child with an empty route filter also adopts the container's `routes`. It is stored empty because the container decided which pages the group appeared on, and an empty filter on a top-level row means every route — so copying the filter across is what stops a deleted container from publishing that child site-wide.

A child that carries a filter of its own keeps it. `findByRoute` applies the child's filter as well as the container's while the row is nested, so a child scoped `/markets/btc` inside a `/markets/**` container renders on one page only; overwriting it with the container's filter would widen the row rather than preserve it. Intersecting the two is not an option: patterns are exact, trailing `/*`, or trailing `/**`, and an empty intersection cannot be written down, because `routes: []` already means every route.

New rows can no longer reach that shape. `updatePlacement` throws `RouteFilterOnNestedPlacementError` (HTTP 400) when a patch supplies a non-empty `routes` and leaves the row nested once it applies, since the filter would be stored and then ignored. The test is where the patch leaves the row rather than which fields it names, so it catches all three shapes: `routes` sent on its own for an already-nested row, `routes` sent with the row's current `parentId` echoed back (what a client PATCHing a full representation does), and `routes` sent with a new `parentId` that attaches the row. The supported way to scope a nested row is to detach it in the same patch, sending `parentId: null` alongside the filter. The inheritance rule above still applies to rows written before the guard existed.

`createPlacement` still forces `routes: []` when a `parentId` is given, so a filter stated at create time is silently discarded rather than refused. That is the one remaining place where the two paths disagree.

A row can also leave a container one at a time, through `PATCH` with `parentId: null`. That path carries the same risk and gets the same treatment in `WidgetsService.updatePlacement`: the row adopts its former container's `routes` only when it has no filter of its own, and a filter stated in the same patch wins over both. A row that was already top-level is left alone, because an empty filter there genuinely does mean every route.

The container's `instanceConfig` *is* an `IZoneLayoutConfig`; its data fetcher echoes the normalized config as the widget `data`, and `WidgetZone` styles the nested flex container from it. At SSR, `PlacementResolver` fetches placements flat, then assembles a two-level tree: each child is nested under its container's `IWidgetData.children` (sorted by the child's `order`), only top-level items are returned, and a child whose container did not resolve (disabled / route-filtered / failed) is dropped as an orphan — the same silent-skip discipline as an unregistered type.

**Per-child relative width.** Each child carries an optional `layoutWeight` (a placement field, sibling of `order` — *not* `instanceConfig`). The renderer applies it as a `flex-grow` weight against a zero basis, so children with weights `2` and `1` split a row two-thirds / one-third regardless of content. Absent means auto width — unchanged from before the field existed. Operators set it from the per-row width dropdown under the group (and on top-level zone rows), since width is a property of how the container arranges its children, not of any one widget type.

**Responsive collapse.** A row layout (zone or group) can collapse to a stacked column below a chosen breakpoint via `IZoneLayoutConfig.collapseBelow`. The mechanism is a container query, not a viewport media query: a flex container cannot query its own width, so `WidgetZone` wraps each container in a layout-neutral element that establishes `container-type: inline-size`, and the inner flex container carries a `.collapse_*` class whose `@container` rule flips it to a column and resets weighted children to natural width once the wrapper is narrower than the breakpoint. Measuring the container's own width means a group nested in a narrow sidebar collapses independently of one spanning the page. `never` (the default) never collapses.

**Per-zone flexbox layout.** Every zone renders as a CSS flex container; placed widgets are flex items. The arrangement (direction, justify, align, wrap, gap) is an `IZoneLayoutConfig` an operator sets per zone from `/system/widgets` and the `WidgetZone` renderer applies via inline CSS custom properties (gap maps to `--gap-*` tokens). Overrides persist in `module_widgets_zone_layouts`; a zone with no row uses a default derived from its descriptor's coarse `layout` hint (`vertical` → stacked column, so untouched zones look unchanged). `WidgetsService.listZones()` merges the override (else the default) into each zone's `layoutConfig`, and `/api/widgets` returns a `zoneId → layoutConfig` map so SSR applies layout without a second call.

## SSR Resolution

`PlacementResolver.resolveForRoute(route, params)` (called via `widgets.fetchWidgetsForRoute(route, params)`) runs at every page render: queries enabled placements matching the route via `placementService.findByRoute`, looks up each type's `defaultDataFetcher` in the widget-type registry, invokes each fetcher with `(route, params, { id, instanceConfig })` where the third arg carries the placement's id and operator-editable instance config, runs them in parallel under a 5-second per-fetcher timeout, validates JSON-serialisability via round-trip, sorts by `(zoneId, order)`, and returns the `IWidgetData[]` bundle the frontend embeds. The resolver substitutes `{}` for `instanceConfig` when a placement carries no overrides, so fetchers can read keys without null-guarding every access.

Failures within a fetcher are logged and the widget is omitted — they never propagate out. Placements whose `typeId` is unregistered (e.g. plugin disabled) are silently skipped, leaving the rest of the route's widgets unaffected.

## Instance-Config Schema Validation

Widget types may declare `configSchema` (JSON Schema Draft 7) on registration. The placement admin API compiles each declared schema once via AJV and validates `instanceConfig` against it on every create and patch. Schema-invalid bodies return 400 with `{ error, errors: [{ path, message }] }`; widget types without a schema fall through to the existing shape-only "plain object" guard. The validator cache is keyed on the schema reference (WeakMap), so re-enabling a plugin mints a fresh descriptor and a fresh compiled validator without explicit invalidation.

Consumers retrieve the schema for an arbitrary `typeId` via `IWidgetsService.getTypeConfigSchema(typeId)` — the controller's single touchpoint into the type-side contract. Adminship still flows through `IWidgetsService`; the registry stays internal to the module.

## Admin Editor

`/system/widgets` is organised around a page. The operator picks a page from the site's navigation (the `main` menu namespace, fetched server-side), a route pattern a placement already uses, or a path they type; the board then shows every zone with the rows that resolve on that page, using a client-side mirror of `routeMatches`. "Every page" is the default and shows site-wide rows only. Rows placed in a zone that belong to other pages are never hidden: each zone lists them under a disclosure so an operator can always find a row they placed.

The left column holds the page picker and the widget library, which lists every registered type with its description and placement count. A library entry is dragged onto a zone, a gap between rows, or a layout group, or added with its button; either gesture opens the editor panel (a `SlideOver`) with the type and destination pre-filled, and the row is created only when the panel is saved, because types with required settings would fail a blind create. A new row lands where it was dropped: it is created with a provisional `order` just below its anchor, then the list is renumbered through the same move engine drag-drop uses.

Each zone card carries a layout strip: a miniature flex container driven by the zone's `layoutConfig` and each row's `layoutWeight`, drawing only the rows that would render on the selected page. It exists because arrangement, gap, and width were otherwise invisible until the live page was visited. Clicking a block opens that row in the panel.

The server entry (`app/(core)/system/widgets/page.tsx`) fetches zones, types, placements, the `main` menu, and the `widgets` submenu with the visitor's cookies forwarded, so the first paint carries real data. The client keeps the snapshot current by refetching on `widgets:placements-update`.

### How the Placement Form Renders a Schema

The editor panel builds its Settings section from the schema, so the schema is also the widget's admin form. `title` is the field label (a missing title is sentence-cased from the key) and `description` is the help text under the control. The control is chosen from the property:

| Property shape | Control |
|---|---|
| `boolean` | Switch with the description beside it |
| `enum` of 2–4 short members that is required or has a `default` | Segmented control showing every choice |
| any other `enum` | Dropdown; an optional enum with no default gets a blank "Default" option |
| `integer` / `number` | Numeric input honouring `minimum`, `maximum`, and integer step |
| `string` with `contentMediaType`, or `maxLength` over 200 | Multiline textarea |
| any other `string` | Single-line input |
| `array` of scalars or of flat objects | Repeatable rows with add and remove; object items lay their fields side by side |
| nested `object`, arrays of arrays | Not rendered; editable only through the raw JSON view |

Enum members that are CSS keywords or token names (`flex-start`, `space-between`, `heading-md`, `sm`) are shown with plain-English labels; the persisted value is unchanged. `core:layout-group` is special-cased: its settings render through the same preset-driven layout editor the zone panel uses. The schema helpers live in `src/frontend/modules/widgets/lib/configSchema.ts`.
