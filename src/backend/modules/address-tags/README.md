# Address Tags Module

Central CRUD authority for free-text tags on TRON wallet addresses. Every surface — REST, the `/system/address-tags` admin UI, future AI tools and sinks — is a thin wrapper around one singleton service, so tagging semantics (validation, idempotent batches, rename collapse) exist in exactly one place.

## Fast Facts

| Surface | Value |
|---|---|
| Module id | `address-tags` |
| Service registry name | `'address-tags'` (`IAddressTagService`) |
| Types | `@delphian/tronrelic-types` ≥ 6.15.0 (`IAddressTag`, `IAddressTagPair`, `IAddressTagRename`, `IAddressTagService`) |
| Collection | `module_address-tags_tags` (MongoDB) |
| User API | `/api/address-tags/*` — `requireLogin` |
| Admin API | `/api/admin/system/address-tags/*` — `requireAdmin` |
| Admin UI | `/system/address-tags` |
| Frontend client | `src/frontend/modules/address-tags/api/client.ts` |

## Why MongoDB

Tags are a mutable CRUD entity set — renamed, deleted, re-created — not an append-only analytics stream. Mongo with a unique `{address, tag}` index and a `{tag, address}` reverse index scales to hundreds of millions of assignments; ClickHouse's asynchronous mutations are wrong for this shape. Analytical projections can be layered downstream later without moving the source of truth.

## Service Contract (`IAddressTagService`)

All methods take and return arrays; single-item calls are one-element arrays. The service validates shape (base58 TRON address, 1–64 char trimmed tag, ≤1000 items per batch) and trusts caller authorization — gating lives in the HTTP layer.

| Method | Semantics |
|---|---|
| `createTags(pairs)` | Idempotent batch upsert; existing pairs skipped, stored records returned |
| `getTagsByAddresses(addresses)` | All assignments on the given addresses |
| `getAddressesByTags(tags)` | Reverse lookup by tag values |
| `listTags({prefix?, limit?})` | Distinct tag vocabulary (pickers/autocomplete) |
| `searchTags({search?, limit?, skip?})` | Paged assignment search for management tables |
| `updateTags(renames)` | Per-pair `oldTag → newTag`; missing pair skipped; collision with existing `(address, newTag)` collapses (old record removed) |
| `deleteTags(pairs)` | Exact-pair delete; returns removed count |

Storage document: `{ address, tag, createdAt, updatedAt }`. Indexes: `{address:1, tag:1}` unique, `{tag:1, address:1}`.

## REST Endpoints

User surface (rate limit + `requireLogin`; registered users only):

| Route | Purpose |
|---|---|
| `GET /api/address-tags/by-address?addresses=a,b` | Tags for addresses |
| `GET /api/address-tags/by-tag?tags=x,y` | Addresses for tags |
| `GET /api/address-tags/tags?prefix=&limit=` | Distinct vocabulary |

Admin surface (`createAdminRateLimiter` + `requireAdmin`; admin-group session or `ADMIN_API_TOKEN`):

| Route | Body | Purpose |
|---|---|---|
| `GET /tags?search=&limit=&skip=` | — | Paged assignment search |
| `POST /tags` | `{ tags: IAddressTagPair[] }` | Create |
| `PATCH /tags` | `{ renames: IAddressTagRename[] }` | Rename |
| `POST /tags/delete` | `{ tags: IAddressTagPair[] }` | Delete (POST because the operation carries a body) |

Validation failures return 400 with the service's message; other failures 500.

## Source Map

| Path | Contents |
|---|---|
| `AddressTagsModule.ts` | `IModule` implementation; publishes service, mounts routers, registers menu item |
| `services/address-tag.service.ts` | Singleton service — all business logic |
| `api/address-tags-user.controller.ts` | Read handlers + `parseList` (comma-separated query arrays) |
| `api/address-tags-admin.controller.ts` | Mutation/search handlers + envelope validation |
| `api/address-tags.routes.ts` | Router factories (guards applied at mount) |
| `__tests__/` | Module lifecycle + service CRUD semantics |

Consumers resolve the service via `context.services.get<IAddressTagService>('address-tags')` (or `watch()` for lifetime-sensitive callers) — never by importing this module.

## Further Reading

- [modules.md](../../../../docs/system/modules/modules.md) — module lifecycle and DI rules
- [system-database.md](../../../../docs/system/system-database.md) — `IDatabaseService` tiers and the `module_{id}_*` naming convention
- [system-auth.md](../../../../docs/system/system-auth.md) — `requireLogin` / `requireAdmin` semantics
