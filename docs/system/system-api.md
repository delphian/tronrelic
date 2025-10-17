# System APIs and Real-Time Events

TronRelic exposes HTTP APIs and WebSocket events for monitoring system health, controlling operations, and subscribing to real-time blockchain data. These endpoints power the System Monitoring Dashboard and enable custom automation workflows.

## Why This Matters

System APIs solve operational problems that would otherwise require manual intervention:

- **Automated health monitoring** - Poll endpoints from external monitoring tools (Datadog, Nagios) to detect issues before users report them
- **Emergency controls** - Trigger blockchain sync or market refresh without deploying code or restarting services
- **Runtime configuration** - Adjust scheduler jobs, thresholds, and feature flags without backend restarts
- **Custom integrations** - Build alerting bots, dashboards, or scripts that react to system state
- **Real-time data feeds** - Subscribe to whale transactions, market updates, or blockchain events via WebSocket for live UI updates or external notifications

Without these APIs, operators would need to SSH into servers, restart processes, modify environment variables, and manually inspect logs to understand system state.

## Getting Started

### Authentication

Most admin endpoints require authentication via the `ADMIN_API_TOKEN` configured in backend `.env`:

```bash
# Generate a secure token
openssl rand -hex 32

# Add to backend/.env
ADMIN_API_TOKEN=your-secure-token-here
```

**Sending the token:**

```bash
# Recommended: Custom header
curl -H "X-Admin-Token: your-token" http://localhost:4000/api/admin/system/overview

# Alternative: Bearer token
curl -H "Authorization: Bearer your-token" http://localhost:4000/api/admin/system/overview
```

**Security note:** Query parameter authentication (`?token=...`) is intentionally not supported to prevent tokens from appearing in server access logs.

### Common Response Format

All endpoints return JSON with consistent structure:

**Success:**
```json
{
    "success": true,
    "data-key": { ... }
}
```

**Error:**
```json
{
    "success": false,
    "error": "Description of what went wrong"
}
```

### Base URLs

- **Development:** `http://localhost:4000/api`
- **Production:** `https://your-domain.com/api`

## Monitoring Workflows

### Quick System Health Check

**Use case:** Poll all system metrics in one request for health monitoring dashboards or alerting scripts.

**Endpoint:** `GET /admin/system/overview`

**Example:**

```bash
curl -H "X-Admin-Token: $TOKEN" http://localhost:4000/api/admin/system/overview
```

**Response includes:**
- Blockchain sync status (lag, processing rate, health indicator)
- Transaction statistics (total indexed, today's count)
- Scheduler health (enabled, uptime, success rate)
- Market data freshness (stale platforms, average age)
- Database connection (status, response time, size)
- Redis connection (status, memory usage, evictions)
- Server metrics (uptime, memory, CPU)

See [Complete API Reference](#get-adminSystemOverview) for full response structure.

### Monitoring Blockchain Sync Progress

**Use case:** Track whether blockchain sync is keeping up with the network, detect lag, and identify processing bottlenecks.

**Key endpoints:**
- `GET /admin/system/blockchain/status` - Current vs. network block height, lag, backfill queue
- `GET /admin/system/blockchain/metrics` - Processing rate, success rate, recent errors
- `GET /admin/system/blockchain/transactions` - Total indexed, daily count, type breakdown

**Example workflow:**

```bash
# Check sync status
STATUS=$(curl -s -H "X-Admin-Token: $TOKEN" \
    http://localhost:4000/api/admin/system/blockchain/status)

# Extract lag value
LAG=$(echo $STATUS | jq '.status.lag')

# Alert if lag exceeds threshold
if [ $LAG -gt 100 ]; then
    echo "ALERT: Blockchain sync is $LAG blocks behind"
    # Send notification...
fi
```

See [Blockchain Monitoring Reference](#blockchain-monitoring) for complete endpoint documentation.

### Checking Market Data Quality

**Use case:** Verify energy rental market pricing is fresh, identify stale or failing platforms, and ensure leaderboard displays accurate data.

**Key endpoints:**
- `GET /admin/system/markets/platforms` - All platforms with status, reliability, consecutive failures
- `GET /admin/system/markets/freshness` - Oldest data age, stale platform count, platforms with old data

**Example workflow:**

```bash
# Get freshness metrics
FRESHNESS=$(curl -s -H "X-Admin-Token: $TOKEN" \
    http://localhost:4000/api/admin/system/markets/freshness)

# Check oldest data age (in minutes)
OLDEST=$(echo $FRESHNESS | jq '.freshness.oldestDataAge')

# Alert if data is stale (>60 minutes)
if (( $(echo "$OLDEST > 60" | bc -l) )); then
    echo "WARNING: Market data is stale (${OLDEST} minutes old)"
fi
```

See [Market Monitoring Reference](#market-monitoring) for complete endpoint documentation.

### Monitoring Scheduler Job Health

**Use case:** Verify scheduled jobs (blockchain sync, market refresh, cache cleanup) are running on schedule and succeeding.

**Key endpoints:**
- `GET /admin/system/scheduler/status` - All jobs with last/next run times, status, duration, errors
- `GET /admin/system/scheduler/health` - Global health (enabled, uptime, success rate, overdue jobs)

**Example workflow:**

```javascript
const response = await fetch('http://localhost:4000/api/admin/system/scheduler/status', {
    headers: { 'X-Admin-Token': process.env.ADMIN_API_TOKEN }
});
const { jobs } = await response.json();

// Check for failed jobs
const failed = jobs.filter(job => job.status === 'failed');
if (failed.length > 0) {
    console.error('Failed jobs:', failed.map(j => `${j.name}: ${j.error}`));
    // Send alert...
}
```

See [Scheduler Operations Reference](#scheduler-operations) for complete endpoint documentation.

## Controlling System Behavior

### Triggering Manual Data Refreshes

**Use case:** Force immediate blockchain sync or market refresh without waiting for scheduled execution, useful after detecting stale data or recovering from outages.

**Blockchain sync:**

```bash
curl -X POST -H "X-Admin-Token: $TOKEN" \
    http://localhost:4000/api/admin/system/blockchain/sync
```

**Market refresh (normal):**

```bash
curl -X POST -H "X-Admin-Token: $TOKEN" \
    http://localhost:4000/api/admin/system/markets/refresh
```

**Market refresh (force, bypass cache):**

```bash
curl -X POST \
    -H "X-Admin-Token: $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"force": true}' \
    http://localhost:4000/api/admin/system/markets/refresh
```

Both operations are async (fire-and-forget). Monitor status via polling or WebSocket events to verify completion.

### Controlling Scheduler Jobs at Runtime

**Use case:** Enable, disable, or modify scheduler jobs without restarting the backend, useful for maintenance windows or adjusting refresh frequencies.

**Enable a job:**

```bash
curl -X PATCH \
    -H "X-Admin-Token: $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"enabled": true}' \
    http://localhost:4000/api/admin/system/scheduler/job/markets:refresh
```

**Disable a job temporarily:**

```bash
curl -X PATCH \
    -H "X-Admin-Token: $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"enabled": false}' \
    http://localhost:4000/api/admin/system/scheduler/job/blockchain:sync
```

**Change job schedule (every 10 minutes instead of 5):**

```bash
curl -X PATCH \
    -H "X-Admin-Token: $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"schedule": "*/10 * * * *"}' \
    http://localhost:4000/api/admin/system/scheduler/job/markets:refresh
```

Changes persist to MongoDB and survive backend restarts. See [system-scheduler-operations.md](./system-scheduler-operations.md) for detailed job control documentation.

## Real-Time Event Subscriptions

### Subscribing to WebSocket Events

**Use case:** Build live dashboards, alerting bots, or real-time analytics by subscribing to blockchain events, market updates, and system status changes.

**Connect to WebSocket server:**

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:4000', {
    transports: ['websocket']
});

socket.on('connect', () => {
    console.log('Connected to TronRelic WebSocket');
});
```

**Subscribe to whale transactions:**

```javascript
socket.emit('subscribe', {
    transactions: { minAmount: 1000000 }  // >1M TRX
});

socket.on('transaction:large', (tx) => {
    console.log(`Whale alert: ${tx.amountTRX.toLocaleString()} TRX ($${tx.amountUSD.toLocaleString()})`);
    // Send notification...
});
```

**Subscribe to market updates:**

```javascript
socket.emit('subscribe', {
    markets: { all: true }
});

socket.on('market:update', (market) => {
    console.log(`${market.name} updated: ${market.pricing['1d']} sun/energy`);
});
```

**Multiple subscriptions:**

```javascript
socket.emit('subscribe', {
    markets: { all: true },
    transactions: { minAmount: 1000000 },
    chat: true
});

socket.on('market:update', handleMarketUpdate);
socket.on('transaction:large', handleWhaleTransaction);
socket.on('chat:update', handleChatMessage);
```

See [Real-Time Events Reference](#websocket-events-reference) for complete event documentation.

---

## Complete API Reference

### System Overview

#### GET /admin/system/overview

Consolidated snapshot of all system metrics in a single request.

**Authentication:** Admin token required

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `blockchain.currentBlock` | number | Last processed block number |
| `blockchain.networkBlock` | number | Current network height |
| `blockchain.lag` | number | Blocks behind network |
| `blockchain.isHealthy` | boolean | `true` if lag <100 and backfill <240 |
| `transactions.totalIndexed` | number | Total transactions in database |
| `transactions.indexedToday` | number | Transactions since midnight UTC |
| `scheduler.enabled` | boolean | Whether scheduler is globally enabled |
| `scheduler.uptime` | number | Scheduler uptime in seconds |
| `markets.stalePlatformCount` | number | Platforms with data >10 min old |
| `markets.averageDataAge` | number | Average age in minutes |
| `database.connected` | boolean | MongoDB connection status |
| `database.responseTime` | number | Ping time in milliseconds |
| `redis.connected` | boolean | Redis connection status |
| `redis.keyCount` | number | Total keys in Redis |
| `server.uptime` | number | Server uptime in seconds |
| `server.memoryUsage.heapUsed` | number | Used heap in bytes |
| `server.cpuUsage` | number | CPU usage percentage |

**Example:**

```bash
curl -H "X-Admin-Token: $TOKEN" http://localhost:4000/api/admin/system/overview \
    | jq '.overview | {
        lag: .blockchain.lag,
        healthy: .blockchain.isHealthy,
        stalePlatforms: .markets.stalePlatformCount,
        dbConnected: .database.connected
    }'
```

### Blockchain Monitoring

#### GET /admin/system/blockchain/status

Current blockchain sync status including lag, backfill queue, and health indicators.

**Authentication:** Admin token required

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `currentBlock` | number | Last processed block |
| `networkBlock` | number | Current network height |
| `lag` | number | Blocks behind |
| `backfillQueueSize` | number | Failed blocks awaiting retry |
| `lastProcessedAt` | string (ISO) | Timestamp of last processed block |
| `isHealthy` | boolean | `true` if lag <100 and backfill <240 |
| `estimatedCatchUpTime` | number \| null | Minutes until caught up |
| `processingBlocksPerMinute` | number | Processing throughput |
| `networkBlocksPerMinute` | number | Network production rate (~20) |
| `netCatchUpRate` | number | Processing rate minus network rate |

**Example:**

```bash
curl -H "X-Admin-Token: $TOKEN" http://localhost:4000/api/admin/system/blockchain/status
```

#### GET /admin/system/blockchain/transactions

Transaction indexing statistics.

**Authentication:** Admin token required

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `totalIndexed` | number | Total transactions in database |
| `indexedToday` | number | Transactions since midnight UTC |
| `byType` | object | Count by transaction type (currently empty) |

#### GET /admin/system/blockchain/metrics

Block processing performance metrics.

**Authentication:** Admin token required

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `averageBlockProcessingTime` | number | Average seconds per block |
| `blocksPerMinute` | number | Processing throughput |
| `successRate` | number | Percentage of successful blocks |
| `recentErrors` | array | Recent errors with block number, timestamp, message |
| `averageProcessingDelaySeconds` | number | Delay between block creation and processing |
| `projectedCatchUpMinutes` | number \| null | Estimated catch-up time |

#### POST /admin/system/blockchain/sync

Manually trigger blockchain sync job (async, fire-and-forget).

**Authentication:** Admin token required

**Request body:** None

**Response:**

```json
{
    "success": true,
    "message": "Blockchain sync triggered"
}
```

### Scheduler Operations

#### GET /admin/system/scheduler/status

Status of all scheduled jobs with last/next run times and execution details.

**Authentication:** Admin token required

**Response fields (per job):**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Job identifier (e.g., `markets:refresh`) |
| `schedule` | string | Cron expression |
| `enabled` | boolean | Whether job is enabled |
| `lastRun` | string (ISO) | Last execution timestamp |
| `status` | string | `success`, `failed`, `running`, or `never_run` |
| `duration` | number \| null | Execution time in seconds |
| `error` | string \| null | Error message if failed |

**Example:**

```bash
# Find failed jobs
curl -H "X-Admin-Token: $TOKEN" http://localhost:4000/api/admin/system/scheduler/status \
    | jq '.jobs[] | select(.status == "failed") | {name, error}'
```

#### GET /admin/system/scheduler/health

Global scheduler health metrics.

**Authentication:** Admin token required

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether scheduler is globally enabled |
| `uptime` | number | Server uptime in seconds |
| `totalJobsExecuted` | number | Total executions since start (currently always 0) |
| `successRate` | number | Percentage successful (currently always 100) |
| `overdueJobs` | array | Jobs that should have run but didn't (currently always empty) |

#### PATCH /admin/system/scheduler/job/:jobName

Update job configuration (enable/disable or modify schedule) at runtime.

**Authentication:** Admin token required

**URL parameters:**
- `:jobName` - Job identifier (e.g., `markets:refresh`)

**Request body (all fields optional):**

```json
{
    "enabled": true,
    "schedule": "*/10 * * * *"
}
```

**Response (success):**

```json
{
    "success": true,
    "message": "Scheduler job markets:refresh updated successfully",
    "job": {
        "name": "markets:refresh",
        "schedule": "*/10 * * * *",
        "enabled": true
    }
}
```

**Response (error - invalid cron):**

```json
{
    "success": false,
    "error": "Invalid cron expression"
}
```

**Example - disable job:**

```bash
curl -X PATCH \
    -H "X-Admin-Token: $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"enabled": false}' \
    http://localhost:4000/api/admin/system/scheduler/job/markets:refresh
```

**Example - change schedule:**

```bash
# Run every 15 minutes instead of 10
curl -X PATCH \
    -H "X-Admin-Token: $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"schedule": "*/15 * * * *"}' \
    http://localhost:4000/api/admin/system/scheduler/job/markets:refresh
```

### Market Monitoring

#### GET /admin/system/markets/platforms

Status of all market provider platforms.

**Authentication:** Admin token required

**Response fields (per platform):**

| Field | Type | Description |
|-------|------|-------------|
| `guid` | string | Platform identifier |
| `name` | string | Display name |
| `lastFetchedAt` | string (ISO) \| null | Last successful fetch |
| `status` | string | `online` (<10m), `stale` (10-60m), `failed` (>60m), or `disabled` |
| `reliabilityScore` | number | Success percentage (0-100) |
| `consecutiveFailures` | number | Consecutive failed fetches |
| `isActive` | boolean | Whether platform is enabled |

**Example:**

```bash
# Find stale or failed platforms
curl -H "X-Admin-Token: $TOKEN" http://localhost:4000/api/admin/system/markets/platforms \
    | jq '.platforms[] | select(.status == "stale" or .status == "failed") | {name, status, consecutiveFailures}'
```

#### GET /admin/system/markets/freshness

Market data freshness overview.

**Authentication:** Admin token required

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `oldestDataAge` | number \| null | Age of oldest platform data in minutes |
| `stalePlatformCount` | number | Platforms with data >10 minutes old |
| `averageDataAge` | number | Average age across all platforms |
| `platformsWithOldData` | array | Names of platforms with data >60 minutes old |

#### POST /admin/system/markets/refresh

Manually trigger market data refresh for all platforms (async).

**Authentication:** Admin token required

**Request body (optional):**

```json
{
    "force": true
}
```

**Response:**

```json
{
    "success": true,
    "message": "Market refresh triggered"
}
```

**Example - normal refresh:**

```bash
curl -X POST -H "X-Admin-Token: $TOKEN" \
    http://localhost:4000/api/admin/system/markets/refresh
```

**Example - force refresh (bypass cache):**

```bash
curl -X POST \
    -H "X-Admin-Token: $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"force": true}' \
    http://localhost:4000/api/admin/system/markets/refresh
```

### System Health

#### GET /admin/system/health/database

MongoDB connection status and performance metrics.

**Authentication:** Admin token required

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `connected` | boolean | Connection status |
| `responseTime` | number \| null | Ping time in milliseconds |
| `poolSize` | number | Total connection pool size |
| `databaseSize` | number \| null | Database size in bytes |
| `collectionCount` | number | Number of collections |
| `recentErrors` | array | Recent errors (currently always empty) |

#### GET /admin/system/health/redis

Redis connection status and memory metrics.

**Authentication:** Admin token required

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `connected` | boolean | Connection status |
| `responseTime` | number \| null | Ping time in milliseconds |
| `memoryUsage` | number \| null | Memory usage in bytes |
| `keyCount` | number | Total keys in database |
| `evictions` | number | Total evicted keys (indicates memory pressure) |

#### GET /admin/system/health/server

Backend server resource usage metrics.

**Authentication:** Admin token required

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `uptime` | number | Server uptime in seconds |
| `memoryUsage.heapUsed` | number | Used heap memory in bytes |
| `memoryUsage.heapTotal` | number | Total heap memory in bytes |
| `memoryUsage.rss` | number | Resident set size (total memory) in bytes |
| `cpuUsage` | number | CPU usage percentage |

### Configuration

#### GET /admin/system/config

Current system configuration including feature flags, thresholds, and integration status.

**Authentication:** Admin token required

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `environment` | string | `development` or `production` |
| `port` | number | Backend server port |
| `features.scheduler` | boolean | Whether scheduler is enabled |
| `features.websockets` | boolean | Whether WebSockets are enabled |
| `thresholds.delegationAmountTRX` | number | Min TRX for large delegation (in sun) |
| `thresholds.stakeAmountTRX` | number | Min TRX for large stake (in sun) |
| `limits.commentsDailyLimit` | number | Max comments per user per day |
| `limits.chatDailyLimit` | number | Max chat messages per user per day |
| `integrations.hasTronGridKey` | boolean | Whether TronGrid API key is configured |
| `integrations.hasTelegramBot` | boolean | Whether Telegram bot is configured |

**Example:**

```bash
# Verify critical integrations
curl -H "X-Admin-Token: $TOKEN" http://localhost:4000/api/admin/system/config \
    | jq '.config.integrations | {tronGrid: .hasTronGridKey, telegram: .hasTelegramBot}'
```

### WebSocket Monitoring

#### GET /admin/system/websockets/stats

Statistics for all plugin WebSocket subscriptions.

**Authentication:** Admin token required

**Response fields (per plugin):**

| Field | Type | Description |
|-------|------|-------------|
| `pluginId` | string | Plugin identifier |
| `activeConnections` | number | Active WebSocket connections |
| `totalMessagesSent` | number | Total messages sent since server start |
| `errorCount` | number | Total errors encountered |
| `lastActivity` | string (ISO) | Most recent activity timestamp |

#### GET /admin/system/websockets/aggregate

Aggregated WebSocket statistics across all plugins.

**Authentication:** Admin token required

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `totalPlugins` | number | Number of plugins with WebSocket support |
| `totalConnections` | number | Total active connections |
| `totalMessagesSent` | number | Total messages across all plugins |
| `totalErrors` | number | Total errors across all plugins |

#### GET /admin/system/websockets/plugin/:pluginId

WebSocket statistics for a specific plugin.

**Authentication:** Admin token required

**URL parameters:**
- `:pluginId` - Plugin identifier (e.g., `whale-alerts`)

**Response:** Same fields as individual stats in `/websockets/stats`

**Response (error - 404):**

```json
{
    "success": false,
    "error": "Plugin whale-alerts not found or does not have WebSocket capabilities"
}
```

---

## WebSocket Events Reference

### Connection and Subscription

**Connect to WebSocket:**

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:4000', {
    transports: ['websocket']
});

socket.on('connect', () => {
    console.log('Connected');
});
```

**Subscription formats:**

1. **New room-based format (recommended for plugins):**
   ```javascript
   socket.emit('subscribe', 'plugin-id', 'room-name', { options });
   ```

2. **Legacy plugin format:**
   ```javascript
   socket.emit('subscribe', 'plugin-id', { options });
   ```

3. **Legacy object format (core subscriptions):**
   ```javascript
   socket.emit('subscribe', {
       markets: { all: true },
       transactions: { minAmount: 1000000 },
       comments: { resourceId: 'abc123...' },
       chat: true
   });
   ```

**Unsubscribe:**

```javascript
socket.emit('unsubscribe', 'plugin-id', 'room-name');
```

### Core Events

#### market:update

Emitted when market data is refreshed for a platform.

**Rooms:** `markets:all`, `markets:{guid}`

**Payload:**

```javascript
{
    guid: "tronsave",
    name: "TronSave",
    pricing: { "1h": 45.5, "1d": 42.0, "3d": 40.5 },
    reliability: 95.5,
    lastFetchedAt: "2025-10-16T14:20:00.000Z"
}
```

**Example:**

```javascript
socket.emit('subscribe', { markets: { all: true } });
socket.on('market:update', (market) => {
    console.log(`${market.name}: ${market.pricing['1d']} sun/energy`);
});
```

#### transaction:large

Emitted when a large transaction is processed (above whale threshold).

**Rooms:** `transactions:all`, `transactions:address:{address}`

**Payload:**

```javascript
{
    txId: "abc123...",
    blockNumber: 12345678,
    timestamp: "2025-10-16T14:25:00.000Z",
    type: "TransferContract",
    from: { address: "TXyz...", balance: 1000000000 },
    to: { address: "TAbc...", balance: 500000000 },
    amountTRX: 5000000.5,
    amountUSD: 750000.0,
    energyUsed: 0,
    energyCostUSD: 0
}
```

**Example:**

```javascript
socket.emit('subscribe', { transactions: { minAmount: 1000000 } });
socket.on('transaction:large', (tx) => {
    console.log(`Whale: ${tx.amountTRX} TRX ($${tx.amountUSD})`);
});
```

#### delegation:new

Emitted when a resource delegation is processed.

**Rooms:** Same as `transaction:large`

**Payload:** Same structure as `transaction:large`

#### stake:new

Emitted when a staking transaction is processed.

**Rooms:** Same as `transaction:large`

**Payload:** Same structure as `transaction:large`

#### block:new

Emitted when a new block is processed.

**Rooms:** Global (broadcast to all clients)

**Payload:**

```javascript
{
    blockNumber: 12345678,
    timestamp: "2025-10-16T14:25:00.000Z",
    stats: {
        transactionCount: 234,
        totalVolumeTRX: 1500000.0
    }
}
```

#### comments:new

Emitted when a new comment is posted.

**Rooms:** `comments:{threadId}`

**Payload:**

```javascript
{
    threadId: "abc123...",
    commentId: "comment_123",
    wallet: "TXyz...",
    message: "This looks legitimate",
    createdAt: "2025-10-16T14:25:00.000Z"
}
```

#### chat:update

Emitted when a chat message is created or updated.

**Rooms:** `chat:global`

**Payload:**

```javascript
{
    messageId: "msg_123",
    wallet: "TXyz...",
    message: "Hello everyone!",
    updatedAt: "2025-10-16T14:25:00.000Z"
}
```

### Error Handling

**Connection errors:**

```javascript
socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    if (reason === 'io server disconnect') {
        socket.connect();  // Reconnect
    }
});
```

**Subscription errors:**

```javascript
socket.on('subscription:error', (error) => {
    console.error('Subscription failed:', error.message);
});
```

---

## Troubleshooting

### Authentication Failures (401 Unauthorized)

**Solution:**
1. Verify `ADMIN_API_TOKEN` is set in backend `.env`
2. Check you're using `X-Admin-Token` header (not query param)
3. Ensure token has no extra whitespace or quotes
4. Restart backend after changing token

### Endpoints Returning Empty Data

**Solution:**
1. Wait for scheduler jobs to run (fresh install may have no data)
2. Check scheduler is enabled: `ENABLE_SCHEDULER=true`
3. Verify database/Redis connectivity via `/health/database` and `/health/redis`
4. Review backend logs for errors during data collection

### Scheduler Updates Not Taking Effect

**Solution:**
1. Verify scheduler is globally enabled (`ENABLE_SCHEDULER=true`)
2. Ensure job is enabled (not just schedule updated)
3. Wait for next scheduled run (changes don't retroactively trigger)
4. Check response confirms update succeeded

### WebSocket Connection Drops

**Solution:**
1. Enable reconnection in Socket.IO client config
2. Check firewall allows WebSocket connections
3. Verify `ENABLE_WEBSOCKETS=true` in backend `.env`
4. Add polling fallback: `transports: ['websocket', 'polling']`

### High API Response Times

**Solution:**
1. Check database health: `/health/database` (response time should be <50ms)
2. Check Redis health: `/health/redis` (response time should be <10ms)
3. Monitor server resources: `/health/server` (memory/CPU usage)
4. Review backend logs for slow queries

---

## Related Documentation

- [system-monitoring-dashboard.md](./system-monitoring-dashboard.md) - Web UI for accessing these endpoints
- [system-scheduler-operations.md](./system-scheduler-operations.md) - Detailed scheduler control and cron syntax
- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) - Blockchain sync implementation details
- [plugins/plugins-websocket-subscriptions.md](../plugins/plugins-websocket-subscriptions.md) - Plugin WebSocket patterns
- [environment.md](../environment.md) - Environment variable configuration
