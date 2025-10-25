# System Logging

TronRelic's logging system wraps Pino with automatic MongoDB persistence for operational visibility and troubleshooting.

## Who This Document Is For

Backend developers and plugin authors who need to understand logging best practices, configure log levels, or access historical error data for debugging production issues.

## Why This Matters

Production errors vanish when they only go to rotating log files. Without centralized error tracking, you cannot:

- **Diagnose intermittent failures** - Logs rotate away before you notice the pattern
- **Track error trends** - No visibility into which services generate the most warnings
- **Audit resolution** - No record of which errors were acknowledged and when
- **Filter by context** - Cannot query logs by plugin, severity, or time range

TronRelic's `ISystemLogService` solves this by automatically persisting logs to MongoDB based on configured severity thresholds. You get structured logging with searchable history, retention policies, and admin UI visibility—all without changing how you write log statements.

## Core Concept

`ISystemLogService` is a Pino wrapper that saves logs to MongoDB when they meet the configured severity threshold. Every log statement flows through this sequence:

1. **Severity check** - Is the log level enabled? (e.g., if level is `info`, skip `debug` logs)
2. **MongoDB persistence** - Save to database asynchronously (non-blocking)
3. **Pino delegation** - Write to console/file as usual

The key differentiator: **ERROR, WARN, and higher levels persist to MongoDB automatically**. INFO, DEBUG, and TRACE only go to files unless you change the log level configuration.

## Log Levels and Persistence

TronRelic uses standard Pino log levels with automatic persistence based on the configured threshold:

| Level | Numeric Priority | Persisted to MongoDB? | Common Use Case |
|-------|-----------------|----------------------|-----------------|
| `trace` | 10 | Only if level ≤ trace | Deep debugging (function entry/exit) |
| `debug` | 20 | Only if level ≤ debug | Development diagnostics |
| `info` | 30 | Only if level ≤ info | Operational milestones (server started, job completed) |
| `warn` | 40 | Only if level ≤ warn | Recoverable issues (retry attempts, fallback behavior) |
| `error` | 50 | Only if level ≤ error | Failures requiring investigation |
| `fatal` | 60 | Always | Catastrophic errors (process crash imminent) |
| `silent` | ∞ | Never | Suppresses all output |

**Default production level:** `info` (INFO, WARN, ERROR, FATAL all persist to MongoDB)

**Common adjustments:**
- Set to `warn` to reduce database writes and focus on problems
- Set to `debug` temporarily when troubleshooting specific issues
- Set to `trace` only for deep debugging (high volume, short durations)

**Change log level at runtime:**
```typescript
import { SystemLogService } from '@/services/system-log/system-log.service.js';

const logger = SystemLogService.getInstance();
logger.level = 'warn'; // Only warn/error/fatal persist to MongoDB now
```

## Structured Logging Best Practices

Always use object-first logging to provide searchable context:

**Good - Structured with context:**
```typescript
logger.error({
    userId: '123',
    transactionId: 'abc',
    error: err.message
}, 'Transaction processing failed');
```

**Bad - String concatenation:**
```typescript
logger.error(`Transaction processing failed for user 123: ${err.message}`);
```

**Why:** Structured logs store `userId` and `transactionId` as queryable fields in MongoDB's `context` object. String concatenation loses this structure.

**Common metadata patterns:**
- **Errors:** `{ error: err.message, stack: err.stack, code: err.code }`
- **API requests:** `{ method: 'GET', path: '/api/markets', userId: 123 }`
- **Blockchain events:** `{ blockNumber: 12345, txHash: '0xabc...', contractType: 'TransferContract' }`
- **Plugin operations:** `{ pluginId: 'whale-alerts', observerName: 'WhaleObserver', txCount: 50 }`

## Plugin Logger Scoping

Plugins receive pre-scoped loggers via `IPluginContext` that automatically include plugin metadata in every log statement:

```typescript
export const myPluginBackend = definePlugin({
    manifest: myManifest,

    init: async (context: IPluginContext) => {
        // Logger is already scoped with { pluginId: 'my-plugin', pluginTitle: 'My Plugin' }
        context.logger.info('Plugin initialized');
        // Saved as: { level: 'info', message: 'Plugin initialized', service: 'plugin:my-plugin', context: { pluginId: 'my-plugin', pluginTitle: 'My Plugin' } }

        context.logger.warn({ retryCount: 3 }, 'API request failed, retrying');
        // Saved with merged metadata: { pluginId: 'my-plugin', pluginTitle: 'My Plugin', retryCount: 3 }
    }
});
```

**No manual plugin identification required.** The logger knows it belongs to your plugin and prefixes the `service` field with `plugin:` for easy filtering.

**Creating child loggers for additional context:**
```typescript
const observerLogger = context.logger.child({ observerName: 'WhaleObserver' });
observerLogger.info('Processing block 12345');
// Context now includes: { pluginId: 'my-plugin', observerName: 'WhaleObserver' }
```

## Accessing Historical Logs

### System Logs Monitor UI

Navigate to `/system/logs` (requires admin token) for web-based log access:

- **Filter by severity** - Checkboxes for ERROR, WARN, INFO, DEBUG, TRACE
- **Filter by service/plugin** - Dropdown to isolate specific components
- **Time range selection** - View logs from last hour, day, week, or custom range
- **Live polling** - Auto-refreshes every 10 seconds for real-time monitoring
- **Resolve/unresolve** - Mark errors as acknowledged without deleting them
- **Statistics cards** - See total counts by severity and service

### Admin API Endpoint

For programmatic access or custom dashboards, use the logs API:

**See [system-api.md](./system-api.md#get-apiadminsystemlogs) for complete endpoint documentation including:**
- Query parameters (levels, service, resolved, date range, pagination)
- Response structure (logs array, pagination metadata, statistics)
- Request/response examples with curl and JavaScript

**Quick example:**
```bash
curl -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  "http://localhost:4000/api/admin/system/logs?levels=error,warn&page=1&limit=50"
```

### MongoDB Direct Access

For advanced queries or bulk analysis, query the `system_logs` collection directly:

```bash
docker exec -it tronrelic-mongo mongosh tronrelic
```

```javascript
// Find all errors from whale-alerts plugin in last 24 hours
db.system_logs.find({
    level: 'error',
    service: 'plugin:whale-alerts',
    timestamp: { $gte: new Date(Date.now() - 86400000) }
}).sort({ timestamp: -1 });

// Count warnings by service
db.system_logs.aggregate([
    { $match: { level: 'warn' } },
    { $group: { _id: '$service', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
]);
```

## Retention and Cleanup

The scheduler runs hourly cleanup to enforce retention policies configured in SystemConfig:

**Default retention settings:**
- `systemLogsRetentionDays: 30` - Delete logs older than 30 days
- `systemLogsMaxCount: 100000` - Keep only 100,000 most recent logs

**How cleanup works:**
1. Deletes logs with `timestamp < (now - retentionDays)`
2. If total log count exceeds `maxCount`, deletes oldest logs until under limit
3. Reports deletion count in scheduler logs

**Adjust retention via System Config:**
```typescript
import { SystemConfigService } from '@/services/system-config/system-config.service.js';

const config = SystemConfigService.getInstance();
await config.updateConfig({
    systemLogsRetentionDays: 90, // Keep logs for 90 days
    systemLogsMaxCount: 500000   // Allow up to 500k log entries
});
```

**Scheduler job:** `system-logs:cleanup` runs at minute 0 of every hour (`:00`)

## Performance Considerations

**INFO/DEBUG/TRACE are cheap:**
- Only written to files (no MongoDB overhead)
- Pino is extremely fast at file logging (async by design)
- Use liberally for development visibility

**WARN/ERROR have storage cost:**
- MongoDB write happens asynchronously (non-blocking)
- Each log entry consumes database storage (cleaned up by retention policy)
- Indexes on `level`, `service`, `timestamp` keep queries fast
- Avoid error logging in tight loops (e.g., per-transaction in high-volume observers)

**When to avoid logging at high frequency:**
```typescript
// Bad - logs 1000s of times per block
transactions.forEach(tx => {
    logger.debug({ txId: tx.id }, 'Processing transaction'); // Creates massive log volume
});

// Good - log summary after batch
logger.debug({ txCount: transactions.length, blockNumber }, 'Processed block transactions');
```

## Integration Points

### Plugin Context Injection

Plugins receive scoped loggers automatically—no imports required:

**See [plugins-system-architecture.md](../plugins/plugins-system-architecture.md) for complete details on:**
- Plugin lifecycle hooks and dependency injection
- How `IPluginContext.logger` is scoped with plugin metadata
- Creating child loggers for additional context

### Blockchain Observers

Observers receive loggers in constructors for consistent scoping:

**See [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) for complete details on:**
- Observer pattern architecture
- Constructor logger injection
- Logging best practices for high-volume transaction processing (ERROR and WARN logs are automatically persisted to MongoDB, so avoid logging errors in tight loops)

### System Services

All backend services use the singleton `SystemLogService` instance:

```typescript
import { SystemLogService } from '@/services/system-log/system-log.service.js';

const logger = SystemLogService.getInstance();

export class MyService {
    private logger = logger.child({ service: 'my-service' });

    async doWork() {
        this.logger.info('Starting work');
        try {
            await this.performTask();
        } catch (err) {
            this.logger.error({ error: err.message, stack: err.stack }, 'Task failed');
            throw err;
        }
    }
}
```

## Quick Reference

### Common Logging Patterns

```typescript
// Info - operational milestones
logger.info({ blockNumber: 12345 }, 'Block processed successfully');

// Warn - recoverable issues
logger.warn({ retryCount: 3, maxRetries: 5 }, 'API request failed, will retry');

// Error - failures requiring investigation
logger.error({ error: err.message, stack: err.stack, txId: '0xabc' }, 'Transaction processing failed');

// Debug - development diagnostics
logger.debug({ cacheHit: true, key: 'market:price' }, 'Cache lookup result');

// Trace - deep debugging
logger.trace({ fnName: 'processBlock', args: [12345] }, 'Function entry');
```

### Severity Decision Matrix

| Situation | Level | Rationale |
|-----------|-------|-----------|
| Server started | INFO | Operational milestone |
| API request completed | DEBUG | High frequency, low value in production |
| Cache miss | DEBUG | Expected behavior, only useful during debugging |
| Retry attempt (temporary) | WARN | Indicates transient issue, may need investigation if frequent |
| API rate limit hit | WARN | Operational concern, may need config adjustment |
| Database query failed | ERROR | Data unavailable, requires investigation |
| Plugin initialization failed | ERROR | Feature unavailable, requires code fix |
| Process crash imminent | FATAL | Critical failure, immediate attention required |

### Accessing Logs

| Method | Use Case | How to Access |
|--------|----------|---------------|
| **Live console** | Local development | `tail -f .run/backend.log` |
| **Web UI** | Troubleshooting production | `/system/logs` (requires admin token) |
| **API** | Custom dashboards | `GET /api/admin/system/logs` |
| **MongoDB direct** | Bulk analysis | `docker exec -it tronrelic-mongo mongosh tronrelic` |

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `logLevel` | `info` | Minimum severity to persist (trace/debug/info/warn/error/fatal/silent) |
| `systemLogsRetentionDays` | `30` | Delete logs older than N days |
| `systemLogsMaxCount` | `100000` | Maximum total log entries (oldest deleted first) |

Change via System Config API or `/system/config` admin UI.

## Troubleshooting

**Logs not appearing in MongoDB:**
- Check log level: `logger.level` must permit the severity (e.g., if level is `warn`, info logs won't persist)
- Verify initialization: `SystemLogService.initialize(pinoLogger)` must be called after database connection
- Check retention: Logs may have been cleaned up by scheduler if older than retention period

**High database storage usage:**
- Lower log level to `warn` to reduce volume
- Decrease retention period: `systemLogsRetentionDays: 7`
- Decrease max count: `systemLogsMaxCount: 50000`
- Identify noisy services via statistics API and reduce logging frequency in those components

**Missing plugin logs:**
- Ensure plugin uses injected logger from `IPluginContext`, not a separate Pino instance
- Check that plugin is enabled (disabled plugins don't log)
- Verify plugin's service name appears in filters dropdown at `/system/logs`

## Further Reading

**Related documentation:**
- [system-api.md](./system-api.md) - Complete API reference for logs endpoint
- [plugins-system-architecture.md](../plugins/plugins-system-architecture.md) - Plugin context and logger injection
- [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) - Observer logging patterns
- [system-monitoring-dashboard.md](./system-monitoring-dashboard.md) - Web UI for log access
