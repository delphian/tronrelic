# Address Tags Module

Central CRUD authority for free-text tags on TRON wallet addresses. Every surface — REST, the `/system/address-tags` admin UI, future AI tools and sinks — is a thin wrapper around one singleton service, so tagging semantics (validation, idempotent batches, rename collapse) exist in exactly one place.

## Fast Facts

| Surface | Value |
|---|---|
| Module id | `address-tags` |
| Service registry name | `'address-tags'` (`IAddressTagService`) |
| Types | `@delphian/tronrelic-types` ≥ 6.15.0 (`IAddressTag`, `IAddressTagPair`, `IAddressTagGroup`, `IAddressTagRename`, `IAddressTagSource`, `IAddressTagAssertion`, `IAddressTagSyncResult`, `IAddressTagService`) |
| Collection | `module_address-tags_tags` (MongoDB) |
| User API | `/api/address-tags/*` — `requireLogin` |
| Admin API | `/api/admin/system/address-tags/*` — `requireAdmin` |
| Admin UI | `/system/address-tags` — Submenu Pattern tab row (namespace `address-tags`): **Tags** (one row per address, server-grouped by `searchAddresses` so a page never splits an address), **Sources** (per-source ingestion status, run-now, screen-one-address), **Settings** (source switches, write-only Chainalysis key) |
| Scheduler jobs | `address-tags:sync-ofac` (daily), `address-tags:sync-usdt-blacklist` (5 min), `address-tags:verify-frozen` (weekly) — all off when `ENABLE_SCHEDULER=false` |
| Frontend client | `src/frontend/modules/address-tags/api/client.ts` (both surfaces) |
| Frontend read cache | `useAddressTags(address)` — batches every chip's lookup into one `by-address` call, invalidate with `invalidateAddressTags(address)` |
| Frontend editor | `AddressTagsEditor` — freeform comma-separated field, opened from the `TronAddress` chip's wrench menu ("Edit tags", admin only) |
| Frontend selector | `AddressSelector` (`components/ui/AddressSelector`, also `context.ui.AddressSelector`) — the canonical control for *choosing* an address; typeahead over `/suggest`, emits checksum-verified base58 only (`lib/tronAddress.isValidTronAddress`) |

## Why MongoDB

Tags are a mutable CRUD entity set — renamed, deleted, re-created — not an append-only analytics stream. Mongo with a unique `{address, tag}` index and a `{tag, address}` reverse index scales to hundreds of millions of assignments; ClickHouse's asynchronous mutations are wrong for this shape. Analytical projections can be layered downstream later without moving the source of truth.

## Service Contract (`IAddressTagService`)

All methods take and return arrays; single-item calls are one-element arrays. The service validates shape (base58 TRON address, 1–64 char trimmed tag, no commas, ≤1000 items per batch) and trusts caller authorization — gating lives in the HTTP layer.

**Tags may not contain a comma.** The comma is the array delimiter in `?tags=x,y`, so a stored comma-bearing tag would be write-only — `/by-tag` could never return it. `requireTag` rejects it at the one chokepoint every write crosses (create, both sides of rename, delete), so no downstream encoding change is needed.

**Reserved machine-source prefixes.** Tag text starting with `ofac:`, `usdt:`, or `chainalysis:` (case-insensitive) is rejected on every human write path via the same `requireTag` chokepoint, so an operator cannot forge a source's assertion. Only `syncSource` writes those prefixes; reads still accept them as lookup values.

| Method | Semantics |
|---|---|
| `createTags(pairs)` | Idempotent batch upsert; existing pairs skipped (though a machine-only document gains the `manual` claim), stored records returned |
| `getTagsByAddresses(addresses)` | All assignments on the given addresses |
| `getAddressesByTags(tags)` | Reverse lookup by tag values |
| `listTags({prefix?, limit?})` | Distinct tag vocabulary (pickers/autocomplete) |
| `searchTags({search?, limit?, skip?})` | Paged assignment search (one row per `(address, tag)` pair) |
| `searchAddresses({search?, limit?, skip?})` | Paged **address** search: one entry per address with its full tag list; `limit`/`skip` count addresses |
| `updateTags(renames)` | Per-pair `oldTag → newTag`; missing pair skipped; collision with existing `(address, newTag)` collapses the human claim into it. A document carrying source elements is never renamed or deleted — the `manual` claim moves to the destination and the old document keeps its provenance with `manual` cleared |
| `deleteTags(pairs)` | Exact-pair delete; a document carrying source elements keeps them and only loses its `manual` claim. Returns the count of documents deleted plus human claims cleared |
| `syncSource(source, assertions, mode, withdrawn?)` | Machine-source reconcile — the only writer of `sources` elements, and it only touches elements matching its own source id. `snapshot` diffs against held state and soft-withdraws the missing (refusing a fetch smaller than half the current holdings); `delta` applies only the given additions and revocations. Invalid assertions are counted `rejected` and skipped |

Storage document: `{ address, tag, createdAt, updatedAt, manual, active, sources[] }`, where `manual` records a human claim, `sources[]` holds per-source `{ id, ref?, url?, observedAt, withdrawnAt? }` elements (withdrawal is soft — elements stay for audit), and `active` is denormalized liveness recomputed on every write (`manual`, or any source element not withdrawn). Indexes: `{address:1, tag:1}` unique, `{tag:1, active:1, address:1}`, `{'sources.id':1, address:1}` (multikey).

**Liveness filter.** Every read path (`getTagsByAddresses`, `getAddressesByTags`, `listTags`, `searchTags`, `searchAddresses`, and `/suggest` through the last of those) filters on `active: true`, so a withdrawn machine tag stays stored for audit but never surfaces. Documents written before the provenance fields existed fail that equality, which is why the `module:address-tags:001_add_provenance_fields` migration (run from `/system/database`) must be executed **immediately after deploying this code** — until it runs, pre-existing tags are invisible on every surface, and module `init()` logs an error naming the migration so that state is diagnosable rather than looking like an empty collection.

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
| `GET /sources` | — | Per-source ingestion status: last run, last error, cursor, last reconcile counts |
| `POST /sources/:id/run` | — | Run one scheduled source now (testing/recovery; ignores the enable switch; awaits the run) |
| `POST /screen` | `{ address }` | Screen one address through Chainalysis on demand |
| `GET /settings` | — | Ingestion settings; reports whether a Chainalysis key is configured and its last four characters — never the key |
| `PUT /settings` | `{ chainalysis?, sources? }` | Write ingestion settings, including the write-only key |

Validation failures return 400 with the service's message; a run already in flight returns 409; other failures 500.

## Machine Sources

Three ingestion sources assert reserved-prefix tags with a citation (`ref`/`url`) behind every claim. They are run by `TagIngestionService` (`services/tag-ingestion.service.ts`), which loads the stored cursor, hands the source's output to `syncSource`, and persists the outcome — advancing the cursor only after a successful reconcile so a failed run retries the same window.

| Source | Mode | Tag | Job | Cadence |
|---|---|---|---|---|
| `ofac-sdn` | snapshot | `ofac:sdn` | `address-tags:sync-ofac` | Daily 06:00 UTC |
| `usdt-blacklist` | delta | `usdt:frozen` | `address-tags:sync-usdt-blacklist` | Every 5 min |
| `usdt-blacklist` (verify) | — | `usdt:frozen` | `address-tags:verify-frozen` | Weekly Mon 04:00 UTC — re-checks every held freeze against `isBlackListed` contract state |
| `chainalysis` | lookup | `chainalysis:sanctioned` | none | Admin-requested only (`POST /screen`) |

**Kill switches.** `ENABLE_SCHEDULER=false` (or a null scheduler dependency) disables all scheduled ingestion. Each source also has a runtime switch, edited from the Settings tab and consulted per tick, so flipping one needs no restart. Chainalysis defaults off and additionally requires an API key; because a lookup source has no scheduled runs, its switch gates the screening capability itself — `POST /screen` refuses with 400 while the switch is off.

**Configuration is module key-value config, not `.env`** — stored via `IDatabaseService` `get()`/`set()` under an `address-tags.` key prefix (the KV analog of the `module_{id}_*` collection convention), so an operator can paste a key or flip a switch and the next run picks it up without a redeploy. Keys: `address-tags.chainalysis.apiKey` (write-only over HTTP; readable to an admin through the `/system/database` collection browser, an accepted consequence of storing it in MongoDB), `address-tags.chainalysis.enabled`, `address-tags.sources.<id>.enabled`, `address-tags.sources.<id>.cursor`, `address-tags.sources.<id>.state`, `address-tags.sources.<id>.verify`.

**Safety properties.** `syncSource` is the only writer of `sources[]` elements and touches only its own source's; the snapshot floor refuses a fetch smaller than half the current holdings so a truncated download can never mass-withdraw; withdrawal is soft (`withdrawnAt` stamped, document kept for audit); invalid feed rows are counted `rejected` and skipped rather than failing the batch; a failed verify call draws no conclusion.

## Where Tags Surface

Every address on the site renders through the canonical `TronAddress` chip
(`src/frontend/components/ui/TronAddress/`), so that chip is the module's primary
consumer: it appends an address's tags to its hover tooltip — `T…abcd (exchange,
hot-wallet)` — marks a tagged address with a dotted underline so it is
distinguishable before hover, and offers "Edit tags" in its wrench menu, which
opens `AddressTagsEditor` in the core modal. The underline is a text decoration
rather than a badge or chip because tags resolve client-side after hydration,
and any signal that changed the chip's box would reflow every dense table on the
page a beat after it painted. Reads go through `useAddressTags`, one
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
| `AddressTagsModule.ts` | `IModule` implementation; publishes service, mounts routers, registers menu item + submenu tabs, registers ingestion jobs |
| `services/address-tag.service.ts` | Singleton service — all business logic including `syncSource` and the liveness derivation |
| `services/tag-ingestion.service.ts` | Runs sources, owns cursors/run-state/settings in module KV |
| `sources/ITagSource.ts` | Source contract (`snapshot`/`delta`/`lookup`, verify capability) |
| `sources/ofac-sdn.source.ts` | OFAC SDN streaming XML scanner (both export shapes) |
| `sources/usdt-blacklist.source.ts` | Tether event poll + `isBlackListed` verify pass |
| `sources/chainalysis.source.ts` | Per-address sanctions screen |
| `migrations/001_add_provenance_fields.ts` | Backfills `manual`/`active`/`sources` onto pre-provenance documents |
| `api/address-tags-user.controller.ts` | Read handlers + `parseList` (comma-separated query arrays) |
| `api/address-tags-admin.controller.ts` | Mutation/search handlers + envelope validation |
| `api/address-tags-sources.controller.ts` | Source status/run/screen/settings handlers |
| `api/address-tags.routes.ts` | Router factories (guards applied at mount) |
| `__tests__/` | Module lifecycle, CRUD semantics, provenance/reconcile semantics, source fixtures |

Consumers resolve the service via `context.services.get<IAddressTagService>('address-tags')` (or `watch()` for lifetime-sensitive callers) — never by importing this module.

## Further Reading

- [modules.md](../../../../docs/system/modules/modules.md) — module lifecycle and DI rules
- [system-database.md](../../../../docs/system/system-database.md) — `IDatabaseService` tiers and the `module_{id}_*` naming convention
- [system-auth.md](../../../../docs/system/system-auth.md) — `requireLogin` / `requireAdmin` semantics
