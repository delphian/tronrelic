# Scheduler Operations

<a id="scheduler-operations"></a>

Status, global health, and runtime config for scheduled jobs (`blockchain:sync`, `chain-parameters:fetch`, etc.). All endpoints require admin auth — see [system-api.md](./system-api.md#authentication).

## Why This Matters

Schedule changes via `PATCH` persist to MongoDB and survive restarts — operators reconfigure cadence without redeploying. Disabling a job (e.g. `blockchain:prune` during a long-running migration) avoids piling up failures and stops downstream noise. The status endpoint is the easiest way to confirm a job actually ran after manual intervention.

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
| `name` | string | e.g. `blockchain:sync` |
| `schedule` | string | Active cron expression |
| `enabled` | boolean | |
| `lastRun` | string \| null | ISO; `null` when never run |
| `nextRun` | null | Reserved; always `null` (computation not wired) |
| `status` | string | `success` \| `failed` \| `running` \| `never_run` |
| `duration` | number \| null | Seconds (last execution `duration / 1000`) |
| `error` | string \| null | Last failure message |

```bash
curl -H "X-Admin-Token: $TOKEN" http://localhost:4000/api/admin/system/scheduler/status \
    | jq '.jobs[] | select(.status == "failed") | {name, error}'
```

Disabled jobs always report `status: "never_run"` regardless of execution history — the controller masks the real status when `enabled: false`.

### `GET /scheduler/health` — `health` payload

| Field | Type | Notes |
|---|---|---|
| `enabled` | boolean | `ENABLE_SCHEDULER` env value |
| `uptime` | number | Process uptime in seconds (`process.uptime()`) |
| `totalJobsExecuted` | number | Live count from `scheduler_executions` collection |
| `successRate` | number | `round(success / total * 100)`; defaults to 100 when zero executions |
| `overdueJobs` | array | **Stub — always `[]`.** Overdue detection is not yet implemented. |

### `PATCH /scheduler/job/:jobName`

`:jobName` is the job identifier. Body fields all optional — send the ones you want to change.

```json
{ "enabled": true, "schedule": "*/10 * * * *" }
```

Success response (200) echoes the updated job and includes the original default for reference:

```json
{
    "success": true,
    "message": "Scheduler job blockchain:sync updated successfully",
    "job": {
        "name": "blockchain:sync",
        "schedule": "*/10 * * * *",
        "enabled": true,
        "defaultSchedule": "*/1 * * * *"
    }
}
```

**Error responses:**

| Status | Trigger | `error` text |
|---|---|---|
| 503 | Scheduler module not running | `"Scheduler is not enabled or not initialized"` |
| 400 | `schedule` present but not a string | `"Schedule must be a valid cron expression string"` |
| 400 | `enabled` present but not a boolean | `"Enabled must be a boolean"` |
| 400 | Cron parse failure or unknown job | underlying error message from `updateJobConfig` |

```bash
# Disable temporarily
curl -X PATCH -H "X-Admin-Token: $TOKEN" -H "Content-Type: application/json" \
    -d '{"enabled": false}' \
    http://localhost:4000/api/admin/system/scheduler/job/blockchain:sync

# Reschedule
curl -X PATCH -H "X-Admin-Token: $TOKEN" -H "Content-Type: application/json" \
    -d '{"schedule": "*/15 * * * *"}' \
    http://localhost:4000/api/admin/system/scheduler/job/chain-parameters:fetch
```

Changes apply on the next tick — they do not retroactively run a missed schedule.

## Further Reading

- [system-scheduler-operations.md](./system-scheduler-operations.md) — Cron syntax, persistence, runbooks, the six core jobs
- [system-api.md](./system-api.md#troubleshooting) — "Scheduler PATCH had no effect"
