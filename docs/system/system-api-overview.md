# Health and Config Endpoints

Per-subsystem health probes and runtime configuration introspection. All endpoints require admin auth — see [system-api.md](./system-api.md#authentication).

## Why This Matters

There is no aggregating "overview" endpoint. The `/system` dashboard fans out to dedicated probes (`/health/database`, `/health/redis`, `/health/server`, `/health/clickhouse`) and joins results client-side, so on-call can isolate exactly which dependency is degraded — a single endpoint would mask which one timed out. `/config` reveals which integrations actually loaded (TronGrid keys, object storage) without grepping container env, and `/config/system` is the runtime-editable sibling backing the System Config section.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/system/health/database` | MongoDB ping, pool, db size, collection count |
| GET | `/admin/system/health/clickhouse` | ClickHouse ping, table count, db size (if initialized) |
| GET | `/admin/system/health/redis` | Redis ping, memory, key count, evictions |
| GET | `/admin/system/health/server` | Process uptime, heap, RSS, CPU, external memory |
| GET | `/admin/system/config` | Effective env: features, integration presence |
| GET | `/admin/system/config/system` | Runtime-editable system config (Mongo-backed) |
| PATCH | `/admin/system/config/system` | Update `siteUrl`, `logLevel`, log retention settings |

## Response Reference

### `GET /health/database` — `health` payload

| Field | Type | Notes |
|---|---|---|
| `connected` | boolean | `mongoose.connection.readyState === 1` |
| `responseTime` | number \| null | ms; `null` on ping timeout (>2000ms) |
| `poolSize` | number | Mongoose default (10) |
| `availableConnections` | number | Currently equals `poolSize` (simplified) |
| `databaseSize` | number \| null | Bytes from `db.stats().dataSize` |
| `collectionCount` | number | From `db.stats().collections` |
| `recentErrors` | array | Always empty; reserved for future use |

### `GET /health/clickhouse` — `health` payload

If ClickHouse is not initialized, returns `{ connected: false, responseTime: null, tableCount: 0, databaseSize: null }` rather than 503.

| Field | Type | Notes |
|---|---|---|
| `connected` | boolean | |
| `responseTime` | number \| null | ms from ping; `null` on 2000ms timeout |
| `tableCount` | number | Tables in `currentDatabase()` |
| `databaseSize` | number \| null | Bytes (sum of `system.tables.total_bytes`) |

### `GET /health/redis` — `health` payload

| Field | Type | Notes |
|---|---|---|
| `connected` | boolean | `redis.status === 'ready'` |
| `responseTime` | number \| null | ms |
| `memoryUsage` | number \| null | Bytes; parsed from `INFO memory` |
| `keyCount` | number | `DBSIZE` |
| `evictions` | number | Non-zero indicates memory pressure |
| `hitRate` | null | Reserved; always `null` (would need tracking) |

### `GET /health/server` — `health` payload

| Field | Type | Notes |
|---|---|---|
| `uptime` | number | Seconds (`process.uptime()`) |
| `memoryUsage.heapUsed` | number | Bytes |
| `memoryUsage.heapTotal` | number | Bytes |
| `memoryUsage.rss` | number | Bytes — total process memory |
| `memoryUsage.external` | number | Bytes — V8 external allocations |
| `cpuUsage` | number | Percent across all cores |
| `activeConnections` | number | Always 0 (reserved) |
| `requestRate` | null | Reserved |
| `errorRate` | null | Reserved |

### `GET /config` — `config` payload

Effective environment, not editable. Source: `env.ts`.

| Field | Type | Notes |
|---|---|---|
| `environment` | string | `env.ENV` (e.g., `development`, `production`) |
| `port` | number | Backend listen port |
| `features.scheduler` | boolean | `ENABLE_SCHEDULER` |
| `features.websockets` | boolean | `ENABLE_WEBSOCKETS` |
| `features.telemetry` | boolean | `ENABLE_TELEMETRY` |
| `limits` | object | Currently empty `{}`; reserved |
| `integrations.hasTronGridKey` | boolean | `TRONGRID_API_KEY` present |
| `integrations.hasStorageConfigured` | boolean | Both `STORAGE_BUCKET` and `STORAGE_ACCESS_KEY_ID` set |

### `GET /config/system` — `config` payload

Runtime-editable settings stored in MongoDB `system_config` (single document, `key: "system"`). Source: `SystemConfigService.getConfig()`.

| Field | Type | Notes |
|---|---|---|
| `key` | string | Always `"system"` |
| `siteUrl` | string | Public site URL; default `http://localhost:3000` |
| `siteWs` | string | WebSocket URL; default `http://localhost:4000` |
| `systemLogsMaxCount` | number | Default 1,000,000 |
| `systemLogsRetentionDays` | number | Default 30 |
| `logLevel` | string | One of `trace\|debug\|info\|warn\|error\|fatal\|silent` |
| `updatedAt` | Date | Last change timestamp |
| `updatedBy` | string \| null | Admin identifier (audit) |

### `PATCH /config/system`

Partial body, all fields optional:

```json
{
    "siteUrl": "https://tronrelic.com",
    "logLevel": "info",
    "systemLogsMaxCount": 1000000,
    "systemLogsRetentionDays": 30
}
```

`siteUrl` is parsed through `new URL(...)`; invalid input returns 400 with `error: "Invalid URL format. Must include protocol (http:// or https://)"`. The PATCH does **not** accept `siteWs` directly — it is derived from `siteUrl` server-side. Updates invalidate the in-memory cache and persist immediately; the SSR cache on the frontend container only refreshes after a frontend restart (see [system-runtime-config.md](./system-runtime-config.md#runtime-reconfiguration)).

```bash
curl -X PATCH \
    -H "X-Admin-Token: $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"logLevel": "debug"}' \
    http://localhost:4000/api/admin/system/config/system
```

## Further Reading

- [system-api.md](./system-api.md) — Auth, conventions, troubleshooting
- [system-runtime-config.md](./system-runtime-config.md) — How `siteUrl` flows from `system_config` to the browser
- [system-dashboard.md](./system-dashboard.md) — UI consumer of these probes
- [environment.md](../environment.md) — Source of truth for env feature flags
