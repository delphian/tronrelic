# Blockchain Sync Endpoints

Status, throughput, transaction counts, observer stats, and manual sync trigger for the blockchain sync subsystem. All endpoints require admin auth — see [system-api.md](./system-api.md#authentication).

## Why This Matters

Sync lag is the single most important production signal — every observer and downstream feature depends on the sync staying near the chain tip. `/status` answers "are we caught up", `/metrics` answers "fast enough?", `/observers` answers "is any subscriber dropping data?", and `POST /sync` lets operators poke the job after a degraded TronGrid window without waiting for the next cron tick.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/system/blockchain/status` | Current vs network height, lag, backfill, last error, last per-stage timings |
| GET | `/admin/system/blockchain/transactions` | Index counts (lifetime + stub fields) |
| GET | `/admin/system/blockchain/metrics` | Throughput, success rate, recent errors, catch-up projection |
| GET | `/admin/system/blockchain/observers` | Per-observer queue depth, processed/errors/dropped counts, processing-time stats |
| POST | `/admin/system/blockchain/sync` | Fire-and-forget manual sync trigger |

## Response Reference

### `GET /blockchain/status` — `status` payload

| Field | Type | Notes |
|---|---|---|
| `currentBlock` | number | Last processed |
| `networkBlock` | number | Network tip (or last known if TronGrid unreachable) |
| `lag` | number | Blocks the *index* is behind (`max(0, network - current)`). Near zero almost always, since ingestion no longer paces itself — use `feedLag` to judge the live feed |
| `backfillQueueSize` | number | Failed blocks awaiting retry |
| `lastProcessedAt` | string \| null | ISO timestamp of most recent block |
| `lastProcessedBlockId` | string \| null | Block hash |
| `lastProcessedBlockNumber` | number \| null | |
| `isHealthy` | boolean | `lag < BLOCK_SYNC_MAX_LAG (default 180)` AND `backfillQueueSize < BLOCK_SYNC_MAX_BACKFILL (default 240)` |
| `estimatedCatchUpTime` | number \| null | Minutes until caught up; `null` when already caught up or net rate ≤ 0 |
| `lastError` | object \| string \| null | Most recent sync failure |
| `lastErrorAt` | string \| null | ISO |
| `processingBlocksPerMinute` | number | Our throughput |
| `networkBlocksPerMinute` | number | TRON produces ~20/min |
| `netCatchUpRate` | number | `processing - network` rate; negative = falling behind |
| `averageProcessingDelaySeconds` | number | Block-creation → processed latency |
| `lastTimings` | object \| null | Per-stage timings from the most recent block (stages 1–11; see [sync architecture](./system-blockchain-sync-architecture.md#per-block-pipeline-stages)) |
| `lastTransactionCount` | number \| null | Transactions processed in the last block |
| `liveChainThrottleBlocks` | number | Config echo: lag at or below which sync *resumes* buffering blocks for the feed (default 20). It stops buffering at a higher lag — see the [dead band](./system-blockchain-sync-architecture.md#which-blocks-get-buffered) — so this value alone does not tell you the current mode |
| `backfillEntryBlocks` | number | Config echo: lag at or above which sync *stops* buffering and broadcasts each block as soon as it is ready (default 30). The `/system` console's amber lag step is read from this field |
| `blockIntervalSeconds` | number | Config echo: the block period the emitter releases at (`BLOCKCHAIN_BLOCK_INTERVAL_SECONDS`, default 3). The `/system` console's Pipeline Total warning and danger steps are measured from this field, so a deployment on a different period is judged against its own chain |
| `lastEmittedBlockNumber` | number \| null | Height of the last block actually broadcast. `null` before the first release |
| `feedLag` | number | Blocks between the chain head and the last broadcast block — the delay a viewer experiences. Sits near `emitBufferTargetDepth` by design. Falls back to `lag` before the first release |
| `emitBufferDepth` | number | Blocks the emitter is holding; the lead available to cover an upstream hiccup |
| `emitBufferTargetDepth` | number | Config echo: the lead the emitter aims to hold (default 12). Read from the live emitter rather than from stored configuration, so it reflects a change saved on the Configuration tab immediately |
| `emitBufferSeeded` | boolean | `false` while the emitter is still building its initial lead after a restart |
| `emitBufferUnderruns` | number | Underrun *episodes* since boot. An episode opens when a release empties the buffer and closes only once depth is back at target, so a provider that stays slow reads as one incident rather than one per block. **The number to alert on** — a deployment holding a real lead never reaches zero, so any increase means the feed was exposed to a gap and the target depth is too small |
| `emitBufferUnderrunBlocks` | number | Blocks released while the buffer had no lead left, which is how long the episodes above lasted. Read the two together: three underruns covering four blocks is a provider that hiccups, and three covering nine hundred is one that cannot keep up |

```bash
LAG=$(curl -s -H "X-Admin-Token: $TOKEN" \
    http://localhost:4000/api/admin/system/blockchain/status | jq '.status.lag')
[ "$LAG" -gt 100 ] && echo "ALERT: $LAG blocks behind"
```

### `GET /blockchain/transactions` — `stats` payload

| Field | Type | Notes |
|---|---|---|
| `totalIndexed` | number | Lifetime count via `estimatedDocumentCount()` |
| `indexedToday` | number | **Stub — always 0.** Per-day aggregation is not yet implemented in `getTransactionStats()`. |
| `byType` | object | **Stub — always `{}`.** Per-contract aggregation is not yet implemented. |

Treat `indexedToday` and `byType` as placeholders, not signal — the controller returns hardcoded values regardless of database state.

### `GET /blockchain/metrics` — `metrics` payload

Some fields overlap with `/status` (notably `backfillQueueSize`, `networkBlocksPerMinute`, `netCatchUpRate`) — both endpoints derive from the same snapshot.

| Field | Type | Notes |
|---|---|---|
| `averageBlockProcessingTime` | number | Seconds per block (alias of `averageProcessingDelaySeconds`) |
| `blocksPerMinute` | number | Our throughput |
| `successRate` | number | Percent of blocks processed without error |
| `recentErrors` | array | `{ blockNumber, timestamp, message }` |
| `averageProcessingDelaySeconds` | number | Block-creation → processed latency |
| `averageProcessingIntervalSeconds` | number | Wall-clock interval between processed blocks |
| `networkBlocksPerMinute` | number | TRON's production rate |
| `netCatchUpRate` | number | Processing minus network rate |
| `projectedCatchUpMinutes` | number \| null | Same semantics as `/status.estimatedCatchUpTime` |
| `backfillQueueSize` | number | Duplicated from `/status` for callers who only hit `/metrics` |

### `GET /blockchain/observers` — `observers` array

One entry per registered observer (transaction, batch, and block observers all share the same shape):

| Field | Type | Notes |
|---|---|---|
| `name` | string | Observer identifier |
| `queueDepth` | number | Items waiting to process; rising = falling behind |
| `totalProcessed` | number | Lifetime |
| `totalErrors` | number | Lifetime |
| `totalDropped` | number | Items dropped on overflow (see queue caps in [sync architecture](./system-blockchain-sync-architecture.md#three-observer-types)) |
| `avgProcessingTimeMs` | number | Mean wall-clock per item |
| `minProcessingTimeMs` | number | |
| `maxProcessingTimeMs` | number | |
| `lastProcessedAt` | string \| null | ISO |
| `lastErrorAt` | string \| null | ISO |
| `errorRate` | number | Errors / processed |

```bash
curl -H "X-Admin-Token: $TOKEN" \
    http://localhost:4000/api/admin/system/blockchain/observers \
    | jq '.observers[] | select(.totalDropped > 0 or .queueDepth > 100) | {name, queueDepth, totalDropped}'
```

### `POST /blockchain/sync`

Enqueues a sync run. No request body. Returns immediately with `{ success: true, message: "Blockchain sync triggered" }`. Errors during the async run are swallowed at the controller layer (logged via `console.error`); verify outcome via `/status` or the `block:new` WebSocket event.

```bash
curl -X POST -H "X-Admin-Token: $TOKEN" \
    http://localhost:4000/api/admin/system/blockchain/sync
```

## Further Reading

- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) — Pipeline stages, observer dispatch, adaptive throttle
- [system-api-scheduler.md](./system-api-scheduler.md) — Toggle the recurring `blockchain:sync` job
- [system-api-websockets.md](./system-api-websockets.md) — `block:new` event for completion verification
- [environment.md](../environment.md) — `BLOCK_SYNC_MAX_LAG`, `BLOCK_SYNC_MAX_BACKFILL` overrides for `isHealthy`
