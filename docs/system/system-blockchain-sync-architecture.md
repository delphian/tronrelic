# Blockchain Sync Architecture

How TronRelic retrieves blocks from TRON, enriches transactions, dispatches them to observers, and persists everything to MongoDB.

## Why This Matters

The sync pipeline controls how blocks reach the database and how observers receive transactions. Misunderstanding the distributed lock, the adaptive throttle, the three observer types, or the notify-then-persist ordering leads to misdiagnosed stalls, double-processed blocks across instances, dropped transactions, or feature additions that block sync.

## Pipeline Overview

A scheduled `blockchain:sync` job (1-minute cron) acquires a Redis lock, fetches up to 60 blocks per invocation from TronGrid, processes each block through 11 numbered stages — fetch → enrich → notify observers → bulk-write to Mongo → emit WebSocket events — and adaptively throttles to a 3-second target interval when caught up to the chain head. Backfill of missed blocks runs alongside, scanning a 240-block window behind the cursor. Source: `src/backend/modules/blockchain/blockchain.service.ts`.

## Block Retrieval

### Distributed Lock

Sync acquires a Redis lock at `${REDIS_NAMESPACE}:locks:blockchain-sync` with a 55-second TTL before processing. This prevents concurrent syncs across multiple backend instances or scheduler restarts — without it, two workers would race to advance the same cursor and double-write transactions.

### Per-Tick Batch

`blockchainConfig.batchSize = 60` caps how many blocks process in one scheduler invocation. The scheduler runs every minute, so steady-state throughput tops out at ~60 blocks/min — comfortably above TRON's ~20 blocks/min production rate, leaving headroom to catch up after a stall.

### Backfill Window

`maxBackfillPerRun = 240` blocks. Before advancing the main cursor, sync prioritizes the backfill queue — blocks that previously failed processing or arrived out of order — scanning back up to 240 blocks. Gap-free historical coverage is the goal; the cursor only advances once the backfill queue is empty for the window.

### TronGrid API Throttle and Key Rotation

The TronGrid HTTP client (`tron-grid.client.ts`) enforces a **200ms minimum gap between requests** (`REQUEST_THROTTLE_MS`) regardless of which sync stage triggered the call. With three keys configured (`TRONGRID_API_KEY`, `_2`, `_3`), requests round-robin through them; a single populated key uses that key alone. Per-key, this stays well under TronGrid's ~1,000 req/sec ceiling.

### Retry

Block fetches use exponential backoff: `retries: 3, delayMs: 750, factor: 2`. Transient TronGrid 5xx or network errors retry at 750ms → 1500ms → 3000ms before failing the block (which lands it in the backfill queue for the next tick).

## Adaptive Block Throttle

After a block finishes processing, sync applies an *adaptive* throttle — not a fixed delay:

- **Caught up** (within `liveChainThrottleBlocks = 20` of network height): targets a 3-second total per block (TRON's native block time). If processing already took ≥3 seconds, no extra wait. If it took 1s, sleeps 2s. This keeps the live feed cadence smooth and predictable on the frontend.
- **Behind** (more than 20 blocks lag): no throttle. Sync runs flat-out, bounded only by the `batchSize=60` ceiling and the 200ms TronGrid request gap.

This replaces an earlier fixed 3-second post-block delay that compounded with processing time and produced 4–5 second intervals.

## Per-Block Pipeline Stages

Each block runs through 11 stages, instrumented for timing:

| Stage | Action |
|---|---|
| 1 | Fetch block from TronGrid (`getblockbynum`) |
| 2 | Get cached TRX/USD price |
| 4 | Process transactions loop — parse contract data, build records, call observers, queue Mongo upserts |
| 4b | Flush batch observers, notify block observers with assembled `IBlockData` |
| 5 | Bulk-write transactions to Mongo (`bulkWrite` unordered) |
| 6 | Calculate block statistics (totals by contract type) |
| 7 | Upsert block document |
| 8 | Update sync state cursor (`$max` to advance, `$pull` to clear backfill entry) |
| 9 | Emit WebSocket events |
| 10 | Alert ingestion (matches transactions against alert rules) |
| 11 | Adaptive throttle (only if caught up) |

Stage 3 is intentionally absent — `null` is passed in place of a transaction-info fetch (see Energy Cost Limitation below).

## Observer Dispatch

Observers receive transactions **before** the bulk-write at stage 5. This ordering lets observers transform or reject data before persistence, and isolates a slow observer from blocking the write — the dispatch is fire-and-forget per observer.

### Three Observer Types

| Base class | Receives | Queue cap | Overflow behavior |
|---|---|---|---|
| `BaseObserver` | Single enriched transaction | 1000 | Logs error and **clears the entire queue** |
| `BaseBatchObserver` | Accumulated batch (one call per block) | 100 batches | Drops the **incoming** batch, logs |
| `BaseBlockObserver` | Whole `IBlockData` (one call per block) | 50 blocks | Drops the **incoming** block, logs |

Each observer runs its own async queue. The blockchain service does not await the queue drain; it awaits only `enqueue()`, which is fast.

### Error Isolation

If `observer.enqueue()` throws, the error is logged with the observer name and tx context, and the loop continues. Other observers still receive the transaction. Sync continues to the next transaction. A crashing observer cannot block sync or starve siblings.

### Persistence Is Unconditional

Every transaction in every block is written to the `transactions` collection regardless of which observers subscribed. Observer subscriptions filter *notifications*, not storage.

## Fresh Install

On first boot with no sync state, the cursor initializes to the **current network height**, not block 0. Indexing starts forward from the live chain tip. There is no automatic historical backfill — at TRON's ~5 blocks/sec produced over years, that would mean weeks of catch-up. Historical data, if needed, requires a separate one-time process or manual cursor seed.

## Energy Cost Limitation

Per-transaction `energyUsed` and `energyCostTrx` fields are always `undefined`. The `buildTransactionRecord` call passes `info=null` deliberately:

> Fetching transaction info would require one extra TronGrid call per transaction. A 200-tx block becomes 200 extra requests — at the 200ms client throttle, that's 40 seconds of additional latency per block, easily exceeding the 3-second target.

Chain parameters (`energyPerTrx`, `energyFee`) *are* fetched periodically by `chain-parameters:fetch` (every 10 min) and exposed to the frontend via runtime config — but they describe the network, not what a specific transaction consumed. If per-tx energy ever becomes essential, the answer is a separate rate-limited pool, not lifting the 200ms throttle.

## Monitoring

Sync metrics — current block, network block, lag, processing rate, per-stage timings, error counts — surface through `/system` and the admin API. See [system-api-blockchain.md](./system-api-blockchain.md) for endpoints and [system-api-scheduler.md](./system-api-scheduler.md) for the `blockchain:sync` job controls.

## Further Reading

- [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) — building observers (`BaseObserver`, `BaseBatchObserver`, `BaseBlockObserver`)
- [system-scheduler-operations.md](./system-scheduler-operations.md) — how `blockchain:sync` is scheduled and toggled
- [tron-chain-parameters.md](../tron/tron-chain-parameters.md) — chain parameter fetch and caching
- [environment.md](../environment.md) — `ENABLE_SCHEDULER`, `TRONGRID_API_KEY*`, `BLOCK_SYNC_*` env vars
