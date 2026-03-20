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
| `LogsModule.ts` | IModule implementation, two-phase lifecycle, menu + route registration |
| `services/system-log.service.ts` | Singleton logger + MongoDB storage, sanitization, child loggers, stats |
| `database/SystemLog.ts` | Mongoose schema, compound indexes, `ISystemLogDocument` interface |
| `api/system-log.controller.ts` | Express handlers for all 6 endpoints |
| `api/system-log.router.ts` | Factory creates router, mounts under system admin routes |
| `../../lib/logger.ts` | Creates Pino instance, exports singleton for all backend imports |

### Frontend

| File | Purpose |
|------|---------|
| `modules/logs/components/SystemLogsMonitor/SystemLogsMonitor.tsx` | Live dashboard with polling, filtering, pagination, flash animations |
| `modules/logs/components/LogSettings/LogSettings.tsx` | Runtime log level control without restart |
| `modules/logs/api/client.ts` | Typed fetch wrappers for all log endpoints |
| `modules/logs/types/logs.types.ts` | `SystemLog`, `LogsResponse`, `LogStats` interfaces |

### Shared Types

| File | Purpose |
|------|---------|
| `types/system-log/ISystemLogService.d.ts` | Full service interface contract |
| `types/system-log/LogLevels.d.ts` | Level constants, `LogLevelName` type, `shouldLog()` helper |

## Storage

Single collection `system_logs` with Mongoose schema:

- `timestamp` (Date, indexed) — when log was created
- `level` (string, indexed) — trace/debug/info/warn/error/fatal
- `message` (string) — human-readable description
- `service` (string, indexed) — source identifier, plugin prefix format `plugin:whale-alerts`
- `context` (mixed) — sanitized metadata object
- `resolved` (boolean, indexed) — admin acknowledgment flag
- `resolvedAt`, `resolvedBy` — resolution metadata

Compound indexes: `{timestamp: -1, level: 1, resolved: 1}` for paginated filtering, `{service: 1, timestamp: -1}` for service-specific queries.

## Admin API Endpoints

All under `/api/admin/system/logs`, all require `X-Admin-Token` header.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Paginated logs with level/service/date/resolved filters |
| GET | `/stats` | Aggregate counts by level and service, unresolved count |
| GET | `/:id` | Single log entry (404 if missing) |
| PATCH | `/:id/resolve` | Mark as resolved with `resolvedBy` field |
| PATCH | `/:id/unresolve` | Revert resolution |
| DELETE | `/` | Bulk delete all logs (destructive) |

## Service Patterns

**Singleton access** — `SystemLogService.getInstance()` everywhere. Never instantiate directly.

**Child loggers** — `logger.child({ module: 'blockchain' })` merges bindings into every subsequent log call. Service name extracted from `pluginId`, `pluginTitle`, or `module` bindings.

**Log level filtering** — `shouldLog(messageLevel, configuredLevel)` checks numeric thresholds before MongoDB write. Level changeable at runtime via `LogSettings` component, persists to SystemConfig.

**Metadata sanitization** — Removes circular references, functions, Error objects (extracts message+stack), truncates nesting depth. Prevents BSON serialization failures that would silently drop entries.

**Two-tier error fallback** — If `saveLog()` throws, attempts simplified record. If that throws, falls back to console. Logging must never crash the caller.

**Defensive argument parsing** — Pino calls `write()` with varying signatures. `saveLogFromArgs()` handles: string only, object only, object+string, object+string+interpolation args. Incorrect parsing here silently drops metadata.

## Frontend Notes

- `SystemLogsMonitor` defaults to error-level filter, configurable via checkboxes
- Polling intervals: None, 1s, 10s, 30s, 60s via dropdown
- New log detection compares IDs against previous fetch, flashes new rows for 2s
- Flash suppressed on initial load to avoid flood animation
- Flash history clears on filter/pagination change
- Expandable rows show raw context JSON and resolution metadata
- `LogSettings` fetches SystemConfig on mount, PATCH to update, 3s auto-clear success message
- All state is local (no Redux)

## Config

Runtime log level stored in SystemConfig (`logLevel` field). Applied on startup via `applyLogLevelFromConfig()` and on-demand via `LogSettings`. Retention controlled by `systemLogsMaxCount` and `systemLogsRetentionDays` in SystemConfig, enforced by `cleanup()`.

## Further Reading

**System documentation:**
- [system-logging.md](../../../../docs/system/system-logging.md) — Logging architecture overview
- [system-modules.md](../../../../docs/system/system-modules.md) — IModule interface, lifecycle, DI patterns
- [system-database.md](../../../../docs/system/system-database.md) — IDatabaseService abstraction
- [system-api.md](../../../../docs/system/system-api.md) — Admin API authentication and conventions
