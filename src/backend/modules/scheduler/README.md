# Scheduler

`SchedulerModule` implements `IModule`, running centralized cron jobs with dynamic reconfiguration, execution tracking, and overlap protection via `SchedulerService`.

## Admin Page

`/system/scheduler` renders in `AdminPage` with a Submenu Pattern tab row. `SchedulerModule.run()` registers the tabs as memory-only nodes in the `scheduler` menu namespace, each with `requiresAdmin: true`, before its `ENABLE_SCHEDULER` check, so the row exists even when the scheduler is off. The server entry `page.tsx` fetches the namespace and the `?tab=` value, and the client shell `SchedulerAdminClient.tsx` renders the tabs.

| Tab | Panel | Scope |
|-----|-------|-------|
| **Jobs** | Core `SchedulerMonitor`, unscoped | Every job on the deployment |
| **Database** | Core `CollectionBrowser`, read-only | Prefix `scheduler_`: `scheduler_configs` and `scheduler_executions`, which predate the `module_<id>_` convention |
| **Logs** | Core `SystemLogsMonitor` | Service `tronrelic:scheduler` |

The Database tab is read-only because a running job holds its schedule and enabled state in memory and reads its stored config only when it is scheduled. An edit would not reach the live job, and deleting a live job's config loses its schedule at the next restart. The Jobs tab is the supported way to change a job.

**What the Logs tab shows.** The module logs through `logger.child({ module: 'scheduler' })` and passes that logger to `SchedulerService.setDependencies`, so the service's own entries are filed under `tronrelic:scheduler`. A job's run entries (start, skip, success, failure) go through the logger passed to `register()` with `{ logger }`, so a job owned by another module or a plugin is filed on that owner's Logs tab, not here. The core jobs with no other owner (`chain-parameters:fetch`, `usdt-parameters:fetch`, `cache:cleanup`, `system-logs:cleanup`) pass the scheduler's logger from `registerCoreJobs`, and a job registered without a logger falls back to it, so both appear here. The `blockchain:*` and `network-activity:rollup` jobs pass the blockchain module's logger and appear on the Logs tab of `/system/system`. Every job's last run and its error, whoever owns the job, are also on the Jobs tab.

## Canonical documentation

- [system-scheduler-operations.md](../../../../docs/system/system-scheduler-operations.md) — job control, cron syntax, persistence, troubleshooting
- [system-api-scheduler.md](../../../../docs/system/system-api-scheduler.md) — scheduler status, health, and job PATCH endpoints
