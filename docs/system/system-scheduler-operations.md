# Scheduler Operations

How TronRelic's scheduler runs core jobs, how to control them at runtime, and how to diagnose stalls.

## Why This Matters

The scheduler drives blockchain sync, chain-parameter refresh, prune, and cache cleanup. When a job stops, downstream data goes stale silently — no banner, no alert. Per-job control at runtime (no restart, no redeploy) is the operator's only line of defense.

## Architecture

### Global Kill Switch

`ENABLE_SCHEDULER=false` disables every job, core or plugin-registered. The scheduler reads this once at boot; flipping it requires a backend restart. Use during local dev to avoid TronGrid pressure, during incident triage to isolate noise, or in tests.

### Per-Job Configuration

Each job has an enabled flag and a cron expression, both persisted in the `scheduler_configs` MongoDB collection. Changes from the dashboard or the admin API write to that collection and take effect on the **next tick** — no restart. Settings survive restarts because they live in the database, not in env or memory.

## Core Jobs

Six jobs registered in `src/backend/modules/scheduler/jobs/core-jobs.ts`:

| Job | Default Schedule | Purpose | Impact if Down |
|---|---|---|---|
| `blockchain:sync` | `*/1 * * * *` | Retrieve TRON blocks, enrich, dispatch to observers | Transaction feed and observers go silent |
| `blockchain:prune` | `0 * * * *` | Drop transactions older than retention window | `transactions` collection grows unbounded |
| `chain-parameters:fetch` | `*/10 * * * *` | Pull `energyPerTrx`, `energyFee` from TRON | Energy/TRX conversions drift from network truth |
| `usdt-parameters:fetch` | `*/10 * * * *` | Pull current USDT transfer energy cost | USDT pricing drifts |
| `cache:cleanup` | `0 * * * *` | Evict expired cache entries | Memory usage grows |
| `system-logs:cleanup` | `0 * * * *` | Delete logs past retention | Log storage grows |

Plugins register additional jobs via `context.scheduler.register(name, cron, fn)`; the dashboard and admin API treat them identically to core jobs.

## Controlling Jobs at Runtime

### Dashboard

Toggle, edit, and inspect every job at `/system` → Scheduler section. Visual states (enabled/disabled, run status, last duration) and the auth path are documented in [system-dashboard.md](./system-dashboard.md).

### Admin API

`PATCH /api/admin/system/scheduler/job/{jobName}` accepts `{enabled, schedule}` (either or both):

```bash
curl -X PATCH \
  -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "schedule": "*/3 * * * *"}' \
  http://localhost:4000/api/admin/system/scheduler/job/blockchain:sync
```

`GET /api/admin/system/scheduler/status` returns all jobs with enabled state and last-execution metadata. See [system-api-scheduler.md](./system-api-scheduler.md) for the full endpoint reference.

### Running a Job Now

`POST /api/admin/system/scheduler/job/{jobName}/run` runs a job once immediately, outside its schedule — the way to exercise a low-frequency job before its next tick (e.g. the 4-hourly `account-history:snapshot` for a newly tracked account) without waiting or rescheduling. It ignores the enabled flag and preserves single-flight (a job already running reports `started: false` rather than stacking a second run). The dashboard exposes this as a per-job "Run now" button. Full contract in [system-api-scheduler.md](./system-api-scheduler.md#post-schedulerjobjobnamerun).

## Cron Expressions

Standard 5-field cron (`minute hour day-of-month month day-of-week`). The backend rejects expressions that don't have exactly 5 space-separated fields with a 400 error — there is no degraded mode for malformed schedules.

## Troubleshooting

Most stalls reduce to four checks: is the global flag on (`echo $ENABLE_SCHEDULER`), is the specific job enabled in `/system`, did the last run fail (red badge → tail backend logs for the job name), and is `last run` ancient (job never fired — wait one tick, or force it with the "Run now" button / the run endpoint above).

| Symptom | Likely cause |
|---|---|
| All jobs `never_run` | `ENABLE_SCHEDULER=false` at boot, or scheduler module failed to initialize (check startup logs for `Scheduler started`) |
| One job stuck on red badge | Upstream failure — TronGrid rate limit, MongoDB slow, plugin bug; tail logs filtered by job name |
| One job runs but data still stale | Wrong job — confirm the right job feeds the data (e.g., `chain-parameters:fetch` not `blockchain:sync` for energy ratios) |
| Job duration grows over time | Backlog catching up (acceptable) or unbounded query (open a ticket); check `/system` Blockchain Status if it's `blockchain:sync` |
| Cron edit didn't take effect | Invalid expression rejected with 400, or the next tick hasn't fired yet — settings persist in `scheduler_configs`; verify via `GET /scheduler/status` |

For pipeline-specific failures in `blockchain:sync`, see [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md).

## Further Reading

- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) — what `blockchain:sync` actually does each tick
- [system-api-scheduler.md](./system-api-scheduler.md) — full admin API reference for status, health, PATCH
- [system-dashboard.md](./system-dashboard.md) — `/system` UI walkthrough and authentication
- [environment.md](../environment.md) — `ENABLE_SCHEDULER`, `TRONGRID_API_KEY*`, `BLOCK_SYNC_*`
