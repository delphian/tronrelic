# Blockchain Sync Endpoints

Status, throughput, transaction counts, and manual sync trigger for the blockchain sync subsystem. All endpoints require admin auth — see [system-api.md](./system-api.md#authentication).

## Why This Matters

Sync lag is the single most important production signal — every observer, market price, and whale alert depends on the sync staying near the chain tip. `/status` tells operators "are we caught up", `/metrics` tells them "fast enough?", and `POST /sync` lets them poke the job after a degraded TronGrid window without waiting for the next cron tick.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/system/blockchain/status` | Current vs network height, lag, backfill queue, projected catch-up |
| GET | `/admin/system/blockchain/transactions` | Index counts (all-time, today, by type) |
| GET | `/admin/system/blockchain/metrics` | Throughput, success rate, recent errors |
| POST | `/admin/system/blockchain/sync` | Fire-and-forget manual sync trigger |

## Response Reference

### `GET /blockchain/status` — `status` payload

| Field | Type | Notes |
|---|---|---|
| `currentBlock` | number | Last processed |
| `networkBlock` | number | Network tip |
| `lag` | number | Blocks behind |
| `backfillQueueSize` | number | Failed blocks awaiting retry |
| `lastProcessedAt` | string (ISO) | Most recent block timestamp |
| `isHealthy` | boolean | `lag < 100 && backfill < 240` |
| `estimatedCatchUpTime` | number \| null | Minutes until caught up; `null` when already caught up or net rate negative |
| `processingBlocksPerMinute` | number | Our throughput |
| `networkBlocksPerMinute` | number | TRON produces ~20/min |
| `netCatchUpRate` | number | Processing minus network rate; negative = falling behind |

```bash
LAG=$(curl -s -H "X-Admin-Token: $TOKEN" \
    http://localhost:4000/api/admin/system/blockchain/status | jq '.status.lag')
[ "$LAG" -gt 100 ] && echo "ALERT: $LAG blocks behind"
```

### `GET /blockchain/transactions` — `transactions` payload

| Field | Type | Notes |
|---|---|---|
| `totalIndexed` | number | Lifetime |
| `indexedToday` | number | Since UTC midnight |
| `byType` | object | Per-contract counts (currently empty) |

### `GET /blockchain/metrics` — `metrics` payload

| Field | Type | Notes |
|---|---|---|
| `averageBlockProcessingTime` | number | Seconds per block |
| `blocksPerMinute` | number | Throughput |
| `successRate` | number | Percent of blocks processed without error |
| `recentErrors` | array | `{ blockNumber, timestamp, message }` |
| `averageProcessingDelaySeconds` | number | Block-creation → processing latency |
| `projectedCatchUpMinutes` | number \| null | Same semantics as `estimatedCatchUpTime` |

### `POST /blockchain/sync`

Enqueues a sync run. No request body. Returns immediately:

```json
{ "success": true, "message": "Blockchain sync triggered" }
```

```bash
curl -X POST -H "X-Admin-Token: $TOKEN" \
    http://localhost:4000/api/admin/system/blockchain/sync
```

Verify completion via `/status` or the `block:new` WebSocket event.

## Related

- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) — Why sync is serial, throttle math, observer dispatch
- [system-api-scheduler.md](./system-api-scheduler.md) — Disable the recurring `blockchain:sync` job
- [system-api-websockets.md](./system-api-websockets.md) — `block:new` event
