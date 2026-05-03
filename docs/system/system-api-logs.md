# System Logs Endpoints

<a id="get-apiadminsystemlogs"></a>

Query, inspect, resolve, and purge persisted system logs. Backed by `SystemLogService` (Pino + MongoDB). All endpoints require admin auth — see [system-api.md](./system-api.md#authentication).

## Why This Matters

Logs persist in MongoDB so historical errors survive container restarts and rotate-on-deploy log files. `resolve`/`unresolve` lets operators acknowledge a known issue without deleting the record — recurrence still surfaces in unresolved counts. The `DELETE` endpoint is destructive (clears every entry); use it only in dev.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/system/logs` | Paginated query with filters |
| GET | `/admin/system/logs/stats` | Aggregate counts by level/service/resolved |
| GET | `/admin/system/logs/:id` | Single entry; 404 if missing |
| PATCH | `/admin/system/logs/:id/resolve` | Mark resolved, record `resolvedBy` |
| PATCH | `/admin/system/logs/:id/unresolve` | Revert; 404 if missing |
| DELETE | `/admin/system/logs` | Wipe all entries (destructive) |

## Query Parameters — `GET /logs`

| Param | Type | Notes |
|---|---|---|
| `levels` | string \| string[] | Any of `error`, `warn`, `info`, `debug`. Repeat or comma-separate. |
| `service` | string | Filter to one service / plugin id |
| `resolved` | `'true'` \| `'false'` | Omit for all |
| `startDate` | ISO string | Inclusive |
| `endDate` | ISO string | Inclusive |
| `page` | number | Default 1 |
| `limit` | number | Page size |

Response shape (top-level fields beyond `success`):

```json
{
    "success": true,
    "logs": [ /* LogEntry[] */ ],
    "pagination": { "page": 1, "limit": 50, "total": 1234, "pages": 25 },
    "statistics": { /* same shape as /logs/stats */ }
}
```

```bash
curl -H "X-Admin-Token: $TOKEN" \
    "http://localhost:4000/api/admin/system/logs?levels=error,warn&page=1&limit=50"
```

## Mutation Bodies

`PATCH /logs/:id/resolve` accepts `{ "resolvedBy": "<actor>" }`. The other PATCH and DELETE take no body.

`DELETE /logs` returns `{ success, message, deletedCount }`.

## Related

- [system-logging.md](./system-logging.md) — Pino configuration, retention, Logs admin UI
- Source: `src/backend/modules/logs/api/system-log.controller.ts`
