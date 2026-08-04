# Address Tags Module

Central CRUD authority for free-text tags on TRON wallet addresses. Every surface — REST, the `/system/address-tags` admin UI, future AI tools and sinks — is a thin wrapper around one singleton service, so tagging semantics (validation, idempotent batches, rename collapse) exist in exactly one place.

## Fast Facts

| Surface | Value |
|---|---|
| Module id | `address-tags` |
| Service registry name | `'address-tags'` (`IAddressTagService`) |
| Types | `@delphian/tronrelic-types` ≥ 6.15.0 (`IAddressTag`, `IAddressTagPair`, `IAddressTagGroup`, `IAddressTagRename`, `IAddressTagService`) |
| Collection | `module_address-tags_tags` (MongoDB) |
| User API | `/api/address-tags/*` — `requireLogin` |
| Admin API | `/api/admin/system/address-tags/*` — `requireAdmin` |
| Admin UI | `/system/address-tags` — one row per address, listing every tag on it (server-grouped by `searchAddresses`, so a page never splits an address) |
| Frontend client | `src/frontend/modules/address-tags/api/client.ts` (both surfaces) |
| Frontend read cache | `useAddressTags(address)` — batches every chip's lookup into one `by-address` call, invalidate with `invalidateAddressTags(address)` |
| Frontend editor | `AddressTagsEditor` — freeform comma-separated field, opened from the `TronAddress` chip's wrench menu ("Edit tags", admin only) |
| Frontend selector | `AddressSelector` (`components/ui/AddressSelector`, also `context.ui.AddressSelector`) — the canonical control for *choosing* an address; typeahead over `/suggest`, emits checksum-verified base58 only (`lib/tronAddress.isValidTronAddress`) |

## Why MongoDB

Tags are a mutable CRUD entity set — renamed, deleted, re-created — not an append-only analytics stream. Mongo with a unique `{address, tag}` index and a `{tag, address}` reverse index scales to hundreds of millions of assignments; ClickHouse's asynchronous mutations are wrong for this shape. Analytical projections can be layered downstream later without moving the source of truth.

## Service Contract (`IAddressTagService`)

All methods take and return arrays; single-item calls are one-element arrays. The service validates shape (base58 TRON address, 1–64 char trimmed tag, no commas, ≤1000 items per batch) and trusts caller authorization — gating lives in the HTTP layer.

**Tags may not contain a comma.** The comma is the array delimiter in `?tags=x,y`, so a stored comma-bearing tag would be write-only — `/by-tag` could never return it. `requireTag` rejects it at the one chokepoint every write crosses (create, both sides of rename, delete), so no downstream encoding change is needed.

| Method | Semantics |
|---|---|
| `createTags(pairs)` | Idempotent batch upsert; existing pairs skipped, stored records returned |
| `getTagsByAddresses(addresses)` | All assignments on the given addresses |
| `getAddressesByTags(tags)` | Reverse lookup by tag values |
| `listTags({prefix?, limit?})` | Distinct tag vocabulary (pickers/autocomplete) |
| `searchTags({search?, limit?, skip?})` | Paged assignment search (one row per `(address, tag)` pair) |
| `searchAddresses({search?, limit?, skip?})` | Paged **address** search: one entry per address with its full tag list; `limit`/`skip` count addresses |
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
| `GET /api/address-tags/suggest?search=&limit=` | Typeahead for `AddressSelector`: whole addresses (with full tag lists) matching address *or* tag text |

Admin surface (`createAdminRateLimiter` + `requireAdmin`; admin-group session or `ADMIN_API_TOKEN`):

| Route | Body | Purpose |
|---|---|---|
| `GET /tags?search=&limit=&skip=` | — | Paged assignment search |
| `GET /addresses?search=&limit=&skip=` | — | Paged address search; response is `{ addresses: IAddressTagGroup[] }` |
| `POST /tags` | `{ tags: IAddressTagPair[] }` | Create |
| `PATCH /tags` | `{ renames: IAddressTagRename[] }` | Rename |
| `POST /tags/delete` | `{ tags: IAddressTagPair[] }` | Delete (POST because the operation carries a body) |

Validation failures return 400 with the service's message; other failures 500.

## Where Tags Surface

Every address on the site renders through the canonical `TronAddress` chip
(`src/frontend/components/ui/TronAddress/`), so that chip is the module's primary
consumer: it appends an address's tags to its hover tooltip — `T…abcd (exchange,
hot-wallet)` — and offers "Edit tags" in its wrench menu, which opens
`AddressTagsEditor` in the core modal. Reads go through `useAddressTags`, one
process-wide cache that coalesces a page's chips into a single request; tags are
treated as an absent enhancement when the visitor is anonymous (reads are
`requireLogin`) or the lookup fails. The edit item is gated on `admin` group
membership because every mutation route is `requireAdmin` — widening it would
only surface a 403 after the operator typed.

Where `TronAddress` renders an address, `AddressSelector` *chooses* one. It is
the module's second frontend consumer and the reason `/suggest` exists: typed
text matches address text and tag text alike, and each suggestion shows its
tags so an operator can pick "the exchange hot wallet" without recognising
base58. It emits only checksum-verified addresses, so consumers never
re-validate — note that bar is stricter than this service's own
`requireAddress`, which is shape-only, so the API still accepts a
checksum-invalid address from a non-selector caller.
Because the lookup is `requireLogin`, an anonymous visitor simply gets no
suggestions and the control degrades to a plain input that still accepts a
pasted address — the same "tags are an absent enhancement" rule the chip
follows.

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
