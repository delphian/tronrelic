# Blockchain Sync Architecture

How TronRelic retrieves blocks from TRON, enriches transactions, dispatches them to observers, and persists everything to MongoDB.

## Why This Matters

The sync pipeline controls how blocks reach the database and how observers receive transactions. Misunderstanding the distributed lock, the split between the ingestion and broadcast loops, the three observer types, or the notify-then-persist ordering leads to misdiagnosed stalls, double-processed blocks across instances, dropped transactions, or feature additions that block sync.

## Pipeline Overview

Ingestion and broadcast are two independent loops.

A scheduled `blockchain:sync` job (15-second cron) acquires a Redis lock, fetches up to 60 blocks per invocation from TronGrid, and processes each block through 12 numbered stages — fetch → enrich → notify observers → bulk-write to Mongo → hand to the emitter. That loop never waits on a clock; it runs as fast as the 200ms TronGrid throttle allows and then idles until the next tick. Backfill of missed blocks runs alongside, scanning a 240-block window behind the cursor.

The second loop is `BlockEmitter`, which holds a lead of finished blocks and broadcasts them on its own clock at TRON's 3-second cadence. That lead is the buffer, and it is what covers a slow TronGrid response, a retry, or a late tick. Sources: `src/backend/modules/blockchain/blockchain.service.ts` and `src/backend/modules/blockchain/block-emitter.ts`.

## Block Retrieval

### Distributed Lock

Sync acquires a Redis lock at `${REDIS_NAMESPACE}:locks:blockchain-sync` with a 14-second TTL before processing. This prevents concurrent syncs across multiple backend instances or scheduler restarts — without it, two workers would race to advance the same cursor and double-write transactions.

The TTL is sized just under the sync cron period so the lock always self-releases before the next tick, even when a run dies without reaching its release. **Change it whenever you change the schedule.** A TTL longer than the period silently skips ticks, and one much shorter lets two runs overlap.

### Per-Tick Batch

`blockchainConfig.batchSize = 60` caps how many blocks process in one scheduler invocation. At a 15-second tick the chain produces about five blocks, so the cap is headroom for catching up after a stall rather than a steady-state limit.

### Live Tip Reserve

The forward walk stops at the **live tip**, which is the chain head minus `liveTipReserveBlocks` (`BLOCKCHAIN_LIVE_TIP_RESERVE_BLOCKS`). That reserve is **0 by default**, so the live tip is normally the head itself.

It defaults to zero because holding the cursor back does not buffer any work, which is worth stating plainly since it is an intuitive thing to expect. Each tick enqueues every block from the cursor up to the target, so the batch is always exactly the chain's production over one tick, whatever the reserve is set to. Raising it only settles the cursor that many blocks lower. Queue depth still falls to zero at the tick boundary, and the held-back blocks have no queued job, so they cannot cover a late tick. The one guaranteed effect is latency.

The buffer that does hold already-fetched blocks is the emitter's, described under [Broadcast Buffering](#broadcast-buffering) below. Leave this reserve at zero unless a deployment wants deliberate distance from a tip its provider serves inconsistently, and keep it well below `liveChainThrottleBlocks`, because the lag it adds counts toward the block age that decides how a block is classified.

Two consequences apply when it is nonzero. The scheduler measures `blocksBehind` against the tip rather than the head, so the dead band below is not shrunk by the reserve. The `lag` figure in the status payload still counts from the raw head, so the deployment reports a lag equal to the reserve rather than zero — which is why the payload echoes `liveTipReserveBlocks` and the `/system` console offsets its amber step by it.

Backfill and parity targets always run up to the raw head, because a block already known to be missing is old work and holding it back would serve no purpose.

### Backfill Window

`maxBackfillPerRun = 240` blocks. Before advancing the main cursor, sync prioritizes the backfill queue — blocks that previously failed processing or arrived out of order — scanning back up to 240 blocks. Gap-free historical coverage is the goal; the cursor only advances once the backfill queue is empty for the window.

### TronGrid API Throttle and Key Rotation

The TronGrid HTTP client (`tron-grid.client.ts`) enforces a **200ms minimum gap between requests** (`REQUEST_THROTTLE_MS`) regardless of which sync stage triggered the call. With three keys configured (`TRONGRID_API_KEY`, `_2`, `_3`), requests round-robin through them; a single populated key uses that key alone. Per-key, this stays well under TronGrid's ~1,000 req/sec ceiling.

### Retry

Block fetches use exponential backoff: `retries: 3, delayMs: 750, factor: 2`. Transient TronGrid 5xx or network errors retry at 750ms → 1500ms → 3000ms before failing the block (which lands it in the backfill queue for the next tick).

### An Unreachable Chain Head Does Not Abort the Tick

A tick opens by asking TronGrid for the chain head, and that one call used to decide everything after it: on failure the tick scheduled nothing, including the backfill queue, which is old work that never needed the head. `resolveChainHead()` now falls back to `meta.lastNetworkHeight` — the height recorded by the previous tick — so repair work continues while the head is unreachable.

This cannot replay a block. The height is only ever the ceiling of the forward walk, which starts at the stored cursor, so a stale ceiling shrinks the batch rather than rewinding it. Two rules in `chain-head.ts` keep that true. The height is used **exactly as recorded and never extrapolated forward**, because a height above the real head would schedule blocks TRON has not produced, each costing six client retries before landing in cooldown as a phantom backfill entry. And the fallback is **refused when there is no usable cursor**, because `getLastProcessedBlock()` seeds a fresh install *from* the height rather than bounding a walk with it — a cold start needs a live head, and waiting one tick costs nothing.

A tick running on a cached height records `meta.lastError` rather than clearing it, and skips the lag warning, since lag measured against a frozen ceiling improves the longer the outage lasts.

## Broadcast Buffering

Finished blocks go to `BlockEmitter`, which holds a lead of them and broadcasts one at a time on its own clock. Sources: `src/backend/modules/blockchain/block-emitter.ts` for the loop, `block-emit-buffer.ts` for the arithmetic, `block-pacer.ts` for the carried deadline.

**The wait is not inside the worker.** It used to be, sitting immediately before the broadcast. The BullMQ worker processes one job at a time, so waiting there blocked the next fetch: the pipeline held no fetched block in reserve, and a slow TronGrid response, a retry, or a late tick went straight to the screen as a gap. Nothing on the backend could cover it. Separating the two loops is what makes a reserve possible at all.

**The lead is built once and rebuilt continuously.** At startup the emitter holds its first `targetDepth` blocks without releasing — that hold is what buys the lead, and without it every arrival finds the previous release already due, goes straight out, and the buffer retains nothing. After a drain it rebuilds by releasing at `refillIntervalMs` (3300ms), slightly slower than the chain produces, so the surplus accumulates back into depth. Releasing at exactly the arrival rate would hold whatever depth it had forever, which is why a buffer without a refill step covers one gap and then runs flat for good.

**The clock is a deadline that carries forward, not a per-release stopwatch.** A stopwatch that resets each time can only add delay: a release running 400ms late still gets a fresh full interval, so the average is never below the block time and is above it whenever anything runs slow. Against a chain producing at exactly three seconds that surplus accumulates until the syncer decides it is behind, dumps its backlog, and starts over — the sawtooth users saw as a feed alternating between stalling and spurting. Debt is capped at `maxPacingDebtBlocks = 3` (`BLOCKCHAIN_MAX_PACING_DEBT_BLOCKS`) so an outage cannot bank unlimited catch-up and release it as a burst.

### Buffer Settings

These five are **runtime configuration, not environment variables**. They are stored on the `system_config` document and edited on the Configuration tab of `/system/system`, where saving applies them to the running feed immediately — no restart, and no container recreate. The defaults below live in `src/backend/config/emit-buffer.ts`, which is also where the accepted range for each field is declared.

They are configured this way because the only reliable evidence that a lead is too small is the underrun count on the console, which is a reading you take from a running deployment. When acting on that reading required editing a `.env` file and recreating the container, the settings were in practice never tuned at all.

| Setting | Default | Meaning |
|---|---|---|
| `emitBufferTargetDepth` | 8 | Lead to hold. Covers a fully missed sync tick plus a skipped chain slot. Zero switches buffering off, which is the behaviour-preserving setting for a staged rollout. |
| `emitBufferCatchupDepth` | 13 | Depth above which the buffer drains at the catch-up interval so a tick's burst does not settle in as permanent latency. |
| `emitBufferMaxDepth` | 40 | Depth above which blocks go out with no wait. At this point latency hurts more than jitter and something upstream is wrong. |
| `emitBufferRefillIntervalMs` | 3300 | Spacing below target. Regains one block of lead per ten released. |
| `emitBufferCatchupIntervalMs` | 2000 | Spacing above the catch-up depth. Mirrors the frontend buffer's own catch-up interval. |

The update endpoint enforces three rules a per-field range cannot express, and rejects the save rather than correcting it: the depths must increase, the refill interval must be longer than one block time, and the catch-up interval must be shorter than one. All three mistakes are otherwise silent — the first leaves the buffer permanently short of its lead, the second lets it cover one gap and then run flat for the life of the process, and the third drains a burst no faster than the chain produces, so the backlog stays. `BlockEmitter` still clamps a non-increasing set of depths on top of that, because a config document can also be edited directly in MongoDB, and the emitter must never be the thing that fails on a bad number.

Applying a change mid-flight needs no special handling beyond cancelling the pending timer, since the release clock reads these values fresh on every decision. A lowered target leaves the buffer above its new catch-up depth, so the surplus drains at the faster interval; a raised target leaves it below, so it refills at the slower one over the following minute. Seeding is not repeated, because stalling the feed to rebuild a lead is exactly what an operator watching the console would read as a broken save.

The lead costs latency, but less than the arrangement it replaced. Paced ingestion stretched each one-minute batch across the whole minute, leaving the feed about twenty blocks behind the chain with nothing held in reserve. Eight blocks of buffer on a 15-second tick puts it roughly eight to twelve blocks behind, with a real reserve.

A block that is not live work is broadcast immediately and never enters the buffer. The buffer is flushed first so the feed cannot run backwards, since a catch-up block is newer than everything held. Spending a live block's three-second slot on a block from the backfill queue is what puts the syncer further behind.

### Which Blocks Get Buffered

The decision is made per block, inside `processBlock`, from the block header's own timestamp — `resolveBlockAgeInBlocks` converts the age into a number of blocks behind the head, and the same dead band below classifies it.

It is deliberately *not* taken from the scheduler's `isCaughtUp` flag. That flag is decided once per tick and then rides along on every job in the batch, so a batch queued while behind stayed classified that way long after it had caught up. The flag is still passed, but only to seed the very first block after a restart, when there is no previous block's classification to fall back on inside the dead band. A header timestamp costs no extra request, never goes stale, and classifies backfill work correctly with no special case.

The two modes are separated by a dead band rather than a single boundary, because one threshold made the syncer flap: a lag hovering on it flipped mode nearly every tick, stuttering the feed and burying real transitions in log noise.

Sync stops buffering only once lag reaches `backfillEntryBlocks = 30` (`BLOCKCHAIN_BACKFILL_ENTRY_BLOCKS`), and starts again only once lag falls to `liveChainThrottleBlocks = 20` (`BLOCKCHAIN_LIVE_CHAIN_THROTTLE_BLOCKS`). Between 21 and 29 blocks behind it holds whichever mode it is already in, so lag oscillating inside the band changes nothing. Entry must stay strictly above the resume value — equal values collapse the band and restore the flapping.

The remembered mode is per-process. After a restart, or when the scheduler lock moves to another instance, a lag inside the band resolves to **behind**: broadcasting immediately costs only smoothness and drives lag straight down to where buffering resumes, whereas assuming "caught up" would buffer a genuinely lagging syncer and let it fall further behind.

### Reading It on `/system`

The Blockchain console reports the two loops separately, because since ingestion stopped pacing itself they say different things.

| Figure | Meaning |
|---|---|
| **Index Lag** | Cursor versus chain head. Near zero almost always, and says nothing about whether the feed is healthy. |
| **Feed Lag** | Last broadcast block versus chain head. The delay a viewer actually experiences. Sits near `targetDepth` by design. |
| **Buffer** | Current depth against target, with the underrun count. |

Both lag figures turn amber at `backfillEntryBlocks`, read from the status payload rather than assumed, offset by whatever that deployment holds back on purpose — the buffer target for feed lag, the live tip reserve for index lag.

**Underruns are the number that matters.** A deployment holding a real lead never drains to zero, so any increase means the feed was exposed to an upstream gap and `targetDepth` is too small for what this deployment's provider actually does. Depth dipping below target on its own is normal; it refills.

### The Frontend Buffers as Well

The backend buffer cannot make the feed perfectly even on its own, because the last mile has its own jitter and a client can reconnect at any time. `SocketBridge` therefore holds arriving `block:new` events in a small playout buffer and releases them to Redux on its own clock: one every 3 seconds normally, every 2 seconds once three or more are waiting, and with no wait at all beyond twelve. The buffer is dropped on unmount, since a remount fetches fresh state from the server.

It holds the first block after a mount for a full interval, which is what gives it any lead at all. That lead covers one missed slot and only rebuilds if arrivals run ahead of the release clock, so it is deliberately kept small — with the backend covering chain holes and tick jitter, growing the client buffer would only add latency on top of the backend's.

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
| 9 | Build the `block:new` event and hand it to `BlockEmitter` — buffered when live, broadcast at once otherwise |
| 10 | (folded into stage 9; the broadcast itself now happens on the emitter's clock) |
| 11 | Alert ingestion (matches transactions against alert rules) |
| 12 | Write the timing breakdown back to sync state |

Stage 3 runs only when receipt fetching is enabled. With it off the stage is skipped, `null` is passed in place of every transaction's receipt, and the block costs exactly one TronGrid call as it always has.

Nothing in the twelve stages waits on a clock. The `total` timing is therefore pure work, where it used to include the broadcast wait and so read as roughly one block period on a healthy block. A total now approaching one block period means ingestion is barely keeping up with production, not that it is pacing itself — which is why the console's amber step on that figure means something different than it did.

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
