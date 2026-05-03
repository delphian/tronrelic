# Market Monitoring Endpoints

Per-platform status, freshness aggregates, and manual refresh trigger for the energy rental market subsystem. All endpoints require admin auth — see [system-api.md](./system-api.md#authentication).

## Why This Matters

A single failing platform skews the rental leaderboard and energy pricing without throwing visible errors — the symptom is "stale" data, not a 500. `/platforms` surfaces consecutive-failure counts so operators can catch a degraded fetcher before users notice. `POST /refresh?force=true` bypasses the in-memory cache when investigating discrepancies.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/system/markets/platforms` | Per-platform status, reliability, consecutive failures |
| GET | `/admin/system/markets/freshness` | Oldest age, stale count, average age |
| POST | `/admin/system/markets/refresh` | Fire-and-forget refresh; optional `force` to bypass cache |

## Response Reference

### `GET /markets/platforms` — `platforms[]` array

| Field | Type | Notes |
|---|---|---|
| `guid` | string | Platform identifier |
| `name` | string | Display name |
| `lastFetchedAt` | string (ISO) \| null | Last successful fetch |
| `status` | string | `online` (<10m) \| `stale` (10–60m) \| `failed` (>60m) \| `disabled` |
| `reliabilityScore` | number | Success percent, 0–100 |
| `consecutiveFailures` | number | |
| `isActive` | boolean | Platform enabled |

```bash
curl -H "X-Admin-Token: $TOKEN" http://localhost:4000/api/admin/system/markets/platforms \
    | jq '.platforms[] | select(.status == "stale" or .status == "failed")
                       | {name, status, consecutiveFailures}'
```

### `GET /markets/freshness` — `freshness` payload

| Field | Type | Notes |
|---|---|---|
| `oldestDataAge` | number \| null | Minutes |
| `stalePlatformCount` | number | Data >10 min old |
| `averageDataAge` | number | Minutes |
| `platformsWithOldData` | array | Names with data >60 min old |

### `POST /markets/refresh`

Optional body:

```json
{ "force": true }
```

`force: true` bypasses the in-memory rate-limit cache so every fetcher hits its provider immediately. Without it, the refresh respects per-platform throttles.

Response:

```json
{ "success": true, "message": "Market refresh triggered" }
```

```bash
# Normal
curl -X POST -H "X-Admin-Token: $TOKEN" \
    http://localhost:4000/api/admin/system/markets/refresh

# Force
curl -X POST -H "X-Admin-Token: $TOKEN" -H "Content-Type: application/json" \
    -d '{"force": true}' \
    http://localhost:4000/api/admin/system/markets/refresh
```

Verify with `/freshness` after a few seconds.

## Related

- [system-api-scheduler.md](./system-api-scheduler.md) — `markets:refresh` job control
- [market-system-architecture.md](../markets/market-system-architecture.md) — Fetcher pipeline and normalization
