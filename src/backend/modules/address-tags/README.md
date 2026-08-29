# Address Tags Module

Central CRUD authority for free-text tags on TRON wallet addresses. Every surface — REST, the `/system/address-tags` admin UI, future AI tools and sinks — is a thin wrapper around one singleton service, so tagging semantics (validation, idempotent batches, rename collapse) exist in exactly one place.

## Fast Facts

| Surface | Value |
|---|---|
| Module id | `address-tags` |
| Service registry name | `'address-tags'` (`IAddressTagService`) |
| Types | `@delphian/tronrelic-types` ≥ 6.15.0 (`IAddressTag`, `IAddressTagPair`, `IAddressTagGroup`, `IAddressTagRename`, `IAddressTagSource`, `IAddressTagAssertion`, `IAddressTagSyncResult`, `IAddressTagCount`, `IAddressTagSummary`, `IAddressTagService`) |
| Collection | `module_address-tags_tags` (MongoDB) |
| User API | `/api/address-tags/*` — `requireLogin` |
| Admin API | `/api/admin/system/address-tags/*` — `requireAdmin` |
| Admin UI | `/system/address-tags` — Submenu Pattern tab row (namespace `address-tags`), in this order: **Tags** (vocabulary summary panel over one row per address, server-grouped by `searchAddresses` so a page never splits an address), **Sources** (per-source ingestion status, run-now, screen-one-address), **Schedules** (core `SchedulerMonitor` filtered to `address-tags:`), **Database** (core `CollectionBrowser` scoped to `module_address-tags_`), **Settings** (source switches, write-only Chainalysis key). Settings sits last because the four before it report state and Settings changes it |
| Scheduler jobs | `address-tags:sync-ofac` (daily), `address-tags:sync-usdt-blacklist` (5 min), `address-tags:verify-frozen` (weekly) — all off when `ENABLE_SCHEDULER=false` |
| Frontend client | `src/frontend/modules/address-tags/api/client.ts` (both surfaces) |
| Frontend read cache | `useAddressTags(address)` — batches every chip's lookup into one `by-address` call, invalidate with `invalidateAddressTags(address)` |
| Frontend editor | `AddressTagsEditor` — freeform comma-separated field, opened from the `TronAddress` chip's wrench menu ("Edit tags", admin only) |
| Frontend severity | `lib/tagSeverity.ts` — the list deciding which tags render as a warning on the chip; kept in step with the sources by `__tests__/tag-severity-coverage.test.ts` |
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
| `getTagSummary({limit?})` | Counted vocabulary for management surfaces: `tags[]` of `{tag, addresses}` ordered by count then tag text, plus `totalTags`/`totalAddresses`/`totalAssignments`. The totals are not derivable from the rows — an address carrying three tags is counted under all three, and `limit` truncates the rows but never the totals. Two groupings over the live collection, so it is a management read rather than a request-path one |
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
| `GET /summary?limit=` | — | Counted vocabulary and collection totals; response is `{ summary: IAddressTagSummary }`. Admin rather than user-facing on purpose: a count per tag describes the whole collection, and would tell any logged-in visitor how many addresses the deployment holds under `ofac:sdn` without their having to find one |
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

**Configuration is module key-value config, not `.env`** — stored via `IDatabaseService` `get()`/`set()` under an `address-tags.` key prefix (the KV analog of the `module_{id}_*` collection convention), so an operator can paste a key or flip a switch and the next run picks it up without a redeploy. Keys: `address-tags.chainalysis.apiKey` (write-only over HTTP; readable to an admin through the `/system/database` collection browser, an accepted consequence of storing it in MongoDB — note that the module's own Database tab is scoped to `module_address-tags_` and so does not show the shared `_kv` collection these keys live in), `address-tags.chainalysis.enabled`, `address-tags.sources.<id>.enabled`, `address-tags.sources.<id>.cursor`, `address-tags.sources.<id>.state`, `address-tags.sources.<id>.verify`.

## Tag Summary Panel

The Tags tab leads with a summary of the vocabulary: distinct tags, tagged addresses, and total assignments, then every tag with the number of addresses carrying it as a sorted bar list. The table underneath answers "what is this address labelled as"; nothing answered the reverse — which labels the deployment actually uses and how heavily — so a tag that was a misspelling of an existing one, or a category nobody had used since it was created, stayed invisible until someone scrolled past it.

The form is a sorted bar list rather than a tag cloud because a cloud encodes the count as type size, which reads as emphasis and cannot be compared across two tags that are not adjacent. The bars share one hue: there is a single measure here, and a colour per tag would imply an identity the data does not carry.

Every row is also a filter. Clicking one commits its tag as the table's search term, and clicking the selected row clears it. That is why the panel sits above the table rather than on a tab of its own — the counts are how an operator picks what to look at next, and a count is only useful if the rows behind it are one click away. `AddressTagsManager` owns the search term for both, so the highlighted row and the visible rows cannot disagree, and it bumps a token after every mutation so the counts refetch rather than describing the collection as it was before the edit.

What a click hands over is a search term, not an exact-tag query, because the substring search is the table's only filter. Clicking `whale` can therefore also list an address tagged `whale-watch`, and the table can show more rows than the count on the row that was clicked. A row's number is the addresses carrying that exact tag, which is what `getTagSummary` returns; it is not a prediction of how many rows the table will render.

## Schedules and Database Tabs

Any component owning a scheduler job or a collection surfaces both on its own admin page, and this module owns three jobs and one collection. Without those tabs an operator looking into stale sanctions data leaves for `/system/scheduler` or `/system/database`, loses the page they were on, and then picks this module's rows back out of the whole deployment's inventory.

Neither tab is furniture this module wrote. **Schedules** is core's `SchedulerMonitor` with a `jobFilter` predicate testing the `address-tags:` name prefix, so an ingestion job added later appears without a UI change; a fixed list of names would quietly show fewer jobs than the tab promises. **Database** is core's `CollectionBrowser` with `prefix="module_address-tags_"`, which the API filters server-side, so the panel never receives another component's inventory. Reusing the core components means the authority behind each tab is the one `/system` uses, and an edit made in either place cannot drift from the other.

Both browsers allow edits and deletes. That is safe here because a tag document is a standalone `(address, tag)` row nothing else derives from. Prefer the Tags tab for ordinary work, since it goes through `AddressTagService` and keeps `active` consistent with `manual` and `sources[]`; treat the browser as the escape hatch for a document that surface cannot reach, such as one still missing its provenance fields before the `001_add_provenance_fields` migration runs.

The frontend repeats the job prefix and the collection prefix as literals, because frontend code cannot import backend code. The module lifecycle test asserts every registered job name starts with `address-tags:`, which is what keeps the two copies of that literal honest.

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

### Warning Tags

A tag that means "do not transact" gets a stronger treatment than the underline.
When an address carries `ofac:sdn`, `chainalysis:sanctioned`, or `usdt:frozen`,
the chip renders a danger-coloured triangle ahead of the address, with the
reason in its tooltip and in its screen-reader label. The underline says only
that an address is annotated; it cannot distinguish a sanctions listing from
`exchange`, and that distinction has to be readable before the operator acts.

That marker is the one signal on the chip that occupies layout, so a flagged row
does shift slightly when its tags resolve. The alternative, reserving the icon's
width on every chip, taxes every address on the site to spare the rare one, and
only three tags classify.

Which tags earn the marker is decided in
`src/frontend/modules/address-tags/lib/tagSeverity.ts`. It is an explicit list,
not a rule over the reserved `ofac:` / `usdt:` / `chainalysis:` prefixes: those
prefixes mean "written by a machine source", which coincides with "dangerous"
only because every source here today is a risk feed, and a benign source added
later would inherit a warning it never earned. The cost of listing them is the
opposite failure — a new source tag nobody classifies renders with no warning at
all — so `__tests__/tag-severity-coverage.test.ts` imports the sources' own
`OFAC_TAG`, `USDT_TAG`, and `CHAINALYSIS_TAG` constants and fails when the two
sets disagree in either direction. It also cross-checks that list against
`RESERVED_TAG_PREFIXES`, which is the closest thing production has to an
inventory of ingestion sources: a source has to extend that constant or an
operator could forge its assertions, so a source added under a new prefix fails
this test even if nobody remembers it exists. **Adding an ingestion source means
adding its tag constant to that test and an entry to that list.**

The cross-check narrows the gap without closing it. A future source reusing an
already-reserved prefix — `ofac:blocked`, say — still passes unnoticed. Closing
that means giving `ITagSource` an asserted-tags field and registering sources
from a descriptor the test can import without constructing them, which is a
production change rather than a test one.

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
| `api/address-tags-admin.controller.ts` | Mutation/search/summary handlers + envelope validation |
| `api/address-tags-sources.controller.ts` | Source status/run/screen/settings handlers |
| `api/address-tags.routes.ts` | Router factories (guards applied at mount) |
| `__tests__/` | Module lifecycle, CRUD semantics, provenance/reconcile semantics, source fixtures, frontend severity coverage |

Consumers resolve the service via `context.services.get<IAddressTagService>('address-tags')` (or `watch()` for lifetime-sensitive callers) — never by importing this module.

## Further Reading

- [modules.md](../../../../docs/system/modules/modules.md) — module lifecycle and DI rules
- [system-database.md](../../../../docs/system/system-database.md) — `IDatabaseService` tiers and the `module_{id}_*` naming convention
- [system-auth.md](../../../../docs/system/system-auth.md) — `requireLogin` / `requireAdmin` semantics
