# System Overview, Health, and Config Endpoints

Consolidated health snapshot, per-subsystem health probes, and runtime configuration introspection. All endpoints require admin auth — see [system-api.md](./system-api.md#authentication).

## Why This Matters

`/overview` is one round trip for the dashboard or an alerting cron — cheaper than fanning out to six probes. The dedicated probes exist so on-call can isolate which dependency is degraded when overview goes red. `/config` reveals which integrations actually loaded (TronGrid keys, Telegram bot) without grepping container env.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/system/overview` | Consolidated snapshot — blockchain, transactions, scheduler, markets, db, redis, server |
| GET | `/admin/system/health/database` | MongoDB ping, pool size, db size |
| GET | `/admin/system/health/redis` | Redis ping, memory, key count, evictions |
| GET | `/admin/system/health/server` | Process uptime, heap, RSS, CPU% |
| GET | `/admin/system/config` | Effective env: feature flags, thresholds, limits, integration presence |

## Response Reference

### `GET /overview` — `overview` payload

| Field | Type | Notes |
|---|---|---|
| `blockchain.currentBlock` | number | Last processed |
| `blockchain.networkBlock` | number | Network tip |
| `blockchain.lag` | number | Blocks behind |
| `blockchain.isHealthy` | boolean | `lag < 100 && backfill < 240` |
| `transactions.totalIndexed` | number | All time |
| `transactions.indexedToday` | number | Since UTC midnight |
| `scheduler.enabled` | boolean | Global flag |
| `scheduler.uptime` | number | Seconds |
| `markets.stalePlatformCount` | number | Data >10 min old |
| `markets.averageDataAge` | number | Minutes |
| `database.connected` | boolean | |
| `database.responseTime` | number | ms |
| `redis.connected` | boolean | |
| `redis.keyCount` | number | |
| `server.uptime` | number | Seconds |
| `server.memoryUsage.heapUsed` | number | Bytes |
| `server.cpuUsage` | number | Percent |

```bash
curl -H "X-Admin-Token: $TOKEN" http://localhost:4000/api/admin/system/overview \
    | jq '.overview | {lag: .blockchain.lag, healthy: .blockchain.isHealthy,
                       stalePlatforms: .markets.stalePlatformCount,
                       dbConnected: .database.connected}'
```

### `GET /health/database` — `health` payload

| Field | Type | Notes |
|---|---|---|
| `connected` | boolean | |
| `responseTime` | number \| null | ms |
| `poolSize` | number | Connection pool |
| `databaseSize` | number \| null | Bytes |
| `collectionCount` | number | |
| `recentErrors` | array | Always empty currently |

### `GET /health/redis` — `health` payload

| Field | Type | Notes |
|---|---|---|
| `connected` | boolean | |
| `responseTime` | number \| null | ms |
| `memoryUsage` | number \| null | Bytes |
| `keyCount` | number | |
| `evictions` | number | Non-zero indicates memory pressure |

### `GET /health/server` — `health` payload

| Field | Type | Notes |
|---|---|---|
| `uptime` | number | Seconds |
| `memoryUsage.heapUsed` | number | Bytes |
| `memoryUsage.heapTotal` | number | Bytes |
| `memoryUsage.rss` | number | Bytes — total process memory |
| `cpuUsage` | number | Percent |

### `GET /config` — `config` payload

| Field | Type | Notes |
|---|---|---|
| `environment` | string | `development` or `production` |
| `port` | number | Backend port |
| `features.scheduler` | boolean | `ENABLE_SCHEDULER` |
| `features.websockets` | boolean | `ENABLE_WEBSOCKETS` |
| `thresholds.delegationAmountTRX` | number | Min sun for "large delegation" |
| `thresholds.stakeAmountTRX` | number | Min sun for "large stake" |
| `limits.commentsDailyLimit` | number | Per user per day |
| `limits.chatDailyLimit` | number | Per user per day |
| `integrations.hasTronGridKey` | boolean | Key present |
| `integrations.hasTelegramBot` | boolean | Bot configured |

```bash
curl -H "X-Admin-Token: $TOKEN" http://localhost:4000/api/admin/system/config \
    | jq '.config.integrations'
```

## Related

- [system-api.md](./system-api.md) — Auth, conventions, troubleshooting
- [system-dashboard.md](./system-dashboard.md) — UI consumer
- [environment.md](../environment.md) — Source of truth for thresholds and feature flags
