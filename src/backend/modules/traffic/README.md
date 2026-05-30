# Traffic Module

Owns cookieless behavioral analytics: the ClickHouse `traffic_events` pipeline, Google Search Console keyword integration, the User-Agent bot classifier, and geo/IP derivation. Carved out of the former omnibus user module so analytics has a single owner independent of identity.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `traffic` |
| Module class | `src/backend/modules/traffic/TrafficModule.ts` |
| Mounted routes | `/api/admin/users/traffic/*`, `/api/admin/users/analytics/*`, `/api/user/bootstrap` |
| Scheduled job | `gsc:fetch` (daily, `0 3 * * *`) |
| ClickHouse table | `traffic_events` (migrations 010, 012) |
| Mongo collection | `module_user_gsc_queries` (GSC keyword cache — physical name preserved) |
| Analytics key | cookieless `tronrelic_tid` (`candidate_uid`), independent of identity |
| Bootstrap order | Inits/runs **before** `IdentityModule` so its `/api/admin/users/{traffic,analytics}` routers mount ahead of the accounts `/api/admin/users` catch-all |

## Why This Module Exists Separately

Analytics keyed off the cookieless `tronrelic_tid` is independent of identity — it survived the Phase 6 removal of the legacy UUID system untouched. The `traffic_events` ClickHouse table captures cookieless and pre-session HTTP traffic (crawlers, unfurlers, probes) without touching identity storage.

Physical storage names are unchanged from when this code lived under the user module: the GSC collection is still `module_user_gsc_queries`, and the ClickHouse migrations' `id` fields are unchanged. Only their migration `qualifiedId` shifts from `module:user:*` to `module:traffic:*` because the scanner derives it from the directory; both migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), so re-execution under the new id is a safe no-op.

## Source Map

| Path | Responsibility |
|------|----------------|
| `TrafficModule.ts` | Two-phase lifecycle; constructs services, mounts the admin router, registers `gsc:fetch` |
| `services/traffic.service.ts` | ClickHouse `traffic_events` writes + admin aggregate reads; `buildTrafficEvent`, `ITrafficEvent` |
| `services/gsc.service.ts` | Google Search Console keyword fetch/store (`module_user_gsc_queries`) |
| `services/bot-classifier.ts` | User-Agent → `BotClass` (powers `traffic_events.bot_class`) |
| `services/geo.service.ts` | IP → country, referrer parsing, device derivation, `getClientIP`; defines `DeviceCategory` / `ScreenSizeCategory` |
| `api/traffic.{controller,routes}.ts` | `/api/admin/users/traffic/*` raw-traffic reads **and** `/api/admin/users/analytics/*` dashboard aggregates (ClickHouse-backed) |
| `api/bootstrap.{controller,routes}.ts` | `POST /api/user/bootstrap` — emits one first-touch `bootstrap` traffic_event (tid-keyed; no identity, no Mongo write) |
| `api/traffic-cookies.ts` | `tronrelic_tid` / `tronrelic_ref` resolve/mint/set helpers |
| `migrations/010_create_traffic_events_table.ts` | Creates the ClickHouse table (18-month TTL) |
| `migrations/012_traffic_events_user_referral_columns.ts` | Adds `user_id` + `referral_code` columns |

## REST Endpoints

The `/api/admin/users/traffic/*` reads below are under `requireAdmin` and accept `sinceHours` (default 24, ceiling 720) and `limit` (default 20, ceiling 200).

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/admin/users/traffic/summary` | Row counts by `bot_class` over the window (NULL preserved) |
| GET | `/api/admin/users/traffic/top-paths` | Most-hit landing paths |
| GET | `/api/admin/users/traffic/top-countries` | Most-active ISO-3166 alpha-2 countries |
| GET | `/api/admin/users/traffic/bot-other-samples` | Frequent UAs classified `bot_other` (classifier-gap feedback) |

The `/api/admin/users/analytics/*` router (also `requireAdmin`) serves the `/system/users` dashboard aggregates — daily visitors, traffic sources, geo/device breakdowns, engagement, the binary conversion funnel, retention, and the GSC endpoints — all backed by `traffic_events`. The frontend consumes them through `src/frontend/modules/user/api/client.ts`.

`POST /api/user/bootstrap` (public) emits one first-touch `bootstrap` row keyed on the inbound `tronrelic_tid`; it mints no identity.

When ClickHouse is unavailable every read returns empty with `clickhouseEnabled: false` rather than failing.

## Lifecycle

**`init()`** runs `initGeoIP()`, then constructs `GscService` (creates indexes) and `TrafficService` (no-ops without ClickHouse), then builds the traffic + bootstrap controllers. **`run()`** mounts the traffic, analytics, and bootstrap routers — the `/api/admin/users/*` routers ahead of the identity module's accounts `/api/admin/users` catch-all — and registers the daily `gsc:fetch` job.

## Related

- [Identity Module README](../identity/README.md) — the sibling module that owns Better Auth + accounts and the other `/api/admin/users/*` routers
- [system-database-migrations.md](../../../../docs/system/system-database-migrations.md) — migration discovery and `qualifiedId` derivation
- [Module Architecture](../../../../docs/system/modules/modules-architecture.md) — IModule contract, bootstrap order
