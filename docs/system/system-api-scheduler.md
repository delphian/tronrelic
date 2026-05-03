# Scheduler Operations

<a id="scheduler-operations"></a>

Status, global health, and runtime config for scheduled jobs (`blockchain:sync`, `markets:refresh`, etc.). All endpoints require admin auth — see [system-api.md](./system-api.md#authentication).

## Why This Matters

Schedule changes via `PATCH` persist to MongoDB and survive restarts — operators reconfigure cadence without redeploying. Disabling a job (e.g. `markets:refresh` during a provider outage) avoids piling up failures and stops downstream noise. The status endpoint is also the easiest way to confirm a job actually ran after manual intervention.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/system/scheduler/status` | All jobs with last/next run, status, duration, error |
| GET | `/admin/system/scheduler/health` | Global enabled flag, uptime, success rate, overdue jobs |
| PATCH | `/admin/system/scheduler/job/:jobName` | Toggle `enabled` or update `schedule` (cron) |

## Response Reference

### `GET /scheduler/status` — `jobs[]` array

| Field | Type | Notes |
|---|---|---|
| `name` | string | e.g. `markets:refresh` |
| `schedule` | string | Cron expression |
| `enabled` | boolean | |
| `lastRun` | string (ISO) | |
| `status` | string | `success` \| `failed` \| `running` \| `never_run` |
| `duration` | number \| null | Seconds |
| `error` | string \| null | Last failure message |

```bash
curl -H "X-Admin-Token: $TOKEN" http://localhost:4000/api/admin/system/scheduler/status \
    | jq '.jobs[] | select(.status == "failed") | {name, error}'
```

### `GET /scheduler/health` — `health` payload

| Field | Type | Notes |
|---|---|---|
| `enabled` | boolean | `ENABLE_SCHEDULER` |
| `uptime` | number | Seconds |
| `totalJobsExecuted` | number | Currently always 0 (not yet wired) |
| `successRate` | number | Currently always 100 |
| `overdueJobs` | array | Currently always empty |

### `PATCH /scheduler/job/:jobName`

`:jobName` is the job identifier (e.g. `markets:refresh`). Body fields all optional — send the ones you want to change.

```json
{ "enabled": true, "schedule": "*/10 * * * *" }
```

Success response echoes the updated job:

```json
{
    "success": true,
    "message": "Scheduler job markets:refresh updated successfully",
    "job": { "name": "markets:refresh", "schedule": "*/10 * * * *", "enabled": true }
}
```

Invalid cron returns `{ "success": false, "error": "Invalid cron expression" }`.

```bash
# Disable temporarily
curl -X PATCH -H "X-Admin-Token: $TOKEN" -H "Content-Type: application/json" \
    -d '{"enabled": false}' \
    http://localhost:4000/api/admin/system/scheduler/job/blockchain:sync

# Reschedule
curl -X PATCH -H "X-Admin-Token: $TOKEN" -H "Content-Type: application/json" \
    -d '{"schedule": "*/15 * * * *"}' \
    http://localhost:4000/api/admin/system/scheduler/job/markets:refresh
```

Changes apply on the next tick — they do not retroactively run a missed schedule.

## Related

- [system-scheduler-operations.md](./system-scheduler-operations.md) — Cron syntax, persistence, runbooks
- [system-api.md](./system-api.md#troubleshooting) — "Scheduler PATCH had no effect"
