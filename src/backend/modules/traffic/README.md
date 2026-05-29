# Traffic Module

Owns cookieless behavioral analytics: the ClickHouse `traffic_events` pipeline, Google Search Console keyword integration, the User-Agent bot classifier, and geo/IP derivation. Carved out of the former omnibus user module so analytics has a single owner independent of identity.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `traffic` |
| Module class | `src/backend/modules/traffic/TrafficModule.ts` |
| Mounted routes | `/api/admin/users/traffic/*` |
| Scheduled job | `gsc:fetch` (daily, `0 3 * * *`) |
| ClickHouse table | `traffic_events` (migrations 010, 012) |
| Mongo collection | `module_user_gsc_queries` (GSC keyword cache — physical name preserved) |
| Analytics key | cookieless `tronrelic_tid` (`candidate_uid`), independent of identity |
| Bootstrap order | Inits and runs **before** `UserModule` (legacy `UserService` resolves these singletons) |

## Why This Module Exists Separately

Analytics keyed off the cookieless `tronrelic_tid` must survive the Phase 6 removal of the legacy UUID identity system. Splitting the traffic pipeline out of the user module lets it outlive the identity cutover untouched. The `traffic_events` ClickHouse table captures cookieless and pre-session HTTP traffic (crawlers, unfurlers, probes) without polluting the Mongo `users` collection — see `PLAN-traffic-events.md`.

Physical storage names are unchanged from when this code lived under the user module: the GSC collection is still `module_user_gsc_queries`, and the ClickHouse migrations' `id` fields are unchanged. Only their migration `qualifiedId` shifts from `module:user:*` to `module:traffic:*` because the scanner derives it from the directory; both migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), so re-execution under the new id is a safe no-op.

## Source Map

| Path | Responsibility |
|------|----------------|
| `TrafficModule.ts` | Two-phase lifecycle; constructs services, mounts the admin router, registers `gsc:fetch` |
| `services/traffic.service.ts` | ClickHouse `traffic_events` writes + admin aggregate reads; `buildTrafficEvent`, `ITrafficEvent` |
| `services/gsc.service.ts` | Google Search Console keyword fetch/store (`module_user_gsc_queries`) |
| `services/bot-classifier.ts` | User-Agent → `BotClass` (powers `traffic_events.bot_class`) |
| `services/geo.service.ts` | IP → country, referrer parsing, device derivation, `getClientIP` |
| `api/traffic.{controller,routes}.ts` | `/api/admin/users/traffic/*` aggregate + per-user reads |
| `migrations/010_create_traffic_events_table.ts` | Creates the ClickHouse table (18-month TTL) |
| `migrations/012_traffic_events_user_referral_columns.ts` | Adds `user_id` + `referral_code` columns |

## REST Endpoints

All under `requireAdmin`. Accept `sinceHours` (default 24, ceiling 720) and `limit` (default 20, ceiling 200).

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/admin/users/traffic/summary` | Row counts by `bot_class` over the window (NULL preserved) |
| GET | `/api/admin/users/traffic/top-paths` | Most-hit landing paths |
| GET | `/api/admin/users/traffic/top-countries` | Most-active ISO-3166 alpha-2 countries |
| GET | `/api/admin/users/traffic/bot-other-samples` | Frequent UAs classified `bot_other` (classifier-gap feedback) |

The per-user history endpoint (`GET /api/admin/users/:id/traffic-history`) lives on the legacy user admin router so it composes with the cookie-resolved UUID; it calls `TrafficService` directly.

When ClickHouse is unavailable every read returns empty with `clickhouseEnabled: false` rather than failing.

## Lifecycle

**`init()`** runs `initGeoIP()`, then constructs `GscService` (creates indexes) and `TrafficService` (no-ops without ClickHouse), then builds the admin controller. **`run()`** mounts `/api/admin/users/traffic` ahead of the legacy `/api/admin/users` router and registers the daily `gsc:fetch` job.

## Legacy Coupling (Removed in Phase 6)

`UserService` (legacy) still consumes `TrafficService` and `GscService` (injected by `UserModule` via `getInstance()`) for its analytics aggregations, and `UserController`'s bootstrap path calls `buildTrafficEvent` / `getClientIP`. These cross-module reads disappear when the analytics surface re-platforms onto `TrafficService` and the user module is deleted.

## Related

- [PLAN-traffic-events.md](../../../../PLAN-traffic-events.md) — the cookieless-traffic split phased rollout
- [system-database-migrations.md](../../../../docs/system/system-database-migrations.md) — migration discovery and `qualifiedId` derivation
- [Module Architecture](../../../../docs/system/modules/modules-architecture.md) — IModule contract, bootstrap order
