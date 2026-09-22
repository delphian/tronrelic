# Logs Module

Unified logging with MongoDB persistence. Wraps Pino as a singleton, persists to `system_logs` collection, exposes REST endpoints for filtering/resolving/deleting, and provides a frontend monitor with live polling and flash animations for new entries.

## Who This Document Is For

AI agents and developers fixing bugs or extending the logging system. Sacrifices grammar for density. Read top-to-bottom before changing anything.

## Why This Matters

Every backend service and plugin logs through `SystemLogService.getInstance()`. Breaking this singleton breaks all logging. The service has a two-tier error fallback (simplified record, then console) specifically because a logging failure that itself fails to log is invisible. The metadata sanitizer prevents BSON serialization crashes from circular references, functions, and deep nesting that would otherwise silently drop log entries.

## How It Works

1. `LogsModule.init()` receives Pino logger + database, initializes `SystemLogService` singleton
2. All backend code imports `logger` from `lib/logger.ts` (re-exports the singleton)
3. Log calls (`info`, `warn`, `error`, etc.) write to Pino transports AND MongoDB via `saveLogFromArgs()`
4. `saveLogFromArgs()` parses Pino's multiple call signatures (string, object, object+string, object+string+args)
5. `sanitizeMetadata()` strips circular refs, functions, deep nesting before BSON insertion
6. `LogsModule.run()` registers `/system/logs` menu item and mounts admin routes
7. Frontend `SystemLogsMonitor` polls the REST API, highlights new entries with flash animation

## Key Files

| File | Purpose |
|------|---------|
| `LogsModule.ts` | IModule implementation, two-phase lifecycle, menu + route registration, ai-assistant watch |
| `ai-tools.ts` | Read-only AI tool definitions + service-registry watch registration |
| `user-settings.ts` | Registers the log viewer severity preference (`LOG_MONITOR_LEVELS_SETTING`) on `'user-settings'` via watch; `isValidMonitorLevels` guards the untrusted value |
| `services/system-log.service.ts` | Singleton logger + MongoDB storage, sanitization, child loggers, stats |
| `database/SystemLog.ts` | Mongoose schema, compound indexes, `ISystemLogDocument` interface |
| `api/system-log.controller.ts` | Express handlers for all 6 endpoints |
| `api/system-log.router.ts` | Factory creates router, mounts under system admin routes |
| `../../lib/logger.ts` | Creates Pino instance, exports singleton for all backend imports |

### Frontend

| File | Purpose |
|------|---------|
| `modules/logs/components/SystemLogsMonitor/SystemLogsMonitor.tsx` | The viewer: toolbar, compact entry table, footer, entry slide-over; polling and new-row flash |
| `modules/logs/components/LogLevelFilter/LogLevelFilter.tsx` | Severity toggle chips that double as per-level counts |
| `modules/logs/components/LogEntryDetail/LogEntryDetail.tsx` | Full record of one entry (message, error text, context with copy, ids) for the slide-over |
| `modules/logs/lib/logPresentation.ts` | Shared level order, labels, badge tones, timestamp split, context error extraction |
| `modules/logs/components/LogSettings/LogSettings.tsx` | Compact recording-level row; runtime log level control without restart |
| `modules/logs/api/client.ts` | Typed fetch wrappers for all log endpoints |
| `modules/logs/types/logs.types.ts` | `SystemLog`, `LogsResponse`, `LogStats` interfaces |

### Shared Types

| File | Purpose |
|------|---------|
| `types/system-log/ISystemLogService.d.ts` | Full service interface contract |
| `types/system-log/LogLevels.d.ts` | Level constants, `LogLevelName` type, `shouldLog()` helper |

## Storage

Single collection `system_logs` with Mongoose schema:

- `timestamp` (Date) — when log was created
- `level` (string, indexed) — trace/debug/info/warn/error/fatal
- `message` (string) — human-readable description
- `service` (string) — source identifier, plugin prefix format `plugin:whale-alerts`
- `context` (mixed) — sanitized metadata object
- `resolved` (boolean, indexed) — admin acknowledgment flag
- `resolvedAt`, `resolvedBy` — resolution metadata

Compound indexes: `{timestamp: -1, level: 1, resolved: 1}` for paginated filtering, `{service: 1, timestamp: -1}` for service-specific queries.

`timestamp` and `service` carry no single-field index because each is the leading field of one of the compound indexes above, which therefore already serves a query filtering on that field alone. `level` and `resolved` keep theirs because they sit in non-leading positions, where a compound index cannot be used for a filter on that field by itself. Do not re-add `index: true` to `timestamp` or `service`. A duplicate index costs more than the keys it holds: retention churns this collection constantly, and WiredTiger leaves an index file at its high-water mark, so the redundant copy keeps its space long after the documents it indexed are deleted.

## Admin API Endpoints

All under `/api/admin/system/logs`, all require `X-Admin-Token` header.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Paginated logs with level/service/date/resolved filters |
| GET | `/stats` | Aggregate counts by level and service, unresolved count. Optional `service` query scopes every count to that exact service (index-backed, cached per service for 30s) |
| GET | `/:id` | Single log entry (404 if missing) |
| PATCH | `/:id/resolve` | Mark as resolved with `resolvedBy` field |
| PATCH | `/:id/unresolve` | Revert resolution |
| DELETE | `/` | Bulk delete all logs (destructive) |

## AI Tools

`run()` watches the service registry for the core `'ai-tools'` registry (`IAiToolRegistry`) and registers three strictly read-only tools (`providerId: 'logs'`) whenever it appears — the watch pattern covers the AI tools module publishing the registry after this module's `run()` sets up the watch. Governance (rate limiting, audit, policy) is core-owned; each tool declares its capability and the governor does the rest. The query and get tools surface raw log context (potential secrets and attacker-influenced strings), so they declare `sensitivity: 'secret'` and `surfacesUntrustedContent: true`; the statistics tool returns only aggregate counts and is plain `read`/`internal`. Handlers call `SystemLogService` directly. The deprecated `resolved` column is excluded from every tool input and output. Registration failures are logged and swallowed; AI tooling never blocks module startup. See [system-ai-tools.md](../../../../docs/system/system-ai-tools.md).

| Tool | Backed By | Parameters |
|------|-----------|------------|
| `tronrelic-query-system-logs` | `getLogs()` | `levels` (default `["error","warn"]`), `service`, `startTime`/`endTime` (ISO 8601), `page`, `limit` (default 20, cap 50). List-view context truncated at 500 chars |
| `tronrelic-get-system-log` | `getLogById()` | `id` (required, 24-hex). Full untruncated context |
| `tronrelic-get-log-statistics` | `getStatistics()` | None. Total + per-level + per-service counts; doubles as `service` value discovery |

## Service Patterns

**Singleton access** — `SystemLogService.getInstance()` everywhere. Never instantiate directly.

**Child loggers** — `logger.child({ module: 'blockchain' })` merges bindings into every subsequent log call. Service name extracted from `pluginId`, `pluginTitle`, or `module` bindings. A child holds a reference to its parent and resolves readiness, the Pino instance, and the level on every call, so it is safe to create before `LogsModule.init()` — module constructors do exactly that. Never copy the parent's state into the child at creation: a copied "not initialized" flag never flips, and the child silently logs to the console only, never to MongoDB. The level is process-wide; setting it on a child forwards to the root, and every child picks up a root level change on its next call.

**Log level filtering** — `shouldLog(messageLevel, configuredLevel)` checks numeric thresholds before MongoDB write. Level changeable at runtime via `LogSettings` component, persists to SystemConfig.

**Metadata sanitization** — Removes circular references, functions, Error objects (extracts message+stack), truncates nesting depth. Prevents BSON serialization failures that would silently drop entries.

**Two-tier error fallback** — If `saveLog()` throws, attempts simplified record. If that throws, falls back to console. Logging must never crash the caller.

**Defensive argument parsing** — Pino calls `write()` with varying signatures. `saveLogFromArgs()` handles: string only, object only, object+string, object+string+interpolation args. Incorrect parsing here silently drops metadata.

## Frontend Notes

- `SystemLogsMonitor` is republished to plugins as `context.system.SystemLogsMonitor` (props `ISystemLogsMonitorProps`). With `service` set (e.g. `plugin:whale-alerts`), entries and stats are scoped server-side, the service selector and the Service column are hidden, and "Clear all" is removed because it deletes every service's logs
- Layout mirrors the curation History tab: no outer padding or surface (the embedding page supplies them); one toolbar (`LogLevelFilter` chips, service select, auto-refresh with a status dot, "Clear all"); the shared `Table` at `--table-font-size: body-sm`, one line per entry with the context's `error` text on a muted second line; a footer with the entry range, shared `Pagination`, and page size. Rows stack into cards under the `table` container at `$breakpoint-mobile-lg`
- Selecting a row opens `LogEntryDetail` in a `SlideOver`. The selected entry object is held, not its id, so an auto-refresh that pushes it off the page does not close the panel. The legacy `resolved` fields are not shown
- `SystemLogsMonitor` severity chips are remembered per operator: one shared preference (`LOG_MONITOR_LEVELS_SETTING` from `@/types`, namespace `logs`, key `monitorLevels`, default `['error']`) stored in the identity module's `'user-settings'` store, read and written through `/api/user/settings`. Every instance — `/system/logs` and every scoped Logs tab — reads the same value. The first log fetch waits for the preference to load; a toggle saves it in the background and shows a warning toast if the save fails. Without a Better Auth session (401) the viewer uses the default and saving fails with that toast
- `run()` registers the preference definition by watching `'user-settings'`, because the identity module publishes the store after this module's `run()`; registration failure is logged and swallowed
- Auto-refresh: Off, 1s, 10s (default), 30s, 60s
- New log detection compares IDs against previous fetch and flashes new rows with the global `.table-row--flash`
- Flash suppressed on initial load to avoid flood animation
- Flash history clears on filter/pagination change (`restartList`)
- `LogSettings` fetches SystemConfig on mount, PATCH to update, success toast, inline alert on failure. The level gates both file output and MongoDB persistence (`shouldLog` in every log method), so `silent` records nothing anywhere
- All state is local (no Redux)

## Config

Runtime log level stored in SystemConfig (`logLevel` field). Applied on startup via `applyLogLevelFromConfig()` and on-demand via `LogSettings`. Retention controlled by `systemLogsMaxCount` and `systemLogsRetentionDays` in SystemConfig, enforced by `cleanup()`.

## Further Reading

**System documentation:**
- [system-logging.md](../../../../docs/system/system-logging.md) — Logging architecture overview
- [modules.md](../../../../docs/system/modules/modules.md) — IModule interface, lifecycle, DI patterns
- [system-database.md](../../../../docs/system/system-database.md) — IDatabaseService abstraction
- [system-api.md](../../../../docs/system/system-api.md) — Admin API authentication and conventions
