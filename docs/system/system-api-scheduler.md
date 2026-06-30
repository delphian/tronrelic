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
| POST | `/admin/system/scheduler/job/:jobName/run` | Run the job once now, outside its schedule |

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

Changes apply on the next tick — they do not retroactively run a missed schedule. To run a job immediately, use the run endpoint below.

### `POST /scheduler/job/:jobName/run`

Triggers one out-of-schedule run of `:jobName` — the only way to exercise a low-frequency job before its next tick (e.g. forcing the 4-hourly `account-history:snapshot` for a newly tracked wallet). The job's `enabled` flag is ignored: a manual run executes the handler once and touches neither the cron task nor persisted config, so a disabled job can be run without re-enabling it.

Returns `202` immediately (the run is fire-and-forget; the outcome lands in `scheduler_executions` and surfaces on the next `status` poll). `started` is `false` — not an error — when the job was already running, because single-flight is preserved server-side.

```json
{ "success": true, "started": true, "message": "Scheduler job account-history:snapshot run started" }
```

| Status | Trigger | `error` text |
|---|---|---|
| 202 | Run accepted (`started: true`) or already running (`started: false`) | — |
| 404 | Unknown job | `"Job <name> not registered"` |
| 503 | Scheduler module not running | `"Scheduler is not enabled or not initialized"` |

```bash
curl -X POST -H "X-Admin-Token: $TOKEN" \
    http://localhost:4000/api/admin/system/scheduler/job/account-history:snapshot/run
```

## Further Reading

- [system-scheduler-operations.md](./system-scheduler-operations.md) — Cron syntax, persistence, runbooks, the six core jobs
- [system-api.md](./system-api.md#troubleshooting) — "Scheduler PATCH had no effect"
