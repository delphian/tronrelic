# Widget Admin API

Endpoints powering the `/system/widgets` operator UI. Three parallel namespaces under `/api/admin/system/` cover zone introspection plus per-zone flexbox layout, read-only widget-type introspection, and full placement CRUD.

## Why This Matters

The type/placement split landed in PR 2 of the widget rewrite gave operators a data model they could edit; the endpoints documented here surface that model. Without them, placements can only change via plugin re-registration. With them, an operator can pin a widget to a route subtree, reorder zones, soft-disable a noisy plugin row, or revert customisations — all without redeploying.

## How It Works

All three routers chain `createAdminRateLimiter` before `requireAdmin` at mount time, so every endpoint is bounded per-IP and gated to the cookie or service-token auth path. Mutations on `/placements` broadcast `widgets:placements-update` over WebSocket to every connected socket; admin UIs refetch, public pages refetch widget data.

The placements controller validates inputs against the live `IZoneRegistry` and `IWidgetTypeRegistry`. A request naming an unknown zone or type fails 400 before the placement service is touched. Route patterns flow through `normaliseRoutePattern` so the matcher's grammar (exact, `/u/*`, `/u/**`) is the single source of truth — see [Route Pattern Grammar](#route-pattern-grammar) below.

## Endpoints

### Zones — introspection + layout

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/admin/system/zones` | — | `IZoneSnapshot` |
| PATCH | `/api/admin/system/zones/:zoneId/layout` | `IZoneLayoutConfig` | `{ success, layoutConfig }` |

GET is the tracks-grouped catalogue of every registered zone with host (`site` / `core` / `plugin` / `admin`), registration metadata, and each zone's effective `layoutConfig` (the operator override, else a default derived from the descriptor's coarse `layout` hint). PATCH persists an operator's flexbox layout for a zone — `404` on an unknown zone, `400` on an off-enum flex value — and fires `widgets:placements-update` so admin UIs refetch. `IZoneLayoutConfig` also carries an optional `collapseBelow` breakpoint (`never` / `mobile-sm` / `mobile-md` / `mobile-lg` / `tablet` / `desktop`); off-enum values are dropped, an absent value means the row never collapses.

### Widget Types — read-only introspection

| Method | Path | Returns |
|---|---|---|
| GET | `/api/admin/system/widget-types` | `IWidgetTypeSnapshot` |

Plugin-grouped catalogue of every declared widget type.

### Placements — full CRUD

| Method | Path | Body | Returns | Status codes |
|---|---|---|---|---|
| GET | `/placements` | — | `{ success, placements: IWidgetPlacement[] }` | 200 |
| GET | `/placements/:id` | — | `{ success, placement }` | 200 / 404 |
| POST | `/placements` | `IPlacementInput` | `{ success, placement }` | 201 / 400 |
| PATCH | `/placements/:id` | `IPlacementPatch` | `{ success, placement }` | 200 / 400 / 404 |
| DELETE | `/placements/:id` | — | empty | 204 / 400 / 404 |
| POST | `/placements/:id/restore-defaults` | — | `{ success, placement }` | 200 / 400 / 404 / 409 |

Base path: `/api/admin/system/widgets`.

`GET /placements` accepts query params `zoneId`, `pluginId`, `source` (`plugin`\|`operator`), and `enabledOnly` (`true`\|`1`).

`POST /placements` always creates an operator-source row. Plugin-source rows are created exclusively by plugins calling `IWidgetsService.registerWidget(input, pluginId)` on the `'widgets'` service during plugin enable.

`DELETE /placements/:id` refuses plugin-source rows with 400 — the supported reversals are disable (`PATCH { enabled: false }`) and restore-defaults. Operator rows delete cleanly.

`POST /placements/:id/restore-defaults` is only valid on plugin-source rows. It looks up the plugin's cached registration args (captured the first time the plugin called `IWidgetsService.registerWidget(...)` in this process) and applies them as a single update, re-enabling the row. Returns 409 when the cache lookup misses — re-enable the plugin to repopulate.

## Validation Rules

The placements controller refuses input on any of:

- `typeId` not registered in `IWidgetTypeRegistry`.
- `zoneId` not registered in `IZoneRegistry`.
- `routes` entry that doesn't start with `/`, contains whitespace, or carries a glob marker outside the trailing segment.
- `order` outside `[0, 10000]`, non-integer, or non-finite.
- `layoutWeight` outside `[1, 12]`, non-integer, or non-finite. Sets the row's relative width (a `flex-grow` weight) when its container lays out in a row; pass `layoutWeight: null` on PATCH to clear it back to auto width (`$unset`).
- `title` empty after trim, or longer than 80 characters. Pass `title: null` on PATCH to clear an existing override (`$unset`).
- `titleUrl` not a root-relative internal path (must start with a single `/`; protocol-relative, absolute, or scheme URLs are rejected), or longer than 512 characters. Pass `titleUrl: null` on PATCH to clear the heading link (`$unset`).
- `instanceConfig` not a plain object.

## Route Pattern Grammar

Placement `routes` arrays accept three forms:

| Form | Matches | Example |
|---|---|---|
| Exact | The literal path, nothing else | `/markets` |
| Single-segment glob | One trailing segment, no deeper | `/u/*` matches `/u/TXyz`, not `/u/TXyz/holdings` |
| Deep glob | Any depth below the prefix | `/admin/**` matches `/admin/users/edit` |

Empty `routes: []` matches every route. The matcher is `routeMatches` in `src/backend/modules/widgets/placements/route-matcher.ts`.

## WebSocket Event

`widgets:placements-update` fires after every successful create / update / delete / restore. Payload:

```typescript
{
    event: 'placement:created' | 'placement:updated' | 'placement:deleted' | 'placement:restored',
    placementId: string,
    zoneId?: string,
    timestamp: string  // ISO-8601
}
```

Audience: all connected sockets. Receivers refetch — admins re-pull the placement list, public pages re-pull their SSR widget data.

## Further Reading

- [Widgets Module README](../../src/backend/modules/widgets/README.md) — Complete contract and storage schema for the placement subsystem
- [system-api.md](./system-api.md) — Admin auth conventions and response envelope
- [plugins-widget-zones.md](../plugins/plugins-widget-zones.md) — Plugin-side widget registration patterns
