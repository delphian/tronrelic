# Blockchain Sync Architecture

How TronRelic retrieves blocks from TRON, enriches transactions, dispatches them to observers, and persists everything to MongoDB.

## Why This Matters

The sync pipeline controls how blocks reach the database and how observers receive transactions. Misunderstanding the distributed lock, broadcast pacing, the three observer types, or the notify-then-persist ordering leads to misdiagnosed stalls, double-processed blocks across instances, dropped transactions, or feature additions that block sync.

## Pipeline Overview

A scheduled `blockchain:sync` job (1-minute cron) acquires a Redis lock, fetches up to 60 blocks per invocation from TronGrid, and processes each block through 12 numbered stages — fetch → enrich → notify observers → bulk-write to Mongo → pace → emit WebSocket events. Live blocks are held just before the broadcast so the feed advances at TRON's 3-second cadence. Backfill of missed blocks runs alongside, scanning a 240-block window behind the cursor. Source: `src/backend/modules/blockchain/blockchain.service.ts`.

## Block Retrieval

### Distributed Lock

Sync acquires a Redis lock at `${REDIS_NAMESPACE}:locks:blockchain-sync` with a 55-second TTL before processing. This prevents concurrent syncs across multiple backend instances or scheduler restarts — without it, two workers would race to advance the same cursor and double-write transactions.

### Per-Tick Batch

`blockchainConfig.batchSize = 60` caps how many blocks process in one scheduler invocation. The scheduler runs every minute, so steady-state throughput tops out at ~60 blocks/min — comfortably above TRON's ~20 blocks/min production rate, leaving headroom to catch up after a stall.

### Live Tip Reserve

The forward cursor stops short of the chain head by `liveTipReserveBlocks = 5` (`BLOCKCHAIN_LIVE_TIP_RESERVE_BLOCKS`) rather than claiming everything up to the tip. Throughout this document, the **live tip** means the head minus that reserve.

Taking every available block empties the work queue the moment sync catches up, so the next slow TronGrid response or late scheduler tick becomes dead air in the live feed with nothing buffered behind it. Leaving five blocks unclaimed keeps roughly fifteen seconds of work permanently in reserve for a hiccup to drain from instead. The cost is latency: every block reaches the frontend five block times after the chain produced it.

Keep the reserve well below `liveChainThrottleBlocks`, because it counts toward the block age that decides whether a block is paced at all.

Two consequences are worth knowing. The scheduler measures `blocksBehind` against the tip rather than the head, so a healthy syncer reads zero blocks behind and the dead band below is not shrunk by the reserve. The `lag` figure in the status payload still counts from the raw head, so a healthy deployment reports a lag equal to the reserve rather than zero — which is why the payload also echoes `liveTipReserveBlocks` and the `/system` console offsets its amber step by it.

Backfill and parity targets are unaffected. Both still run up to the raw head, because a block already known to be missing is old work with nothing to reserve.

### Backfill Window

`maxBackfillPerRun = 240` blocks. Before advancing the main cursor, sync prioritizes the backfill queue — blocks that previously failed processing or arrived out of order — scanning back up to 240 blocks. Gap-free historical coverage is the goal; the cursor only advances once the backfill queue is empty for the window.

### TronGrid API Throttle and Key Rotation

The TronGrid HTTP client (`tron-grid.client.ts`) enforces a **200ms minimum gap between requests** (`REQUEST_THROTTLE_MS`) regardless of which sync stage triggered the call. With three keys configured (`TRONGRID_API_KEY`, `_2`, `_3`), requests round-robin through them; a single populated key uses that key alone. Per-key, this stays well under TronGrid's ~1,000 req/sec ceiling.

### Retry

Block fetches use exponential backoff: `retries: 3, delayMs: 750, factor: 2`. Transient TronGrid 5xx or network errors retry at 750ms → 1500ms → 3000ms before failing the block (which lands it in the backfill queue for the next tick).

## Broadcast Pacing

Live blocks are held immediately **before** the WebSocket broadcast until that broadcast is due. Source: `src/backend/modules/blockchain/block-pacer.ts`.

Two details of that sentence carry the whole design.

**The wait sits before the broadcast, not at the end of the block.** The broadcast is what a viewer sees, so it is the interval worth regulating. Pacing after it regulated the wrong span: the gap between two broadcasts was the leftover wait from one block plus the entire fetch, parse and write cost of the next, so every bit of per-block variance landed straight in the visible gap.

**The wait is measured against a deadline that carries forward, not a per-block stopwatch.** A stopwatch that resets each block can only ever add delay. A block taking 3.4 seconds emits 400ms late and the next still gets a fresh three-second budget, so the average interval is never below three seconds and is above it whenever anything runs slow. Against a chain producing at exactly three seconds, that surplus is lag the syncer never gives back — it accumulates until sync decides it is behind, drops pacing, dumps the backlog in seconds, and starts over. That sawtooth is what users saw as a feed alternating between stalling and spurting. With a carried deadline, a block that overruns shortens the following wait instead, holding the long-run average at exactly one block interval.

How much debt may carry forward is capped at `maxPacingDebtBlocks = 3` (`BLOCKCHAIN_MAX_PACING_DEBT_BLOCKS`). An uncapped deadline left minutes in the past after an outage would release every held-back block at once, which is the burst the pacer exists to prevent. A block processed without pacing clears the carried deadline outright, so the first paced block after a catch-up run starts a fresh cadence from itself rather than working off a debt it did not cause.

A block that is not live work is broadcast as soon as it is ready. Spending a live block's three-second slot on a block from the backfill queue is what puts the syncer further behind.

### Which Blocks Get Paced

The decision is made per block, inside `processBlock`, from the block header's own timestamp — `resolveBlockAgeInBlocks` converts the age into a number of blocks behind the head, and the same dead band below classifies it.

It is deliberately *not* taken from the scheduler's `isCaughtUp` flag. That flag is decided once per tick and then rides along on every job in the batch, up to sixty of them covering three minutes of work, so a batch queued while behind stayed unpaced long after it had caught up. The flag is still passed, but only to seed the very first block after a restart, when there is no previous block's mode to fall back on inside the dead band. A header timestamp costs no extra request, never goes stale, and classifies backfill work correctly with no special case.

The two modes are separated by a dead band rather than a single boundary, because one threshold made the syncer flap: a lag hovering on it flipped mode nearly every tick, stuttering the feed and burying real transitions in log noise.

Sync gives up pacing only once lag reaches `backfillEntryBlocks = 30` (`BLOCKCHAIN_BACKFILL_ENTRY_BLOCKS`), and takes it back only once lag falls to `liveChainThrottleBlocks = 20` (`BLOCKCHAIN_LIVE_CHAIN_THROTTLE_BLOCKS`). Between 21 and 29 blocks behind it holds whichever mode it is already in, so lag oscillating inside the band changes nothing. Entry must stay strictly above the resume value — equal values collapse the band and restore the flapping.

The remembered mode is per-process. After a restart, or when the scheduler lock moves to another instance, a lag inside the band resolves to **behind**: an unpaced block costs only speed and drives lag straight down to where pacing resumes, whereas assuming "caught up" would pace a genuinely lagging syncer at 3s per block and let it fall further behind. The `/system` console draws the same line — the Lag figure and the Overview strip's Chain tile turn amber at that same entry threshold, whatever it is configured to, reading it from the `backfillEntryBlocks` field of the blockchain status payload rather than assuming the default, and offsetting by `liveTipReserveBlocks` because the reported lag counts from the head while the mode boundary counts from the tip.

### The Frontend Buffers as Well

Backend pacing alone cannot make the feed perfectly even, because TRON does not produce blocks on an exact metronome. A super representative that misses its slot leaves a real six-second hole, and no amount of pacing can fill a block that does not exist.

`SocketBridge` therefore holds arriving `block:new` events in a small playout buffer and releases them to Redux on its own clock: one every 3 seconds normally, every 2 seconds once three or more are waiting so a backlog drains rather than adding permanent delay, and with no wait at all beyond twelve. The buffer is dropped on unmount, since a remount fetches fresh state from the server. This costs one block time of extra latency and is what makes the displayed cadence steady rather than merely average-correct.

## Per-Block Pipeline Stages

Each block runs through 12 stages, instrumented for timing:

| Stage | Action |
|---|---|
| 1 | Fetch block from TronGrid (`getblockbynum`) |
| 2 | Get cached TRX/USD price |
| 3 | Fetch the block's transaction receipts (`gettransactioninfobyblocknum`) — **skipped unless an operator has switched it on**; see below |
| 4 | Process transactions loop — parse contract data, build records, call observers, queue Mongo upserts |
| 4b | Flush batch observers, notify block observers with assembled `IBlockData` |
| 5 | Bulk-write transactions to Mongo (`bulkWrite` unordered) |
| 6 | Calculate block statistics (totals by contract type) |
| 7 | Upsert block document |
| 8 | Update sync state cursor (`$max` to advance, `$pull` to clear backfill entry) |
| 9 | Pace the broadcast (live blocks only; recorded as the `pacing` timing) |
| 10 | Emit WebSocket events |
| 11 | Alert ingestion (matches transactions against alert rules) |
| 12 | Write the timing breakdown back to sync state |

Stage 3 runs only when receipt fetching is enabled. With it off the stage is skipped, `null` is passed in place of every transaction's receipt, and the block costs exactly one TronGrid call as it always has.

The cursor advances at stage 8, before the pacing wait, so a crash while a block is held does not cause it to be reprocessed. The `total` timing covers the wait as well as the work, so a cycle duration read from these figures still describes how long the block occupied the worker.

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

## Energy and Bandwidth Are Off by Default

Per-transaction `energy`, `bandwidth`, and `internalTransactions`, and the block totals that sum them (`totalEnergyUsed`, `totalEnergyCost`, `totalBandwidthUsed`), are all populated only when an operator switches receipt fetching on. With it off — the default — `buildTransactionRecord` receives `info=null`, those fields are absent on every transaction, and the block totals are therefore always exactly zero.

The reason it is a switch rather than always-on is cost. The original comment weighed the wrong call, though, and the correction matters:

> Fetching transaction info would require one extra TronGrid call per transaction. A 200-tx block becomes 200 extra requests — at the 200ms client throttle, that's 40 seconds of additional latency per block, easily exceeding the 3-second target.

That is true of `/wallet/gettransactioninfobyid`, which answers for one transaction. `/wallet/gettransactioninfobyblocknum` answers for the whole block in a single call, so the real cost is **one** extra request and one extra 200ms throttle slot per block, whatever the transaction count. It is still off by default because it changes a live deployment's upstream traffic and the shape of the documents it writes, not because the volume is prohibitive.

### Turning It On

The switch is `fetchBlockReceipts` in the `provider:trongrid` config blob, edited from the **Block receipts** control on the TronGrid card at `/system/system?tab=config`. `processBlock` reads it per block, so a change takes effect on the next block with no restart. If the config store cannot be reached the answer is `false`, which is the behaviour every deployment had before the switch existed.

Nothing is backfilled. Blocks indexed while the switch was off keep their zeros, and only blocks synced after it is turned on carry real figures. A receipt list shorter than the block's transaction count is logged as a warning and the missing transactions simply go unenriched, because a partial upstream answer is not a reason to fail an otherwise complete block.

### Consumers Must Check `receiptsFetched`

Because the switch can be toggled and nothing is backfilled, a stored `totalEnergyCost` of `0` is ambiguous on its own: it means either a block that genuinely burned nothing, or a block indexed while receipts were off. Every block therefore carries a `receiptsFetched` boolean saying which.

**Reading any receipt-derived figure without checking that flag is a bug**, because structural zeros will be read as measurements. The four figures it qualifies are `stats.totalEnergyUsed`, `stats.totalEnergyCost`, `stats.totalBandwidthUsed`, and `stats.internalTransactions`, along with each transaction's own `energy`, `bandwidth`, and `internalTransactions`.

It is true only when the data is complete. A block holding no transactions is `true`, since there was nothing to retrieve and zero is the correct answer. A failed or partial fetch is `false`, because an undercount is not a measurement. A missing value means the block was indexed before the field existed and should be read as `false`.

| Surface | Where the flag appears |
|---|---|
| `blocks` collection | `receiptsFetched` on the block document, and so on `GET /api/blockchain/latest` |
| `block:new` WebSocket event | `receiptsFetched` beside `stats` in the payload |
| Block observers | `receiptsFetched` on `IBlockData` |

One field is absent rather than empty for a separate reason. A transaction's `internalTransactions` is omitted when it triggered none, instead of being stored as `[]`, because writing an empty array on every transaction cost about 12 KB per block to record that there was nothing to record. Count a missing value as zero rather than dereferencing it, and use `receiptsFetched` to tell "triggered none" from "never looked".

Chain parameters (`energyPerTrx`, `energyFee`) are fetched separately by `chain-parameters:fetch` (every 10 min) and exposed to the frontend via runtime config. They describe the network, not what a specific transaction consumed, so they are not an alternative to receipts either way.

Full field reference and the guards on the switch: [Providers Module README](../../src/backend/modules/providers/README.md).

## Monitoring

Sync metrics — current block, network block, lag, processing rate, per-stage timings, error counts — surface through `/system` and the admin API. See [system-api-blockchain.md](./system-api-blockchain.md) for endpoints and [system-api-scheduler.md](./system-api-scheduler.md) for the `blockchain:sync` job controls.

## Further Reading

- [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) — building observers (`BaseObserver`, `BaseBatchObserver`, `BaseBlockObserver`)
- [system-scheduler-operations.md](./system-scheduler-operations.md) — how `blockchain:sync` is scheduled and toggled
- [tron-chain-parameters.md](../tron/tron-chain-parameters.md) — chain parameter fetch and caching
- [environment.md](../environment.md) — `ENABLE_SCHEDULER`, `TRONGRID_API_KEY*`, `BLOCK_SYNC_*` env vars
