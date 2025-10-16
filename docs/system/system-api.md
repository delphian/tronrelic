# TronRelic API & WebSocket Reference

This document provides complete reference documentation for all TronRelic API endpoints and WebSocket events. It covers public-facing APIs used by frontend applications, admin system monitoring endpoints, and real-time WebSocket subscriptions.

## Who This Document Is For

This reference is for:

- **Frontend developers** - Building interfaces that consume TronRelic APIs and real-time data
- **Integration developers** - Building third-party applications and tools on top of TronRelic
- **DevOps engineers** - Monitoring system health and triggering manual operations
- **Plugin authors** - Understanding system capabilities and integration points

## Why This Matters

Understanding TronRelic's APIs helps you:

- **Build features confidently** - Know exactly what data is available and how to access it
- **Optimize performance** - Understand caching strategies and rate limits
- **Debug integration issues** - See expected request/response formats and error handling
- **Monitor system health** - Use admin APIs to track operational metrics
- **React to real-time events** - Subscribe to WebSocket events for live data

---

## Part 1: Authentication & Conventions

### Authentication Types

TronRelic uses three authentication methods depending on the endpoint:

1. **Public** - No authentication required (most read-only endpoints)
2. **Wallet** - TronLink signature authentication (for user-specific actions like comments, chat)
3. **Admin** - Token-based authentication (for system monitoring and control)

**Admin authentication headers:**

```bash
# Recommended
X-Admin-Token: your-token-here

# Alternative (standard Bearer token format)
Authorization: Bearer your-token-here
```

**Security note:** Query parameter authentication (`?token=...`) is intentionally not supported to prevent tokens from appearing in server access logs.

**Admin token configuration:**

Set `ADMIN_API_TOKEN` in backend `.env`:

```bash
# Generate with: openssl rand -hex 32
ADMIN_API_TOKEN=your-secure-token-here
```

### Response Format Standards

**Successful responses:**

```json
{
  "success": true,
  "data-key": { ... }
}
```

**Error responses:**

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

### Cache Strategy and Redis Conventions

TronRelic uses Redis caching with consistent key naming conventions:

**Key pattern:** `tronrelic:<domain>:<resource>:<identifier>`

**Common cache keys:**
- `tronrelic:markets:current` - Current market data (300s TTL)
- `tronrelic:account:snapshot:{address}` - Account summaries (60s TTL)
- `tronrelic:comments:{threadId}` - Comment threads (30s TTL)
- `tronrelic:chat:messages` - Chat messages (10s TTL)

**Cache invalidation:**
- Market refresh endpoint clears `markets:*` keys
- Comment POST invalidates thread-specific cache
- Chat POST invalidates global chat cache

### MongoDB Collections and Data Flow

**Primary collections:**
- `blocks` - Block metadata and processing status
- `transactions` - Enriched transaction records with USD values and energy costs
- `markets` - Market provider pricing data and reliability scores
- `scheduler_jobs` - Scheduler job configurations (persisted across restarts)
- `scheduler_executions` - Job execution history and error tracking
- `comments` - User comments on threads (transactions, accounts, etc.)
- `chat_messages` - Global chat messages
- `notification_subscriptions` - User notification preferences
- `telegram_users` - Telegram bot user registrations

**Data flow:**
1. Blockchain sync → `blocks` and `transactions` collections
2. Market refresh → `markets` collection → Redis cache
3. Scheduler executions → `scheduler_executions` collection
4. User actions (comments, chat) → MongoDB → Redis cache invalidation → WebSocket broadcast

---

## Part 2: Public API Endpoints (By Domain)

### Markets Domain

#### GET /api/markets

List active markets ordered by priority with pricing metadata.

**Authentication:** Public
**Cache:** `redis:markets:current` (300s)
**Dependencies:** MongoDB `markets` collection

**Query parameters:** None

**Response:**

```json
{
  "success": true,
  "markets": [
    {
      "guid": "tronsave",
      "name": "TronSave",
      "priority": 1,
      "pricing": {
        "1h": 45.5,
        "1d": 42.0,
        "3d": 40.5,
        "7d": 39.0,
        "14d": 38.0,
        "30d": 37.5
      },
      "reliability": 95.5,
      "lastFetchedAt": "2025-10-16T14:20:00.000Z",
      "affiliateUrl": "https://tronsave.com/ref/tronrelic"
    }
  ]
}
```

**Example usage (curl):**

```bash
curl http://localhost:4000/api/markets
```

**Example usage (JavaScript):**

```javascript
const response = await fetch('http://localhost:4000/api/markets');
const { markets } = await response.json();
markets.forEach(m => console.log(`${m.name}: ${m.pricing['1d']} sun/energy`));
```

#### POST /api/markets/refresh

Force market data refresh for all platforms. Does not wait for completion (async operation).

**Authentication:** Admin (currently enforced in production)
**Cache:** Clears `redis:markets:*` keys
**Dependencies:** Redis, MongoDB `markets` collection
**Rate limit:** Scheduler triggers every 10 minutes

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

**Example usage:**

```bash
curl -X POST \
  -H "X-Admin-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{"force": true}' \
  http://localhost:4000/api/markets/refresh
```

#### GET /api/markets/compare

Compare pricing across all active markets.

**Authentication:** Public
**Cache:** Same as `/api/markets`
**Dependencies:** MongoDB `markets` collection

**Response:** Similar to `/api/markets` with additional comparison metadata

#### GET /api/markets/:guid/history

Historical pricing data for a specific market provider.

**Authentication:** Public
**Cache:** None (future enhancement)
**Dependencies:** MongoDB `markets` collection

**URL parameters:**
- `:guid` - Market provider identifier (e.g., `tronsave`, `energyswap`)

**Response:**

```json
{
  "success": true,
  "history": [
    {
      "timestamp": "2025-10-16T14:00:00.000Z",
      "pricing": { "1h": 45.5, "1d": 42.0 }
    }
  ]
}
```

#### POST /api/markets/:guid/affiliate/impression

Track affiliate impression for analytics.

**Authentication:** Public
**Rate limit:** Permissive (analytics only)
**Dependencies:** MongoDB (analytics collection)

#### POST /api/markets/:guid/affiliate/click

Track affiliate click for analytics and revenue attribution.

**Authentication:** Public
**Rate limit:** Permissive (analytics only)
**Dependencies:** MongoDB (analytics collection)

---

### Blockchain Domain

#### GET /api/blockchain/transactions/latest

Latest transactions for dashboards and live feeds.

**Authentication:** Public
**Cache:** None (future: redis hot set)
**Dependencies:** MongoDB `transactions` collection

**Query parameters:**
- `limit` (optional) - Number of transactions to return (default: 50, max: 200)

**Response:**

```json
{
  "success": true,
  "transactions": [
    {
      "txId": "abc123...",
      "blockNumber": 12345678,
      "timestamp": "2025-10-16T14:25:00.000Z",
      "type": "TriggerSmartContract",
      "from": {
        "address": "TXyz...",
        "balance": 1000000000
      },
      "to": {
        "address": "TAbc...",
        "balance": 500000000
      },
      "amountTRX": 100.5,
      "amountUSD": 15.75,
      "energyUsed": 65000,
      "energyCostUSD": 0.25
    }
  ]
}
```

**Example usage:**

```bash
# Get last 100 transactions
curl "http://localhost:4000/api/blockchain/transactions/latest?limit=100"
```

**Example usage (JavaScript):**

```javascript
const response = await fetch('http://localhost:4000/api/blockchain/transactions/latest?limit=20');
const { transactions } = await response.json();
console.log(`Latest ${transactions.length} transactions loaded`);
```

#### GET /api/blockchain/transactions/timeseries

Transaction volume and statistics over time.

**Authentication:** Public
**Cache:** None
**Dependencies:** MongoDB `transactions` collection

**Query parameters:**
- `interval` (optional) - Time interval (e.g., `1h`, `1d`, `1w`)
- `limit` (optional) - Number of data points to return

**Response:**

```json
{
  "success": true,
  "timeseries": [
    {
      "timestamp": "2025-10-16T14:00:00.000Z",
      "count": 1234,
      "volumeTRX": 1500000.0,
      "volumeUSD": 225000.0
    }
  ]
}
```

#### POST /api/blockchain/sync

Manually trigger blockchain sync job. Does not wait for completion (async operation).

**Authentication:** Admin
**Cache:** None
**Dependencies:** BullMQ `block-sync` queue, TronGrid API

**Request body:** None required

**Response:**

```json
{
  "success": true,
  "message": "Blockchain sync triggered"
}
```

**Example usage:**

```bash
curl -X POST \
  -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/blockchain/sync
```

---

### Accounts Domain

#### GET /api/accounts/snapshot

Aggregated address summary with recent transactions.

**Authentication:** Public
**Cache:** `redis:account:snapshot:{address}` (60s)
**Dependencies:** MongoDB `transactions` collection

**Query parameters:**
- `address` (required) - Base58 TRON address

**Response:**

```json
{
  "success": true,
  "snapshot": {
    "address": "TXyz...",
    "balance": 1000000000,
    "totalTransactions": 1234,
    "recentTransactions": [
      {
        "txId": "abc123...",
        "timestamp": "2025-10-16T14:25:00.000Z",
        "type": "TransferContract",
        "amountTRX": 100.5
      }
    ]
  }
}
```

**Example usage:**

```bash
curl "http://localhost:4000/api/accounts/snapshot?address=TXyz..."
```

---

### Transactions Analytics

#### POST /api/transactions/high-amounts

Whale transactions above threshold.

**Authentication:** Public
**Cache:** Future: `redis:transactions:high:{threshold}`
**Dependencies:** MongoDB `transactions` collection

**Request body:**

```json
{
  "minAmountTRX": 1000000,
  "limit": 50
}
```

**Response:**

```json
{
  "success": true,
  "transactions": [
    {
      "txId": "abc123...",
      "amountTRX": 5000000.5,
      "amountUSD": 750000.0,
      "timestamp": "2025-10-16T14:25:00.000Z"
    }
  ]
}
```

**Example usage:**

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"minAmountTRX": 1000000, "limit": 20}' \
  http://localhost:4000/api/transactions/high-amounts
```

#### POST /api/transactions/account

Paginated account transaction list.

**Authentication:** Public
**Cache:** None
**Dependencies:** MongoDB `transactions` collection

**Request body:**

```json
{
  "address": "TXyz...",
  "skip": 0,
  "limit": 50
}
```

**Response:**

```json
{
  "success": true,
  "transactions": [...],
  "total": 1234
}
```

#### POST /api/transactions/ids

Batch lookup by transaction IDs.

**Authentication:** Public
**Cache:** None
**Dependencies:** MongoDB `transactions` collection

**Request body:**

```json
{
  "txIds": ["abc123...", "def456..."]
}
```

**Response:**

```json
{
  "success": true,
  "transactions": [
    {
      "txId": "abc123...",
      "blockNumber": 12345678,
      "type": "TransferContract",
      "amountTRX": 100.5
    }
  ]
}
```

#### POST /api/transactions/latest-by-type

Recent transactions filtered by transaction type.

**Authentication:** Public
**Cache:** None
**Dependencies:** MongoDB `transactions` collection

**Request body:**

```json
{
  "type": "TriggerSmartContract",
  "limit": 50
}
```

**Response:**

```json
{
  "success": true,
  "transactions": [...]
}
```

**Common transaction types:**
- `TransferContract` - TRX transfers
- `TriggerSmartContract` - Contract interactions
- `FreezeBalanceV2Contract` - Staking
- `DelegateResourceContract` - Resource delegation
- `TransferAssetContract` - TRC10 token transfers

---

### Comments Domain

#### GET /api/comments

Recent thread comments (reverse chronological).

**Authentication:** Public
**Cache:** `redis:comments:{threadId}` (30s)
**Dependencies:** MongoDB `comments` collection

**Query parameters:**
- `threadId` (required) - Thread identifier (e.g., transaction hash, account address)

**Response:**

```json
{
  "success": true,
  "comments": [
    {
      "id": "comment_123",
      "threadId": "abc123...",
      "wallet": "TXyz...",
      "message": "This looks like a legitimate transaction",
      "createdAt": "2025-10-16T14:25:00.000Z",
      "signature": "0x..."
    }
  ]
}
```

**Example usage:**

```bash
curl "http://localhost:4000/api/comments?threadId=abc123..."
```

#### POST /api/comments

Submit signed comment to a thread.

**Authentication:** Wallet signature
**Cache:** Invalidates `redis:comments:{threadId}`
**Dependencies:** MongoDB `comments`, Redis
**Rate limit:** 3 comments per minute per IP

**Request body:**

```json
{
  "threadId": "abc123...",
  "wallet": "TXyz...",
  "message": "This is my comment",
  "signature": "0x..."
}
```

**Response:**

```json
{
  "success": true,
  "comment": {
    "id": "comment_123",
    "threadId": "abc123...",
    "createdAt": "2025-10-16T14:25:00.000Z"
  }
}
```

**WebSocket broadcast:** Emits `comments:new` event to `comments:{threadId}` room

---

### Chat Domain

#### GET /api/chat

Returns latest chat messages for initial UI hydration.

**Authentication:** Public
**Cache:** `redis:chat:messages` (10s)
**Dependencies:** MongoDB `chat_messages` collection

**Query parameters:**
- `limit` (optional) - Max messages to return (default: 100, max: 500)

**Response:**

```json
{
  "success": true,
  "messages": [
    {
      "id": "msg_123",
      "wallet": "TXyz...",
      "message": "Hello everyone!",
      "updatedAt": "2025-10-16T14:25:00.000Z"
    }
  ]
}
```

**Example usage:**

```bash
curl "http://localhost:4000/api/chat?limit=50"
```

#### POST /api/chat

Upsert chat message for wallet signature. One active message per wallet enforced.

**Authentication:** Wallet signature
**Cache:** Invalidates `redis:chat:messages`
**Dependencies:** MongoDB `chat_messages`, Redis

**Request body:**

```json
{
  "wallet": "TXyz...",
  "message": "My chat message",
  "signature": "0x..."
}
```

**Response:**

```json
{
  "success": true,
  "message": {
    "id": "msg_123",
    "wallet": "TXyz...",
    "updatedAt": "2025-10-16T14:25:00.000Z"
  }
}
```

**WebSocket broadcast:** Emits `chat:update` event to `chat:global` room

---

### Notifications Domain

#### POST /api/notifications/preferences

Save notification channels and thresholds for a wallet.

**Authentication:** Wallet signature
**Cache:** None
**Dependencies:** MongoDB `notification_subscriptions` collection

**Request body:**

```json
{
  "wallet": "TXyz...",
  "channels": ["telegram", "email"],
  "thresholds": {
    "delegationAmountTRX": 1000000,
    "stakeAmountTRX": 500000,
    "transactionAmountTRX": 2000000
  },
  "signature": "0x..."
}
```

**Response:**

```json
{
  "success": true,
  "subscription": {
    "wallet": "TXyz...",
    "channels": ["telegram", "email"],
    "thresholds": {...}
  }
}
```

---

### Tools & Utilities

#### POST /api/tools/energy/estimate

Deterministic energy calculator with transparency output.

**Authentication:** Public
**Cache:** None (in-memory calculation)
**Dependencies:** None

**Request body:**

```json
{
  "contractType": "TRC20",
  "averageMethodCalls": 2,
  "expectedTransactionsPerDay": 1000
}
```

**Response:**

```json
{
  "success": true,
  "estimate": {
    "energyPerTransaction": 65000,
    "dailyEnergyNeeded": 65000000,
    "recommendedStakeTRX": 500000,
    "breakdown": {
      "baseEnergy": 31000,
      "methodCallEnergy": 34000
    }
  }
}
```

**Example usage:**

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"contractType": "TRC20", "averageMethodCalls": 2, "expectedTransactionsPerDay": 1000}' \
  http://localhost:4000/api/tools/energy/estimate
```

#### POST /api/tools/signature/verify

Wallet signature verification helper.

**Authentication:** Public
**Cache:** None
**Dependencies:** TronWeb

**Request body:**

```json
{
  "message": "Sign this message",
  "signature": "0x...",
  "address": "TXyz..."
}
```

**Response:**

```json
{
  "success": true,
  "valid": true
}
```

---

### Telegram Integrations

#### POST /api/telegram/bot/webhook

Webhook endpoint for Telegram bot updates.

**Authentication:** Telegram (IP validation + secret token)
**Cache:** None
**Dependencies:** MongoDB `telegram_users`, Telegram API

**Request body:** Telegram Update object (see Telegram Bot API docs)

**Response:**

```json
{
  "success": true
}
```

**Security:** Validates Telegram IP ranges and `TELEGRAM_WEBHOOK_SECRET` token

---

## Part 3: Admin System Monitoring Endpoints

All endpoints in this section require admin authentication and are prefixed with `/api/admin/system`.

**Base URL:**
- Development: `http://localhost:4000/api/admin/system`
- Production: `https://your-domain.com/api/admin/system`

### System Overview

#### GET /overview

Consolidated snapshot of all system metrics. Combines blockchain status, transaction stats, scheduler health, market freshness, database status, redis status, and server metrics into a single request.

**Use case:** Dashboard summary view, health check endpoint, system status page.

**Response:**

```json
{
  "success": true,
  "overview": {
    "blockchain": {
      "currentBlock": 12345678,
      "networkBlock": 12345680,
      "lag": 2,
      "backfillQueueSize": 0,
      "lastProcessedAt": "2025-10-16T14:25:00.000Z",
      "lastProcessedBlockId": "0000000000bc614e...",
      "isHealthy": true,
      "estimatedCatchUpTime": 1,
      "lastError": null,
      "lastErrorAt": null,
      "processingBlocksPerMinute": 3.2,
      "networkBlocksPerMinute": 20,
      "netCatchUpRate": -16.8,
      "averageProcessingDelaySeconds": 4.5
    },
    "transactions": {
      "totalIndexed": 1234567,
      "indexedToday": 2345,
      "byType": {}
    },
    "scheduler": {
      "enabled": true,
      "uptime": 86400,
      "totalJobsExecuted": 0,
      "successRate": 100,
      "overdueJobs": []
    },
    "markets": {
      "oldestDataAge": 5.2,
      "stalePlatformCount": 0,
      "averageDataAge": 3.1,
      "platformsWithOldData": []
    },
    "database": {
      "connected": true,
      "responseTime": 12,
      "poolSize": 10,
      "availableConnections": 10,
      "databaseSize": 12345678,
      "collectionCount": 15,
      "recentErrors": []
    },
    "redis": {
      "connected": true,
      "responseTime": 2,
      "memoryUsage": 2048576,
      "keyCount": 45,
      "evictions": 0,
      "hitRate": null
    },
    "server": {
      "uptime": 86400,
      "memoryUsage": {
        "heapUsed": 52428800,
        "heapTotal": 83886080,
        "rss": 104857600,
        "external": 1048576
      },
      "cpuUsage": 12.5,
      "activeConnections": 0,
      "requestRate": null,
      "errorRate": null
    }
  }
}
```

**Example usage (curl):**

```bash
curl -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/overview
```

**Example usage (JavaScript):**

```javascript
const response = await fetch('http://localhost:4000/api/admin/system/overview', {
  headers: {
    'X-Admin-Token': process.env.ADMIN_API_TOKEN
  }
});
const data = await response.json();
console.log(`Blockchain lag: ${data.overview.blockchain.lag} blocks`);
```

### Blockchain Monitoring

#### GET /blockchain/status

Current blockchain sync status including lag, backfill queue size, and health indicators.

**Use case:** Monitoring blockchain sync health, detecting if system is falling behind network.

**Response:**

```json
{
  "success": true,
  "status": {
    "currentBlock": 12345678,
    "networkBlock": 12345680,
    "lag": 2,
    "backfillQueueSize": 0,
    "lastProcessedAt": "2025-10-16T14:25:00.000Z",
    "lastProcessedBlockId": "0000000000bc614e...",
    "isHealthy": true,
    "estimatedCatchUpTime": 1,
    "lastError": null,
    "lastErrorAt": null,
    "processingBlocksPerMinute": 3.2,
    "networkBlocksPerMinute": 20,
    "netCatchUpRate": -16.8,
    "averageProcessingDelaySeconds": 4.5
  }
}
```

**Field descriptions:**

- `currentBlock` - Last block processed and stored in MongoDB
- `networkBlock` - Current block height on TRON network
- `lag` - Number of blocks behind (networkBlock - currentBlock)
- `backfillQueueSize` - Number of failed blocks waiting for retry
- `lastProcessedAt` - ISO timestamp of when last block was processed
- `lastProcessedBlockId` - Block hash of last processed block
- `isHealthy` - `true` if lag < 100 blocks and backfill queue < 240
- `estimatedCatchUpTime` - Minutes until caught up (null if already caught up)
- `lastError` - Most recent error message or object (null if no recent errors)
- `lastErrorAt` - ISO timestamp of last error
- `processingBlocksPerMinute` - Rate at which system is processing blocks
- `networkBlocksPerMinute` - Rate at which network produces blocks (~20)
- `netCatchUpRate` - Net rate (processingRate - networkRate), negative means falling behind
- `averageProcessingDelaySeconds` - Average time between block creation and processing

**Example usage (curl):**

```bash
curl -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/blockchain/status
```

#### GET /blockchain/transactions

Transaction indexing statistics including total count, daily count, and breakdown by transaction type.

**Use case:** Monitoring transaction ingestion, verifying system is indexing all transaction types.

**Response:**

```json
{
  "success": true,
  "stats": {
    "totalIndexed": 1234567,
    "indexedToday": 2345,
    "byType": {}
  }
}
```

**Field descriptions:**

- `totalIndexed` - Total transactions stored in MongoDB (estimated count)
- `indexedToday` - Transactions indexed since midnight UTC
- `byType` - Object mapping transaction types to counts (empty in current implementation)

**Example usage (JavaScript):**

```javascript
const response = await fetch('http://localhost:4000/api/admin/system/blockchain/transactions', {
  headers: { 'X-Admin-Token': token }
});
const { stats } = await response.json();
console.log(`Total transactions indexed: ${stats.totalIndexed.toLocaleString()}`);
```

#### GET /blockchain/metrics

Block processing performance metrics including processing speed, success rate, and recent errors.

**Use case:** Diagnosing performance bottlenecks, understanding processing throughput.

**Response:**

```json
{
  "success": true,
  "metrics": {
    "averageBlockProcessingTime": 4.5,
    "blocksPerMinute": 3.2,
    "successRate": 99.5,
    "recentErrors": [
      {
        "blockNumber": 12345600,
        "timestamp": "2025-10-16T14:20:00.000Z",
        "message": "Rate limit exceeded, retrying..."
      }
    ],
    "averageProcessingDelaySeconds": 4.5,
    "averageProcessingIntervalSeconds": 0.2,
    "networkBlocksPerMinute": 20,
    "netCatchUpRate": -16.8,
    "projectedCatchUpMinutes": 45,
    "backfillQueueSize": 0
  }
}
```

**Field descriptions:**

- `averageBlockProcessingTime` - Average seconds to process one block (includes enrichment, observers)
- `blocksPerMinute` - Throughput in blocks per minute
- `successRate` - Percentage of blocks processed successfully (excludes backfill queue)
- `recentErrors` - Array of recent processing errors with block number, timestamp, message
- `averageProcessingDelaySeconds` - Average delay between block creation and processing
- `averageProcessingIntervalSeconds` - Average time between consecutive block processing
- `networkBlocksPerMinute` - Network block production rate
- `netCatchUpRate` - Net catch-up rate (negative means falling behind)
- `projectedCatchUpMinutes` - Estimated minutes to reach current network height
- `backfillQueueSize` - Number of blocks in backfill queue

**Example usage (monitoring alert):**

```bash
# Alert if processing rate falls below 2 blocks/minute
LAG=$(curl -s -H "X-Admin-Token: $TOKEN" \
  http://localhost:4000/api/admin/system/blockchain/metrics \
  | jq '.metrics.blocksPerMinute')

if (( $(echo "$LAG < 2" | bc -l) )); then
  echo "WARNING: Block processing rate too low: $LAG blocks/min"
fi
```

#### POST /blockchain/sync

Manually trigger blockchain sync job. Does not wait for completion (async operation).

**Use case:** Force immediate sync after system restart, catch up after extended downtime.

**Request body:** None required

**Response:**

```json
{
  "success": true,
  "message": "Blockchain sync triggered"
}
```

**Example usage (curl):**

```bash
curl -X POST \
  -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/blockchain/sync
```

**Example usage (JavaScript):**

```javascript
await fetch('http://localhost:4000/api/admin/system/blockchain/sync', {
  method: 'POST',
  headers: { 'X-Admin-Token': token }
});
console.log('Blockchain sync triggered');
```

### Scheduler Operations

#### GET /scheduler/status

Status of all scheduled jobs including enabled state, last execution, next scheduled run, and recent errors.

**Use case:** Verifying jobs are running on schedule, diagnosing job failures.

**Response:**

```json
{
  "success": true,
  "jobs": [
    {
      "name": "markets:refresh",
      "schedule": "*/10 * * * *",
      "enabled": true,
      "lastRun": "2025-10-16T14:20:00.000Z",
      "nextRun": null,
      "status": "success",
      "duration": 1.234,
      "error": null
    },
    {
      "name": "blockchain:sync",
      "schedule": "*/1 * * * *",
      "enabled": true,
      "lastRun": "2025-10-16T14:25:00.000Z",
      "nextRun": null,
      "status": "success",
      "duration": 0.456,
      "error": null
    },
    {
      "name": "cache:cleanup",
      "schedule": "0 * * * *",
      "enabled": true,
      "lastRun": "2025-10-16T14:00:00.000Z",
      "nextRun": null,
      "status": "success",
      "duration": 0.123,
      "error": null
    },
    {
      "name": "alerts:dispatch",
      "schedule": "*/1 * * * *",
      "enabled": true,
      "lastRun": "2025-10-16T14:25:00.000Z",
      "nextRun": null,
      "status": "success",
      "duration": 0.089,
      "error": null
    },
    {
      "name": "chain-parameters:fetch",
      "schedule": "*/10 * * * *",
      "enabled": true,
      "lastRun": "2025-10-16T14:20:00.000Z",
      "nextRun": null,
      "status": "success",
      "duration": 0.567,
      "error": null
    },
    {
      "name": "usdt-parameters:fetch",
      "schedule": "*/10 * * * *",
      "enabled": true,
      "lastRun": "2025-10-16T14:20:00.000Z",
      "nextRun": null,
      "status": "success",
      "duration": 0.234,
      "error": null
    }
  ]
}
```

**Field descriptions:**

- `name` - Job identifier (e.g., `markets:refresh`)
- `schedule` - Cron expression defining run schedule
- `enabled` - Whether job is currently enabled (can be toggled at runtime)
- `lastRun` - ISO timestamp of most recent execution
- `nextRun` - ISO timestamp of next scheduled execution (currently always null)
- `status` - One of: `success`, `failed`, `running`, `never_run`
- `duration` - Execution time in seconds (null if never run)
- `error` - Error message if last execution failed (null otherwise)

**Example usage (curl):**

```bash
curl -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/scheduler/status
```

**Example usage (check for failed jobs):**

```javascript
const response = await fetch('http://localhost:4000/api/admin/system/scheduler/status', {
  headers: { 'X-Admin-Token': token }
});
const { jobs } = await response.json();
const failed = jobs.filter(job => job.status === 'failed');
if (failed.length > 0) {
  console.error('Failed jobs:', failed.map(j => j.name));
}
```

#### GET /scheduler/health

Overall scheduler health metrics including uptime, total executions, success rate, and overdue jobs.

**Use case:** High-level scheduler health check, monitoring dashboard summary.

**Response:**

```json
{
  "success": true,
  "health": {
    "enabled": true,
    "uptime": 86400,
    "totalJobsExecuted": 0,
    "successRate": 100,
    "overdueJobs": []
  }
}
```

**Field descriptions:**

- `enabled` - Whether scheduler is globally enabled (`ENABLE_SCHEDULER=true`)
- `uptime` - Server uptime in seconds
- `totalJobsExecuted` - Total job executions since server start (currently always 0)
- `successRate` - Percentage of successful executions (currently always 100)
- `overdueJobs` - Array of job names that should have run but haven't (currently always empty)

**Example usage (curl):**

```bash
curl -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/scheduler/health
```

#### PATCH /scheduler/job/:jobName

Update scheduler job configuration at runtime. Modify schedule (cron expression) or enabled state without restarting backend.

**Use case:** Disable job temporarily, adjust job frequency, pause jobs during maintenance.

**URL parameters:**

- `:jobName` - Job identifier (e.g., `markets:refresh`, `blockchain:sync`)

**Request body:**

```json
{
  "enabled": true,
  "schedule": "*/10 * * * *"
}
```

**Body fields (all optional):**

- `enabled` (boolean) - Enable or disable job
- `schedule` (string) - Cron expression (5 fields: minute hour day month weekday)

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

**Response (error - scheduler disabled):**

```json
{
  "success": false,
  "error": "Scheduler is not enabled or not initialized"
}
```

**Example usage (disable job):**

```bash
curl -X PATCH \
  -H "X-Admin-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' \
  http://localhost:4000/api/admin/system/scheduler/job/markets:refresh
```

**Example usage (change schedule):**

```bash
# Change market refresh from every 10 min to every 5 min
curl -X PATCH \
  -H "X-Admin-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{"schedule": "*/5 * * * *"}' \
  http://localhost:4000/api/admin/system/scheduler/job/markets:refresh
```

**Example usage (JavaScript - enable and update schedule):**

```javascript
await fetch(`http://localhost:4000/api/admin/system/scheduler/job/blockchain:sync`, {
  method: 'PATCH',
  headers: {
    'X-Admin-Token': token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    enabled: true,
    schedule: '*/2 * * * *' // Every 2 minutes
  })
});
```

**Important notes:**

- Changes persist to MongoDB and survive backend restarts
- Changes take effect immediately (no restart required)
- Invalid cron expressions are rejected with error message
- If scheduler is globally disabled (`ENABLE_SCHEDULER=false`), this endpoint returns 503

### Market Monitoring

#### GET /markets/platforms

Status of all market provider platforms including last fetch time, reliability score, and consecutive failures.

**Use case:** Identifying which platforms are stale or failing, monitoring data quality.

**Response:**

```json
{
  "success": true,
  "platforms": [
    {
      "guid": "tronsave",
      "name": "TronSave",
      "lastFetchedAt": "2025-10-16T14:20:00.000Z",
      "status": "online",
      "responseTime": null,
      "reliabilityScore": 95.5,
      "consecutiveFailures": 0,
      "isActive": true
    },
    {
      "guid": "energyswap",
      "name": "EnergySwap",
      "lastFetchedAt": "2025-10-16T13:30:00.000Z",
      "status": "stale",
      "responseTime": null,
      "reliabilityScore": 78.2,
      "consecutiveFailures": 2,
      "isActive": true
    },
    {
      "guid": "disabled-platform",
      "name": "Disabled Platform",
      "lastFetchedAt": null,
      "status": "disabled",
      "responseTime": null,
      "reliabilityScore": 0,
      "consecutiveFailures": 10,
      "isActive": false
    }
  ]
}
```

**Field descriptions:**

- `guid` - Platform identifier
- `name` - Human-readable platform name
- `lastFetchedAt` - ISO timestamp of last successful fetch (null if never fetched)
- `status` - One of: `online` (<10 min old), `stale` (10-60 min old), `failed` (>60 min old), `disabled` (inactive)
- `responseTime` - API response time in milliseconds (currently always null)
- `reliabilityScore` - Success percentage (0-100) based on recent fetch attempts
- `consecutiveFailures` - Number of consecutive failed fetch attempts
- `isActive` - Whether platform is enabled for fetching

**Example usage (curl):**

```bash
curl -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/markets/platforms
```

**Example usage (find stale platforms):**

```javascript
const response = await fetch('http://localhost:4000/api/admin/system/markets/platforms', {
  headers: { 'X-Admin-Token': token }
});
const { platforms } = await response.json();
const stale = platforms.filter(p => p.status === 'stale' || p.status === 'failed');
console.log('Stale platforms:', stale.map(p => p.name));
```

#### GET /markets/freshness

Market data freshness metrics including oldest data age, stale platform count, and platforms with old data.

**Use case:** Quick health check for market data quality, alerting on stale data.

**Response:**

```json
{
  "success": true,
  "freshness": {
    "oldestDataAge": 65.5,
    "stalePlatformCount": 2,
    "averageDataAge": 8.3,
    "platformsWithOldData": [
      "EnergySwap",
      "TronRental"
    ]
  }
}
```

**Field descriptions:**

- `oldestDataAge` - Age of oldest platform data in minutes (null if no platforms)
- `stalePlatformCount` - Number of platforms with data older than 10 minutes
- `averageDataAge` - Average age of all platform data in minutes
- `platformsWithOldData` - Array of platform names with data older than 60 minutes

**Example usage (curl):**

```bash
curl -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/markets/freshness
```

**Example usage (alert if data too old):**

```bash
# Alert if any platform has data older than 60 minutes
OLDEST=$(curl -s -H "X-Admin-Token: $TOKEN" \
  http://localhost:4000/api/admin/system/markets/freshness \
  | jq '.freshness.oldestDataAge')

if (( $(echo "$OLDEST > 60" | bc -l) )); then
  echo "WARNING: Market data is stale (${OLDEST} minutes old)"
fi
```

#### POST /markets/refresh

Manually trigger market data refresh for all platforms. Does not wait for completion (async operation).

**Use case:** Force immediate refresh after detecting stale data, recover from temporary outages.

**Request body (optional):**

```json
{
  "force": true
}
```

**Body fields:**

- `force` (boolean, optional) - If `true`, bypasses cache and forces fresh fetch from all platforms

**Response:**

```json
{
  "success": true,
  "message": "Market refresh triggered"
}
```

**Example usage (normal refresh):**

```bash
curl -X POST \
  -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/markets/refresh
```

**Example usage (force refresh, bypass cache):**

```bash
curl -X POST \
  -H "X-Admin-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{"force": true}' \
  http://localhost:4000/api/admin/system/markets/refresh
```

**Example usage (JavaScript):**

```javascript
// Force refresh all markets
await fetch('http://localhost:4000/api/admin/system/markets/refresh', {
  method: 'POST',
  headers: {
    'X-Admin-Token': token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ force: true })
});
console.log('Market refresh triggered');
```

### System Health

#### GET /health/database

MongoDB connection status, response time, and database size metrics.

**Use case:** Monitoring database connectivity, tracking database growth, diagnosing connection issues.

**Response:**

```json
{
  "success": true,
  "status": {
    "connected": true,
    "responseTime": 12,
    "poolSize": 10,
    "availableConnections": 10,
    "databaseSize": 12345678,
    "collectionCount": 15,
    "recentErrors": []
  }
}
```

**Field descriptions:**

- `connected` - Whether MongoDB connection is active
- `responseTime` - Ping response time in milliseconds (null if not connected)
- `poolSize` - Total connection pool size (default: 10)
- `availableConnections` - Available connections in pool (simplified, always equals poolSize)
- `databaseSize` - Total database size in bytes (null if unavailable)
- `collectionCount` - Number of collections in database
- `recentErrors` - Array of recent database errors (currently always empty)

**Example usage (curl):**

```bash
curl -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/health/database
```

**Example usage (check connection):**

```javascript
const response = await fetch('http://localhost:4000/api/admin/system/health/database', {
  headers: { 'X-Admin-Token': token }
});
const { status } = await response.json();
if (!status.connected) {
  console.error('Database connection lost!');
}
```

#### GET /health/redis

Redis connection status, response time, memory usage, and key count.

**Use case:** Monitoring Redis connectivity, tracking memory usage, detecting evictions.

**Response:**

```json
{
  "success": true,
  "status": {
    "connected": true,
    "responseTime": 2,
    "memoryUsage": 2048576,
    "keyCount": 45,
    "evictions": 0,
    "hitRate": null
  }
}
```

**Field descriptions:**

- `connected` - Whether Redis connection is active
- `responseTime` - Ping response time in milliseconds (null if not connected)
- `memoryUsage` - Redis memory usage in bytes (null if unavailable)
- `keyCount` - Total number of keys in Redis database
- `evictions` - Total evicted keys (indicates memory pressure)
- `hitRate` - Cache hit rate percentage (currently always null)

**Example usage (curl):**

```bash
curl -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/health/redis
```

**Example usage (monitor evictions):**

```javascript
const response = await fetch('http://localhost:4000/api/admin/system/health/redis', {
  headers: { 'X-Admin-Token': token }
});
const { status } = await response.json();
if (status.evictions > 0) {
  console.warn(`Redis evictions detected: ${status.evictions}`);
}
```

#### GET /health/server

Backend server metrics including uptime, memory usage, and CPU utilization.

**Use case:** Monitoring server resource usage, detecting memory leaks, tracking uptime.

**Response:**

```json
{
  "success": true,
  "metrics": {
    "uptime": 86400,
    "memoryUsage": {
      "heapUsed": 52428800,
      "heapTotal": 83886080,
      "rss": 104857600,
      "external": 1048576
    },
    "cpuUsage": 12.5,
    "activeConnections": 0,
    "requestRate": null,
    "errorRate": null
  }
}
```

**Field descriptions:**

- `uptime` - Server uptime in seconds
- `memoryUsage` - Node.js memory usage:
  - `heapUsed` - Used heap memory in bytes
  - `heapTotal` - Total heap memory allocated in bytes
  - `rss` - Resident set size (total memory) in bytes
  - `external` - Memory used by C++ objects bound to JavaScript in bytes
- `cpuUsage` - CPU usage percentage (averaged across all cores)
- `activeConnections` - Active HTTP connections (currently always 0)
- `requestRate` - Requests per second (currently always null)
- `errorRate` - Errors per second (currently always null)

**Example usage (curl):**

```bash
curl -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/health/server
```

**Example usage (check memory usage):**

```bash
# Alert if heap usage exceeds 1GB
HEAP=$(curl -s -H "X-Admin-Token: $TOKEN" \
  http://localhost:4000/api/admin/system/health/server \
  | jq '.metrics.memoryUsage.heapUsed')

if [ $HEAP -gt 1073741824 ]; then
  echo "WARNING: High memory usage: $(($HEAP / 1024 / 1024))MB"
fi
```

### Configuration

#### GET /config

Current system configuration including environment, feature flags, thresholds, limits, and integration status.

**Use case:** Verifying environment settings, checking which features are enabled, confirming integrations.

**Response:**

```json
{
  "success": true,
  "config": {
    "environment": "production",
    "port": 4000,
    "features": {
      "scheduler": true,
      "websockets": true,
      "telemetry": false
    },
    "thresholds": {
      "delegationAmountTRX": 100000000000,
      "stakeAmountTRX": 10000000000
    },
    "limits": {
      "commentsDailyLimit": 10,
      "chatDailyLimit": 50
    },
    "integrations": {
      "hasTronGridKey": true,
      "hasTelegramBot": false,
      "hasStorageConfigured": false
    }
  }
}
```

**Field descriptions:**

- `environment` - Node environment (`development` or `production`)
- `port` - Backend server port
- `features` - Feature flags:
  - `scheduler` - Whether scheduler is enabled (`ENABLE_SCHEDULER`)
  - `websockets` - Whether WebSockets are enabled (`ENABLE_WEBSOCKETS`)
  - `telemetry` - Whether telemetry is enabled (`ENABLE_TELEMETRY`)
- `thresholds` - Operational thresholds:
  - `delegationAmountTRX` - Minimum TRX for "large delegation" (in sun, 1 TRX = 1,000,000 sun)
  - `stakeAmountTRX` - Minimum TRX for "large stake" (in sun)
- `limits` - Rate limits:
  - `commentsDailyLimit` - Max comments per user per day
  - `chatDailyLimit` - Max chat messages per user per day
- `integrations` - Integration status (boolean flags):
  - `hasTronGridKey` - Whether `TRONGRID_API_KEY` is configured
  - `hasTelegramBot` - Whether `TELEGRAM_BOT_TOKEN` is configured
  - `hasStorageConfigured` - Whether storage credentials are configured

**Example usage (curl):**

```bash
curl -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/config
```

**Example usage (verify integrations):**

```javascript
const response = await fetch('http://localhost:4000/api/admin/system/config', {
  headers: { 'X-Admin-Token': token }
});
const { config } = await response.json();

if (!config.integrations.hasTronGridKey) {
  console.error('TronGrid API key not configured!');
}
if (!config.features.scheduler) {
  console.warn('Scheduler is disabled');
}
```

### WebSocket Monitoring

#### GET /websockets/stats

Statistics for all plugin WebSocket subscriptions including active connections and message counts.

**Use case:** Monitoring WebSocket health, tracking active subscriptions, identifying connection issues.

**Response:**

```json
{
  "success": true,
  "stats": {
    "whale-alerts": {
      "pluginId": "whale-alerts",
      "activeConnections": 5,
      "totalMessagesSent": 1234,
      "errorCount": 0,
      "lastActivity": "2025-10-16T14:25:00.000Z"
    },
    "delegations": {
      "pluginId": "delegations",
      "activeConnections": 3,
      "totalMessagesSent": 567,
      "errorCount": 2,
      "lastActivity": "2025-10-16T14:24:30.000Z"
    }
  }
}
```

**Field descriptions:**

- Object keys are plugin IDs
- Each value contains:
  - `pluginId` - Plugin identifier
  - `activeConnections` - Number of active WebSocket connections for this plugin
  - `totalMessagesSent` - Total messages sent since server start
  - `errorCount` - Total errors encountered
  - `lastActivity` - ISO timestamp of most recent message or connection

**Example usage (curl):**

```bash
curl -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/websockets/stats
```

#### GET /websockets/aggregate

Aggregated WebSocket statistics across all plugins.

**Use case:** High-level WebSocket health check, dashboard summary.

**Response:**

```json
{
  "success": true,
  "aggregate": {
    "totalPlugins": 2,
    "totalConnections": 8,
    "totalMessagesSent": 1801,
    "totalErrors": 2,
    "lastActivity": "2025-10-16T14:25:00.000Z"
  }
}
```

**Field descriptions:**

- `totalPlugins` - Number of plugins with WebSocket capabilities
- `totalConnections` - Total active connections across all plugins
- `totalMessagesSent` - Total messages sent across all plugins
- `totalErrors` - Total errors across all plugins
- `lastActivity` - Most recent activity timestamp across all plugins

**Example usage (curl):**

```bash
curl -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/websockets/aggregate
```

#### GET /websockets/plugin/:pluginId

WebSocket statistics for a specific plugin.

**Use case:** Debugging plugin-specific WebSocket issues, monitoring individual plugin health.

**URL parameters:**

- `:pluginId` - Plugin identifier (e.g., `whale-alerts`, `delegations`)

**Response (success):**

```json
{
  "success": true,
  "stats": {
    "pluginId": "whale-alerts",
    "activeConnections": 5,
    "totalMessagesSent": 1234,
    "errorCount": 0,
    "lastActivity": "2025-10-16T14:25:00.000Z"
  }
}
```

**Response (plugin not found - 404):**

```json
{
  "success": false,
  "error": "Plugin whale-alerts not found or does not have WebSocket capabilities"
}
```

**Example usage (curl):**

```bash
curl -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/websockets/plugin/whale-alerts
```

**Example usage (JavaScript - check plugin):**

```javascript
const pluginId = 'whale-alerts';
const response = await fetch(`http://localhost:4000/api/admin/system/websockets/plugin/${pluginId}`, {
  headers: { 'X-Admin-Token': token }
});

if (!response.ok) {
  console.error(`Plugin ${pluginId} not found or has no WebSocket support`);
} else {
  const { stats } = await response.json();
  console.log(`Active connections: ${stats.activeConnections}`);
}
```

---

## Part 4: WebSocket Events & Real-Time Subscriptions

TronRelic uses Socket.IO for real-time bidirectional communication. All WebSocket events are broadcast to specific rooms based on subscription filters.

### Connection and Subscription

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

**Subscribe to events:**

TronRelic supports three subscription formats:

1. **New room-based format** (recommended for plugins):

```javascript
socket.emit('subscribe', 'plugin-id', 'room-name', { options });
```

2. **Legacy plugin format**:

```javascript
socket.emit('subscribe', 'plugin-id', { options });
```

3. **Legacy object format** (core subscriptions):

```javascript
socket.emit('subscribe', {
  markets: { all: true, markets: ['tronsave', 'energyswap'] },
  transactions: { minAmount: 1000000, addresses: ['TXyz...'] },
  comments: { resourceId: 'abc123...' },
  chat: true,
  notifications: { wallet: 'TXyz...' }
});
```

**Unsubscribe from events:**

```javascript
// New format
socket.emit('unsubscribe', 'plugin-id', 'room-name');

// Legacy format
socket.emit('unsubscribe', {
  markets: { all: true },
  transactions: true
});
```

### Core WebSocket Events

#### market:update

Emitted when market data is refreshed for a platform.

**Rooms:** `markets:all`, `markets:{guid}`

**Payload:**

```json
{
  "guid": "tronsave",
  "name": "TronSave",
  "pricing": {
    "1h": 45.5,
    "1d": 42.0,
    "3d": 40.5
  },
  "reliability": 95.5,
  "lastFetchedAt": "2025-10-16T14:20:00.000Z"
}
```

**Example usage:**

```javascript
// Subscribe to all market updates
socket.emit('subscribe', {
  markets: { all: true }
});

// Listen for updates
socket.on('market:update', (market) => {
  console.log(`${market.name} updated: ${market.pricing['1d']} sun/energy`);
});
```

#### transaction:large

Emitted when a large transaction is processed (above configured threshold).

**Rooms:** `transactions:all`, `transactions:address:{address}`

**Payload:**

```json
{
  "txId": "abc123...",
  "blockNumber": 12345678,
  "timestamp": "2025-10-16T14:25:00.000Z",
  "type": "TransferContract",
  "from": {
    "address": "TXyz...",
    "balance": 1000000000
  },
  "to": {
    "address": "TAbc...",
    "balance": 500000000
  },
  "amountTRX": 5000000.5,
  "amountUSD": 750000.0,
  "energyUsed": 0,
  "energyCostUSD": 0
}
```

**Example usage:**

```javascript
// Subscribe to large transactions (>1M TRX)
socket.emit('subscribe', {
  transactions: { minAmount: 1000000 }
});

socket.on('transaction:large', (tx) => {
  console.log(`Whale alert: ${tx.amountTRX.toLocaleString()} TRX (${tx.amountUSD.toLocaleString()} USD)`);
});
```

**Example usage (watch specific address):**

```javascript
// Subscribe to transactions involving specific address
socket.emit('subscribe', {
  transactions: { addresses: ['TXyz...'] }
});

socket.on('transaction:large', (tx) => {
  console.log(`Transaction involving watched address: ${tx.txId}`);
});
```

#### delegation:new

Emitted when a new resource delegation is processed.

**Rooms:** Same as `transaction:large`

**Payload:** Same structure as `transaction:large`

**Example usage:**

```javascript
socket.emit('subscribe', {
  transactions: { all: true }
});

socket.on('delegation:new', (tx) => {
  console.log(`New delegation: ${tx.amountTRX} TRX energy delegated`);
});
```

#### stake:new

Emitted when a new staking transaction is processed.

**Rooms:** Same as `transaction:large`

**Payload:** Same structure as `transaction:large`

**Example usage:**

```javascript
socket.on('stake:new', (tx) => {
  console.log(`New stake: ${tx.amountTRX} TRX staked for ${tx.resource}`);
});
```

#### block:new

Emitted when a new block is processed and stored.

**Rooms:** Global (broadcast to all connected clients)

**Payload:**

```json
{
  "blockNumber": 12345678,
  "timestamp": "2025-10-16T14:25:00.000Z",
  "stats": {
    "transactionCount": 234,
    "totalVolumeTRX": 1500000.0
  }
}
```

**Example usage:**

```javascript
// No subscription needed, automatically broadcast
socket.on('block:new', (block) => {
  console.log(`New block ${block.blockNumber} with ${block.stats.transactionCount} transactions`);
});
```

#### comments:new

Emitted when a new comment is posted to a thread.

**Rooms:** `comments:{threadId}`

**Payload:**

```json
{
  "threadId": "abc123...",
  "commentId": "comment_123",
  "wallet": "TXyz...",
  "message": "This looks like a legitimate transaction",
  "createdAt": "2025-10-16T14:25:00.000Z"
}
```

**Example usage:**

```javascript
// Subscribe to comments on a specific transaction
socket.emit('subscribe', {
  comments: { resourceId: 'abc123...' }
});

socket.on('comments:new', (comment) => {
  console.log(`New comment from ${comment.wallet}: ${comment.message}`);
});
```

#### chat:update

Emitted when a chat message is created or updated.

**Rooms:** `chat:global`

**Payload:**

```json
{
  "messageId": "msg_123",
  "wallet": "TXyz...",
  "message": "Hello everyone!",
  "updatedAt": "2025-10-16T14:25:00.000Z"
}
```

**Example usage:**

```javascript
// Subscribe to global chat
socket.emit('subscribe', { chat: true });

socket.on('chat:update', (message) => {
  console.log(`${message.wallet}: ${message.message}`);
});
```

#### memo:new

Emitted when a transaction with a memo field is processed.

**Rooms:** `memos:all`

**Payload:**

```json
{
  "txId": "abc123...",
  "memo": "Payment for services",
  "from": "TXyz...",
  "to": "TAbc...",
  "amountTRX": 100.0,
  "timestamp": "2025-10-16T14:25:00.000Z"
}
```

**Example usage:**

```javascript
socket.emit('subscribe', {
  memos: { all: true }
});

socket.on('memo:new', (tx) => {
  console.log(`Transaction with memo: "${tx.memo}"`);
});
```

#### wallet notification events

Emitted when a notification is sent to a specific wallet (address-specific events).

**Rooms:** `notifications:{walletAddress}`

**Payload:** Varies by notification type

**Example usage:**

```javascript
// Subscribe to notifications for a specific wallet
socket.emit('subscribe', {
  notifications: { wallet: 'TXyz...' }
});

socket.on('notification:alert', (notification) => {
  console.log(`Alert for your wallet: ${notification.message}`);
});
```

### Plugin WebSocket Events

Plugins can define custom WebSocket events. Subscription and event names are plugin-specific.

**Example plugin subscription:**

```javascript
// Subscribe to plugin events (new format)
socket.emit('subscribe', 'my-plugin', 'room-name', { filter: 'value' });

// Subscribe to plugin events (legacy format)
socket.emit('subscribe', 'my-plugin', { filter: 'value' });

// Listen for plugin events
socket.on('my-plugin:event', (data) => {
  console.log('Plugin event received:', data);
});
```

See [plugins/plugins-websocket-subscriptions.md](../plugins/plugins-websocket-subscriptions.md) for complete plugin WebSocket documentation.

### Connection Error Handling

**Handle connection errors:**

```javascript
socket.on('connect_error', (error) => {
  console.error('Connection error:', error.message);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
  if (reason === 'io server disconnect') {
    // Server forcibly disconnected, attempt reconnection
    socket.connect();
  }
});

socket.on('reconnect', (attemptNumber) => {
  console.log(`Reconnected after ${attemptNumber} attempts`);
});
```

**Handle subscription errors:**

```javascript
socket.on('subscription:error', (error) => {
  console.error('Subscription failed:', error.message);
});
```

---

## Part 5: Rate Limiting & Performance

### Rate Limits by Endpoint Type

**Public endpoints:**
- Most GET endpoints: No explicit rate limit (rely on caching)
- POST /api/comments: 3 requests/minute per IP
- POST /api/chat: TBD (currently unenforced)

**Admin endpoints:**
- No rate limiting (protected by authentication)

**Scheduler triggers:**
- Market refresh: Every 10 minutes (configurable)
- Blockchain sync: Every 1 minute (configurable)

**TronGrid API (external):**
- Serial requests with 200ms throttle (~5 requests/second)
- Rotating API keys distribute load across multiple accounts
- Queue overflow protection caps pending requests at 100

### Caching Strategies and TTLs

**Short TTL (10-30s):**
- `redis:chat:messages` (10s) - Frequently updated chat data
- `redis:comments:{threadId}` (30s) - Comment threads

**Medium TTL (60-300s):**
- `redis:account:snapshot:{address}` (60s) - Account summaries
- `redis:markets:current` (300s) - Market pricing data

**No cache (live data):**
- `/api/blockchain/transactions/latest` - Always fresh from MongoDB
- `/api/admin/system/*` endpoints - Real-time operational metrics

**Cache invalidation triggers:**
- Market refresh job clears `markets:*` keys
- Comment POST clears `comments:{threadId}` key
- Chat POST clears `chat:messages` key

### Performance Considerations

**Optimize for read-heavy workloads:**
- Redis caching reduces MongoDB query load
- Transaction indexing optimized with compound indexes
- Market data cached and refreshed on schedule

**WebSocket connection limits:**
- No enforced connection limit currently
- Monitor `/api/admin/system/websockets/aggregate` for total connections
- Consider connection limits if memory pressure increases

**MongoDB query optimization:**
- Use `.explain()` to verify index usage
- Monitor slow queries in MongoDB logs
- Consider pagination for large result sets

**Redis memory management:**
- Monitor evictions via `/api/admin/system/health/redis`
- Increase Redis memory limit if evictions occur
- Consider longer TTLs for stable data

---

## Part 6: Quick Reference & Common Patterns

### Authentication Methods by Use Case

**Frontend dashboard (public data):**
```javascript
// No authentication required
const markets = await fetch('http://localhost:4000/api/markets').then(r => r.json());
```

**User actions (comments, chat):**
```javascript
// Requires TronLink wallet signature
const signature = await tronWeb.trx.sign(message);
await fetch('http://localhost:4000/api/comments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ threadId, wallet, message, signature })
});
```

**System monitoring (admin):**
```javascript
// Requires admin token
const overview = await fetch('http://localhost:4000/api/admin/system/overview', {
  headers: { 'X-Admin-Token': process.env.ADMIN_API_TOKEN }
}).then(r => r.json());
```

### Common Operations Across Domains

**Check overall system health:**

```bash
curl -H "X-Admin-Token: $TOKEN" \
  http://localhost:4000/api/admin/system/overview \
  | jq '{
    blockchainHealthy: .overview.blockchain.isHealthy,
    blockchainLag: .overview.blockchain.lag,
    stalePlatforms: .overview.markets.stalePlatformCount,
    dbConnected: .overview.database.connected,
    redisConnected: .overview.redis.connected
  }'
```

**Force immediate data refresh:**

```bash
# Blockchain sync
curl -X POST -H "X-Admin-Token: $TOKEN" \
  http://localhost:4000/api/admin/system/blockchain/sync

# Market refresh
curl -X POST -H "X-Admin-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"force": true}' \
  http://localhost:4000/api/admin/system/markets/refresh
```

**Temporarily disable a scheduler job:**

```bash
curl -X PATCH \
  -H "X-Admin-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' \
  http://localhost:4000/api/admin/system/scheduler/job/markets:refresh
```

**Subscribe to multiple WebSocket events:**

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

### Error Handling Best Practices

**Handle API errors:**

```javascript
async function fetchMarkets() {
  try {
    const response = await fetch('http://localhost:4000/api/markets');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error);
    }
    return data.markets;
  } catch (error) {
    console.error('Failed to fetch markets:', error.message);
    return [];
  }
}
```

**Handle WebSocket reconnection:**

```javascript
const socket = io('http://localhost:4000', {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 20000
});

socket.on('reconnect', () => {
  // Re-subscribe to events after reconnection
  socket.emit('subscribe', {
    transactions: { minAmount: 1000000 }
  });
});
```

**Retry failed requests with exponential backoff:**

```javascript
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;

      // Don't retry client errors (4xx)
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`Client error: ${response.status}`);
      }

      // Retry server errors (5xx) with exponential backoff
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
      }
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
}
```

### Building Custom Integrations

**Health monitoring script:**

```javascript
#!/usr/bin/env node

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN;
const BASE_URL = 'http://localhost:4000/api/admin/system';

async function checkHealth() {
  const response = await fetch(`${BASE_URL}/overview`, {
    headers: { 'X-Admin-Token': ADMIN_TOKEN }
  });
  const { overview } = await response.json();

  const issues = [];

  // Check blockchain lag
  if (overview.blockchain.lag > 100) {
    issues.push(`High blockchain lag: ${overview.blockchain.lag} blocks`);
  }

  // Check market data freshness
  if (overview.markets.stalePlatformCount > 3) {
    issues.push(`Too many stale platforms: ${overview.markets.stalePlatformCount}`);
  }

  // Check database connection
  if (!overview.database.connected) {
    issues.push('Database disconnected');
  }

  // Check Redis connection
  if (!overview.redis.connected) {
    issues.push('Redis disconnected');
  }

  if (issues.length > 0) {
    console.error('ALERT: System health issues detected:');
    issues.forEach(issue => console.error(`  - ${issue}`));
    process.exit(1);
  } else {
    console.log('OK: All systems healthy');
    process.exit(0);
  }
}

checkHealth();
```

**Custom whale alert bot:**

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:4000');

socket.on('connect', () => {
  console.log('Connected to TronRelic');

  // Subscribe to large transactions (>1M TRX)
  socket.emit('subscribe', {
    transactions: { minAmount: 1000000 }
  });
});

socket.on('transaction:large', async (tx) => {
  const alert = `
    Whale Alert!
    Amount: ${tx.amountTRX.toLocaleString()} TRX ($${tx.amountUSD.toLocaleString()})
    From: ${tx.from.address}
    To: ${tx.to.address}
    TX: https://tronscan.org/#/transaction/${tx.txId}
  `;

  console.log(alert);

  // Send to Discord, Telegram, etc.
  await sendNotification(alert);
});

async function sendNotification(message) {
  // Your notification logic here
}
```

---

## Troubleshooting

### Authentication Failures

**Problem:** Getting 401 Unauthorized responses

**Solution:**

1. Verify `ADMIN_API_TOKEN` is set in backend `.env`
2. Confirm you're sending the correct header (`X-Admin-Token` or `Authorization: Bearer`)
3. Check token isn't wrapped in quotes or has whitespace

```bash
# Test authentication
curl -v -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  http://localhost:4000/api/admin/system/config
```

### Scheduler Updates Not Taking Effect

**Problem:** Changing job schedule but behavior doesn't change

**Solution:**

1. Verify scheduler is globally enabled (`ENABLE_SCHEDULER=true`)
2. Check response confirms update succeeded
3. Verify job is enabled (disabled jobs ignore schedule)
4. Wait for next scheduled run (changes don't retroactively trigger)

```bash
# Verify update
curl -X PATCH \
  -H "X-Admin-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"schedule": "*/5 * * * *"}' \
  http://localhost:4000/api/admin/system/scheduler/job/markets:refresh

# Check status confirms change
curl -H "X-Admin-Token: $TOKEN" \
  http://localhost:4000/api/admin/system/scheduler/status \
  | jq '.jobs[] | select(.name == "markets:refresh")'
```

### Endpoints Returning Empty Data

**Problem:** Status endpoints return `null` or empty arrays

**Solution:**

1. Wait for scheduler jobs to run (fresh install may have no data yet)
2. Check scheduler is enabled and jobs are executing
3. Verify database/Redis connectivity
4. Check backend logs for errors during data collection

```bash
# Check scheduler status
curl -H "X-Admin-Token: $TOKEN" \
  http://localhost:4000/api/admin/system/scheduler/status

# Trigger manual sync
curl -X POST -H "X-Admin-Token: $TOKEN" \
  http://localhost:4000/api/admin/system/blockchain/sync
```

### High Response Times

**Problem:** API requests taking multiple seconds

**Solution:**

1. Check database/Redis connection health (`/health/database`, `/health/redis`)
2. Monitor server resources (`/health/server` - check memory, CPU)
3. Verify network connectivity to external services (TronGrid)
4. Check for slow database queries in backend logs

### WebSocket Connection Issues

**Problem:** WebSocket connections drop or fail to reconnect

**Solution:**

1. Enable reconnection in Socket.IO client configuration
2. Check firewall allows WebSocket connections
3. Monitor `/api/admin/system/websockets/aggregate` for error counts
4. Verify `ENABLE_WEBSOCKETS=true` in backend `.env`

```javascript
const socket = io('http://localhost:4000', {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling'] // Fallback to polling if WebSocket fails
});
```

### Rate Limit Errors

**Problem:** Receiving 429 Too Many Requests responses

**Solution:**

1. Reduce request frequency
2. Implement exponential backoff retry logic
3. Use caching to avoid redundant requests
4. For admin endpoints, verify you're not hitting external rate limits (TronGrid)

---

## Related Documentation

- [system-monitoring-dashboard.md](./system-monitoring-dashboard.md) - Web UI for accessing admin endpoints
- [system-scheduler-operations.md](./system-scheduler-operations.md) - Detailed scheduler control and troubleshooting
- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) - Blockchain sync implementation details
- [plugins/plugins-websocket-subscriptions.md](../plugins/plugins-websocket-subscriptions.md) - Plugin WebSocket patterns
- [environment.md](../environment.md) - Environment variable configuration
