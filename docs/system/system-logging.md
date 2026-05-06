# System Logging

TronRelic's logging system wraps Pino with automatic MongoDB persistence so production errors don't vanish into rotating log files.

## Why This Matters

`ISystemLogService` is a Pino wrapper that mirrors every accepted log statement to both the file/console and the `system_logs` MongoDB collection. Operators query historical logs by severity, service, and time range without grepping containers or pulling rotated files. Plugin loggers carry their `pluginId` automatically, so cross-plugin filtering works without manual tagging.

## Persistence Model

There is **one threshold** — the configured log level — and it gates both file output and MongoDB persistence simultaneously. Every level method (`info`, `warn`, `error`, `fatal`, `debug`, `trace`) checks `shouldLog(level, this.level)` and, when allowed, both writes to Pino *and* fires `saveLogFromArgs(...)` asynchronously (non-blocking, via `void`). There is **no separate floor** like "ERROR/WARN always persist regardless of level."

| Level | Numeric | When persisted | Common use |
|---|---|---|---|
| `trace` | 10 | Only if `level <= trace` | Function entry/exit |
| `debug` | 20 | Only if `level <= debug` | Development diagnostics |
| `info` | 30 | Only if `level <= info` | Operational milestones |
| `warn` | 40 | Only if `level <= warn` | Recoverable issues |
| `error` | 50 | Only if `level <= error` | Failures requiring investigation |
| `fatal` | 60 | Always except when level is `silent` | Catastrophic |
| `silent` | ∞ | Never | Suppresses all output |

**Default production level:** `info` — info/warn/error/fatal all persist. Set `level = 'warn'` to drop info noise from the database; set to `debug` temporarily for deep diagnosis. The level is mutable at runtime:

```typescript
const logger = SystemLogService.getInstance();
logger.level = 'warn'; // Subsequent info logs no longer persist or print
```

## Structured Logging

Always pass an object first so MongoDB stores searchable context fields:

```typescript
// Good — { error, txId } become queryable fields
logger.error({ error: err.message, stack: err.stack, txId }, 'Transaction failed');

// Bad — string concatenation loses structure
logger.error(`Transaction failed for ${txId}: ${err.message}`);
```

Project-specific metadata patterns:

- **Errors:** `{ error: err.message, stack: err.stack, code: err.code }`
- **Blockchain events:** `{ blockNumber, txHash, contractType }`
- **Plugin operations:** `{ pluginId, observerName, txCount }` (the first two get added automatically by plugin/observer scoped loggers — don't duplicate)

## Plugin Logger Scoping

Plugins receive a pre-scoped logger via `IPluginContext.logger`. The service field is automatically set to `plugin:<pluginId>` (see `system-log.service.ts:627-630`), and the bindings include `pluginId` and `pluginTitle`:

```typescript
init: async (context: IPluginContext) => {
    context.logger.info('Plugin initialized');
    // Persisted as: { service: 'plugin:my-plugin', context: { pluginId: 'my-plugin', pluginTitle: 'My Plugin', ... } }
}
```

`child(bindings)` returns a `SystemLogService` (not a bare `pino.Logger`) so the persistence path is preserved:

```typescript
const observerLogger = context.logger.child({ observerName: 'WhaleObserver' });
observerLogger.info({ blockNumber: 12345 }, 'Processing block');
// Context merged: { pluginId, pluginTitle, observerName, blockNumber }
```

Backend services in core follow the same pattern via `SystemLogService.getInstance().child({ service: 'my-service' })`.

For high-volume observer loops: log once per block, not per transaction. A 200-tx block with `logger.debug({txId}, ...)` per tx at debug level produces 200 file writes *and* 200 Mongo writes per block — at 20 blocks/min that's 4000 records/min just for one observer.

## Accessing Historical Logs

| Channel | Use case |
|---|---|
| `/system/logs` admin page | Day-to-day operator triage; filter by severity/service/time, mark resolved |
| Admin API | Programmatic / dashboard ingestion — see [system-api-logs.md](./system-api-logs.md) for endpoints, query params, response shape, and the 30-second stats cache |
| MongoDB direct | Bulk analysis: `db.system_logs.find({...})`, `db.system_logs.aggregate([...])` |

Direct-query example (errors from one plugin in last 24 hours):

```javascript
db.system_logs.find({
    level: 'error',
    service: 'plugin:whale-alerts',
    timestamp: { $gte: new Date(Date.now() - 86400000) }
}).sort({ timestamp: -1 });
```

Indexes on `level`, `service`, `timestamp`, and `resolved` keep these queries fast — also the `byLevel` and `byService` aggregations behind `/logs/stats` (cached 30s; see [system-api-logs.md](./system-api-logs.md)).

## Retention and Cleanup

Default retention is **30 days** *and* a hard cap of **100,000** entries (whichever bound is hit first). Both are stored in `SystemConfig` (Mongo) and editable at runtime. The `system-logs:cleanup` scheduler job runs at minute 0 of every hour:

1. Deletes logs with `timestamp < now - retentionDays`.
2. If total count still exceeds `maxCount`, drops oldest until under the limit.
3. Reports deletion counts in scheduler logs.

```typescript
const config = SystemConfigService.getInstance();
await config.updateConfig({
    systemLogsRetentionDays: 90,
    systemLogsMaxCount: 500_000
});
```

Or edit via the System Config section at `/system/system` (PATCH `/admin/system/config/system` accepts both fields — see [system-api-overview.md](./system-api-overview.md#patch-configsystem)).

## Configuration

| Setting | Default | Notes |
|---|---|---|
| `logLevel` | `info` | Mutable at runtime via `logger.level = ...` or PATCH `/config/system` |
| `systemLogsRetentionDays` | `30` | Hourly cleanup job |
| `systemLogsMaxCount` | `100000` | Drops oldest beyond this cap |

## Troubleshooting

**Logs not appearing in MongoDB.** Most likely the configured level excludes them — `info` logs vanish at `level: 'warn'`. Also confirm `SystemLogService.initialize(pinoLogger)` ran after the database connection (the persistence path checks `this.initialized`); a logger used before init only writes to console.

**High database storage.** Raise `level` to `warn`, lower `systemLogsRetentionDays`, or lower `systemLogsMaxCount`. Identify noisy services via `/logs/stats` (`byService`); often one observer logging per-tx is the culprit.

**Missing plugin logs.** The plugin must use `context.logger`, not a separately-instantiated Pino. Disabled plugins don't log. Verify the plugin's `service` value (`plugin:<pluginId>`) appears in the `/system/logs` filter dropdown.

## Further Reading

- [system-api-logs.md](./system-api-logs.md) — Endpoint reference, query parameters, stats cache
- [plugins-system-architecture.md](../plugins/plugins-system-architecture.md) — `IPluginContext.logger` injection and lifecycle
- [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) — Observer logging patterns and high-volume guidance
- Source: `src/backend/modules/logs/services/system-log.service.ts`
