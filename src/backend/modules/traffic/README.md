# Traffic Module

Owns cookieless behavioral analytics: the ClickHouse `traffic_events` pipeline, Google Search Console keyword integration, the User-Agent bot classifier, and geo/IP derivation. Carved out of the former omnibus user module so analytics has a single owner independent of identity.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `traffic` |
| Module class | `src/backend/modules/traffic/TrafficModule.ts` |
| Admin page | `/system/traffic` (menu item `Traffic`, order 26, registered in `run()`) |
| Mounted routes | `/api/admin/users/traffic/*`, `/api/admin/users/analytics/*`, `/api/user/bootstrap`, `/api/user/track` |
| Scheduled job | `gsc:fetch` (daily, `0 3 * * *`) |
| ClickHouse table | `traffic_events` (migrations 010, 012, 013, 014, 015) |
| Event types | `bootstrap` (cookieless first touch, incl. bots) · `page` (interactive navigation) |
| Mongo collections | `module_user_gsc_queries` (GSC keyword cache — physical name preserved) · `module_user_gsc_daily_totals` (date-only GSC daily totals) · `module_traffic_ignored_users` (operator ignore list) |
| Analytics key | cookieless `tronrelic_tid` (`candidate_uid`), independent of identity |
| Bootstrap order | Inits/runs **before** `IdentityModule` so its `/api/admin/users/{traffic,analytics}` routers mount ahead of the accounts `/api/admin/users` catch-all |

## Why This Module Exists Separately

Analytics keyed off the cookieless `tronrelic_tid` is independent of identity — it survived the Phase 6 removal of the legacy UUID system untouched. The `traffic_events` ClickHouse table captures two complementary streams without touching identity storage: server-recorded `bootstrap` first touches (cookieless, so crawlers/unfurlers/probes are included by design) and client-recorded `page` navigations (the interactive clickstream of cookied and registered visitors). One table, differentiated by `event_type` and `user_id`, so a visitor's journey from anonymous first touch through registered browsing stays in one place.

Physical storage names are unchanged from when this code lived under the user module: the GSC collection is still `module_user_gsc_queries`, and the ClickHouse migrations' `id` fields are unchanged. Only their migration `qualifiedId` shifts from `module:user:*` to `module:traffic:*` because the scanner derives it from the directory; both migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), so re-execution under the new id is a safe no-op.

## Source Map

| Path | Responsibility |
|------|----------------|
| `TrafficModule.ts` | Two-phase lifecycle; constructs services, mounts the admin router, registers `gsc:fetch` |
| `services/traffic.service.ts` | ClickHouse `traffic_events` writes + admin aggregate reads; `buildTrafficEvent`, `ITrafficEvent`. Also owns the always-on ignore-list exclusion: `setIgnoredUserIds` caches the id set and `rangeParams` (plus `getLiveVisitorCount`) appends the whole-person `candidate_uid NOT IN (…)` subquery |
| `services/ignored-users.service.ts` | `IgnoredUsersService` — Mongo-backed operator ignore list (`module_traffic_ignored_users`); persists id + denormalized email/name, exposes `list`/`getIds`/`add`/`remove`. Persistence only; the query-time filtering is TrafficService's |
| `services/gsc.service.ts` | Google Search Console keyword fetch/store (`module_user_gsc_queries`) plus date-only daily totals (`module_user_gsc_daily_totals`) — GSC drops anonymized queries from keyword rows, so chart totals come from the date-only fetch |
| `services/bot-classifier.ts` | Request → `BotClass` (powers `traffic_events.bot_class`). `classifyTrafficRequest` runs scanner heuristics first — probe paths (`/.env`, encoded traversal) and spoofed search-engine `Referer` with no `Sec-Fetch-Site` — then falls through to the UA-only `classifyUserAgent`; scanners fake browser UAs, so UA-only classification cannot catch them |
| `services/geo.service.ts` | IP → country, referrer parsing, device derivation, `getClientIP`; defines `DeviceCategory` / `ScreenSizeCategory` |
| `api/traffic.{controller,routes}.ts` | `/api/admin/users/traffic/*` raw-traffic reads **and** `/api/admin/users/analytics/*` dashboard aggregates (ClickHouse-backed), including the per-tid / per-user page-activity reads |
| `api/bootstrap.{controller,routes}.ts` | Public ingestion: `POST /api/user/bootstrap` (first-touch `bootstrap`) and `POST /api/user/track` (navigation `page`) — both tid-keyed, account-attributed when logged in; no identity, no Mongo write |
| `api/traffic-cookies.ts` | `tronrelic_tid` / `tronrelic_ref` resolve/mint/set helpers |
| `migrations/010_create_traffic_events_table.ts` | Creates the ClickHouse table (18-month TTL) |
| `migrations/012_traffic_events_user_referral_columns.ts` | Adds `user_id` + `referral_code` columns |
| `migrations/014_traffic_events_cloudflare_columns.ts` | Adds `cf_ray` + `cf_ipcountry`; a NULL `cf_ray` on production traffic means the request bypassed Cloudflare (direct-to-origin) |
| `services/ip-hash.ts` | Keyed SHA-256 source hashes (`getIpHash`/`getSubnetHash`) — salt from `TRAFFIC_IP_HASH_SALT` falling back to `SESSION_SECRET`; raw IPs are never stored |
| `services/channel-classifier.ts` | `classifyChannel` — the single canonical acquisition-channel definition (direct/organic/paid/social/email/ai/referral), GA4-aligned: paid mediums + ad click-IDs first (gclid et al., names forwarded by the middleware, values never stored), then email/social mediums, then referrer-domain lists. Stored at write time on `traffic_events.channel`, bootstrap rows only |
| `migrations/015_traffic_events_source_hash_columns.ts` | Adds `ip_hash` (per-client) + `subnet_hash` (/24 v4, /48 v6) so analytics can answer "same source?" without PII; run before deploying code that writes them |
| `migrations/016_traffic_events_channel_column.ts` | Adds the `channel` column; run before deploying code that writes it. Pre-migration rows read as NULL and fall back to domain-only classification |

## Metrics Contract

Canonical definitions every dashboard, query, and AI tool must conform to. Metric drift happens when definitions live implicitly in SQL — this section is the source of truth; change it and the code together.

| Metric | Definition |
|--------|------------|
| Visitor | Distinct `candidate_uid` (the `tronrelic_tid` cookie) that emitted at least one `page` event in the window — a client that ran JavaScript. This is the canonical Unique Visitor rule: cookieless bots never run JS, so requiring a page event drops them from every visitor metric by construction, independent of `bot_class` (it is also the "no-JS" bot signal). Reads scanning `page` rows express it inline as `uniqExactIf(candidate_uid, event_type = 'page')`; `bootstrap`-only reads (sources/landing/campaigns/source-details) AND in the `pageVisitorMembership` subquery; `new-users` enforces it via a window-scoped `HAVING countIf(event_type = 'page' AND <in-window>) > 0` (scoped to the window so a page beacon after a custom range's end cannot retroactively qualify a new visitor). Still per-browser, not per-person: cookie clearing and multi-device use recount the same person. Bootstrap-only tids stay visible in the Crawlers-tab `bot_class` breakdowns — they are simply not *visitors*. |
| Pageview | A `page` event — the client-side navigation beacon. `bootstrap` rows are first touches, not views (the middleware bootstrap and the first page beacon record the same navigation); every "views" figure counts `page` events only. |
| Source / landing page | First-touch only: the `bootstrap` row's referrer domain and path. `page`-event referrers are the site's own domain after internal navigation and never attribute. |
| Channel | `classifyChannel` over first-touch referrer + UTM + ad click-IDs (`services/channel-classifier.ts`). Paid signals win over referrer heuristics (a paid Google ad carries a google.com referrer, and an auto-tagged one carries only `gclid`). Stored at write time in `traffic_events.channel` on `bootstrap` rows only — `page` rows carry the site's own origin as referrer and store NULL. |
| Session | Derived at read time from `page` events: a per-tid run of hits with gaps under 30 minutes (industry-default rule; `SESSION_GAP_SECONDS`). Never stored — the definition lives in `TrafficService.derivedSessionsSql` only. Duration = last hit − first hit; a single-page session is 0s. Attributed to the window containing its start (GA4's rule): windowed reads scan one extra gap before the window and drop sessions that began earlier, so a boundary-straddling session counts in exactly one window. |
| Bounce | Single-page derived session. Bounce rate = bounces / sessions. |
| Conversion (`converted`) | Distinct tids carrying a non-null `user_id` at any point in the window — login attribution, includes returning account holders. |
| New accounts | Distinct tids in the window attributed to accounts *created* during the window (Better Auth `createdAt`, resolved through the identity module's `'accounts'` service). Creation date is ground truth — a first-login-event proxy would re-mint long-standing accounts as "new" once their earliest rows roll off the table's 18-month TTL. Counted in visitor units so the funnel stages nest. |
| Bot filter (`bots=exclude`) | Excludes rows classified as bots; NULL (unclassified) rows are kept — "exclude known bots", not "humans only". Because a visitor must have a `page` event, cookieless non-JS bots are already absent from visitor counts regardless of this filter; its residual effect on visitor counts is limited to JavaScript-running bots the classifier caught. |
| High-volume source (annotation) | A `subnet_hash` whose in-window request count exceeds `HIGH_VOLUME_SUBNET_MIN_REQUESTS`, surfaced by `getHighVolumeSubnets` (`/analytics/flagged-subnets`) and flagged in the Visitors-tab Source column. An operator hint only — **never** excluded from any count, because legitimate shared egress (offices, VPNs, universities, mobile carriers) also concentrates real visitors behind one network. Not bot-filtered: the flag is about raw source volume, not a `bot_class` guess. |
| Ignored account (always-on) | A Better Auth account on the operator ignore list (`module_traffic_ignored_users`). Excluded from **every** read, unconditionally — no toggle. Whole-person: the exclusion is `candidate_uid NOT IN (SELECT candidate_uid FROM traffic_events WHERE user_id IN …)`, an unwindowed subquery, so every tid that *ever* logged in as an ignored account drops out entirely — including that tid's anonymous, pre-login rows — not just its logged-in rows. Read-time filter only: rows are always recorded and retained, so removing an account restores its full history to every stat immediately. Applied via `TrafficService.rangeParams` (the 18-read chokepoint) plus `getLiveVisitorCount`; the bot-focused Crawlers-tab aggregates and the source-volume `flagged-subnets` read are not filtered (no meaningful registered-user signal there). |

**Attribution doctrine: first-touch.** The `tronrelic_ref` cookie is never overwritten and sources/channels attribute from the bootstrap row, so a visitor who arrives direct and returns later via a campaign link credits "direct" permanently. This is a deliberate choice, not an accident; last-touch or per-session attribution would require sessionized re-attribution and is a future decision, not a bug fix.

## REST Endpoints

The `/api/admin/users/traffic/*` reads below are under `requireAdmin` and accept `sinceHours` (default 24, ceiling 720) and `limit` (default 20, ceiling 200).

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/admin/users/traffic/summary` | Row counts by `bot_class` over the window (NULL preserved) |
| GET | `/api/admin/users/traffic/top-paths` | Most-hit landing paths |
| GET | `/api/admin/users/traffic/top-countries` | Most-active ISO-3166 alpha-2 countries |
| GET | `/api/admin/users/traffic/bot-other-samples` | Frequent UAs classified `bot_other` (classifier-gap feedback) |
| GET | `/api/admin/users/traffic/bot-trend` | Daily counts per `bot_class` (default `sinceHours=168`); NULL folded to `unclassified` |
| GET | `/api/admin/users/traffic/bot-paths` | Top paths for one `botClass` (validated against the `BotClass` allow-list, 400 on miss) |

The `/api/admin/users/analytics/*` router (also `requireAdmin`) serves the `/system/traffic` dashboard aggregates — the unified `overview-trend` headline (current + equal-length-previous-window KPIs for delta rendering, plus a zero-filled visitors/pageviews series bucketed hourly for windows ≤ 48h and daily otherwise), the `live` counter (distinct visitors in the last 5 minutes), daily visitors, anonymous first touches (`new-users`), the high-volume source-network annotation (`flagged-subnets`), traffic sources, geo/device breakdowns, engagement, the binary conversion funnel, retention, and the GSC endpoints — all backed by `traffic_events`. Every windowed analytics read accepts `bots=exclude` to restrict counts to human-classified rows (`bot_class = 'human'` or legacy NULL) — referrers are client-supplied and routinely spoofed by crawlers, so the default include-everything counts overstate real audiences; the dashboard's global filter defaults to humans-only. The `traffic-sources`, `top-landing-pages`, `geo-distribution`, and `device-breakdown` buckets carry `visitors` (distinct tids, the primary measure per analytics convention) alongside the raw event `count`. `traffic-sources` and `top-landing-pages` read only `bootstrap` rows so attribution is first-touch: `page` events carry `document.referrer` (the site's own domain after any internal navigation) and every navigated path, which would otherwise surface the site as its own referral source and turn "landing pages" into "most-viewed pages". The `conversion-funnel` response carries `converted` (tids logged in at any point in the window — includes returning account holders) and `newAccountVisitors` (tids attributed to accounts created during the window — Better Auth `createdAt`, composed by the controller through the `'accounts'` registry service; 0 when identity is unavailable). `campaign-performance` is first-touch attributed like the sources reads: `bootstrap` rows define each campaign's cohort, and conversions read the cohort's full in-window clickstream. GSC reads expose the keyword cache: `gsc/keywords` (aggregated clicks/impressions/CTR/position for a `periodHours` window, plus `windowStart`/`windowEnd` carrying the ~3-day-delay-shifted dates actually covered) and `gsc/keywords-by-day` (zero-filled daily buckets for trend charts; per-day totals come from `module_user_gsc_daily_totals` because GSC omits anonymized queries from keyword rows). Both are Mongo-backed and return empty/zero until the `gsc:fetch` job has stored data. The frontend consumes everything through `src/frontend/modules/traffic/api/client.ts`.

Per-page clickstream reads live on the same router: `tid-activity` and `user-activity` summarize `page` events by anonymous tid (`user_id IS NULL`) and registered account (`user_id IS NOT NULL`) respectively, and `page-hits?subject=tid|user&id=` returns one subject's ordered page hits — "every page they hit".

The ignore list is managed on the same router: `GET/POST /ignored-users` and `DELETE /ignored-users/:userId` read and edit `module_traffic_ignored_users` (each mutation refreshes `TrafficService`'s cached id set so the always-on exclusion takes effect at once), and `account-search?q=` resolves accounts to add — an exact Better Auth id via the `'accounts'` service's `getAccount`, otherwise an email/name substring via `listAccounts`. See the "Ignored account" row in the Metrics Contract for the exclusion semantics.

Two public ingestion endpoints (no auth) write rows; both resolve the tid from the unsigned `tronrelic_tid` cookie and attribute to the Better Auth account when one is present:

- `POST /api/user/bootstrap` — one first-touch `bootstrap` row. Called server-to-server by the Next.js middleware, so it captures cookieless bots and crawlers; this is the noise that powers the "Anonymous First Touches" table.
- `POST /api/user/track` — one `page` row per navigation. Called by the client-side route-change beacon (`src/frontend/modules/user/components/PageViewTracker`, via `lib/pageBeacon`), which fires on mount and every soft navigation. Bots that do not run JS never reach it, so the `page` stream is interactive-traffic-only.

When ClickHouse is unavailable every read returns empty with `clickhouseEnabled: false` rather than failing.

## Lifecycle

**`init()`** runs `initGeoIP()`, then constructs `GscService` (creates indexes) and `TrafficService` (no-ops without ClickHouse), then `IgnoredUsersService` (creates indexes) and seeds `TrafficService`'s ignore cache from it so the exclusion is live from the first read, then builds the traffic + bootstrap controllers. **`run()`** registers the `Traffic` menu item under the System container, mounts the traffic, analytics, and bootstrap routers — the `/api/admin/users/*` routers ahead of the identity module's accounts `/api/admin/users` catch-all — and registers the daily `gsc:fetch` job.

## Related

- [Identity Module README](../identity/README.md) — the sibling module that owns Better Auth + accounts and the other `/api/admin/users/*` routers
- [system-database-migrations.md](../../../../docs/system/system-database-migrations.md) — migration discovery and `qualifiedId` derivation
- [Module Architecture](../../../../docs/system/modules/modules-architecture.md) — IModule contract, bootstrap order
