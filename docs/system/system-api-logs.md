# System Logs Endpoints

<a id="get-apiadminsystemlogs"></a>

Query, inspect, resolve, and purge persisted system logs. Backed by `SystemLogService` (Pino + MongoDB). All endpoints require admin auth — see [system-api.md](./system-api.md#authentication).

## Why This Matters

Logs persist in MongoDB so historical errors survive container restarts and rotate-on-deploy log files. `resolve`/`unresolve` lets operators acknowledge a known issue without deleting the record — recurrence still surfaces in unresolved counts. The `DELETE` endpoint is destructive (clears every entry); use it only in dev.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/system/logs` | Paginated query with filters |
| GET | `/admin/system/logs/stats` | Aggregate counts by level, service, unresolved |
| GET | `/admin/system/logs/:id` | Single entry; 404 if missing |
| PATCH | `/admin/system/logs/:id/resolve` | Mark resolved, record `resolvedBy` |
| PATCH | `/admin/system/logs/:id/unresolve` | Revert; 404 if missing |
| DELETE | `/admin/system/logs` | Wipe all entries (destructive) |

## Query Parameters — `GET /logs`

| Param | Type | Notes |
|---|---|---|
| `levels` | string \| string[] | Any of `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`. Repeat or comma-separate. (`silent` won't match stored rows.) |
| `service` | string | Filter to one service / plugin id |
| `resolved` | `'true'` \| `'false'` | Omit for all |
| `startDate` | ISO string | Inclusive |
| `endDate` | ISO string | Inclusive |
| `page` | number | Default 1 |
| `limit` | number | Default 50 |

`GET /logs` response is **flat** — no `pagination` wrapper:

```json
{
    "success": true,
    "logs": [ /* LogEntry[] */ ],
    "total": 1234,
    "page": 1,
    "limit": 50,
    "totalPages": 25,
    "hasNextPage": true,
    "hasPrevPage": false
}
```

```bash
curl -H "X-Admin-Token: $TOKEN" \
    "http://localhost:4000/api/admin/system/logs?levels=error,warn&page=1&limit=50"
```

## `GET /logs/stats`

```json
{
    "success": true,
    "stats": {
        "total": 1234,
        "byLevel": { "error": 12, "warn": 87, "info": 1135, "debug": 0 },
        "byService": { "blockchain": 540, "scheduler": 220, "...": 0 },
        "unresolved": 12
    }
}
```

The result is **cached 30 seconds** server-side (`STATISTICS_CACHE_TTL_MS`). The two `$group` aggregations do full collection scans on the 1M+ logs collection — without the cache, dashboard polling at 1–10s rates saturates MongoDB CPU. The cache is invalidated immediately on resolve, unresolve, or delete, so admin actions surface without waiting for the TTL. Concurrent cache misses share a single in-flight promise to prevent duplicate aggregations.

## Mutation Bodies

`PATCH /logs/:id/resolve` accepts `{ "resolvedBy": "<actor>" }` and returns `{ "success": true }`. The `unresolve` PATCH and `DELETE` take no body.

`DELETE /logs` returns `{ success, message, deletedCount }`.

## Further Reading

- [system-logging.md](./system-logging.md) — Pino configuration, retention, Logs admin UI
- Source: `src/backend/modules/logs/api/system-log.controller.ts`
