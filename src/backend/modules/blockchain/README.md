# Blockchain

Owns TRON block retrieval and persistence: `TronGridClient` pulls blocks, `transaction-parse.ts` decodes embedded contracts, and `BlockchainService` enriches transactions. Nothing is written during that pass — the block is buffered, and `BlockCommitter` writes it and notifies observers when `BlockEmitter` releases it on the chain's own clock.

## External provider clients

`TronGridClient` (`tron-grid.client.ts`) is the platform's TronGrid transport: block pulls, account transactions (native / TRC20 / internal), and `getActivatingTransaction()` — which resolves the account that activated an address from its oldest transaction, validating the candidate against the account's `create_time` so a later transfer is never mistaken for the activation. The guard tolerates a one-block (~3000 ms) skew because `create_time` trails the activating tx's confirmed `block_timestamp` by exactly one block even for a genuine activation (`ACTIVATION_CREATE_TIME_SKEW_MS`); a strict comparison would misreport every ordinary wallet as its own origin. Every method shares one rotating-key, 200ms-throttled request queue with live block sync.

`getTransactionInfoByBlockNum(blockNumber)` returns every transaction receipt in a block in one call, which is what makes energy and bandwidth affordable to collect at all — the per-transaction `getTransactionInfo` would cost one request per transaction against that same shared 200ms queue. It answers `[]` rather than throwing on failure, and normalises the empty object TRON returns for a transaction-less block, because its one caller treats receipts as enrichment a block can be written without. Sync calls it only when an operator has enabled `fetchBlockReceipts` on the TronGrid card; see [system-blockchain-sync-architecture.md](../../../../docs/system/system-blockchain-sync-architecture.md#energy-and-bandwidth-are-off-by-default).

A contract-created account is funded by a TVM-level transfer no top-level feed reports. Whenever the top-level path yields no edge — no transactions, a self-owned oldest transaction, or a candidate the `create_time` guard rejected — `getActivatingTransaction()` falls back to `resolveInternalActivator()`, which reads `/internal-transactions` and takes the oldest inbound, non-reverted, value-bearing transfer: same proximity test, `contractType: 'InternalTransaction'`, `txId` set to the parent transaction so explorer links resolve. Without it the climb walled off at every contract-created ancestor and reported a false origin. Null now means unresolvable from both feeds. Budget is two calls per hop, three on the fallback path. Selection logic is pinned by `__tests__/activating-transaction.test.ts`.

`BlockchainService.climbActivationAncestry()` (published on `IBlockchainService`) is the whole-ladder counterpart: it walks `getActivatingTransaction` from an address toward its origin — bounded by `MAX_ACTIVATION_ANCESTRY_DEPTH` (20), cycle-guarded — with an optional per-hop streaming callback and a shared edge cache so a batch of addresses fetches common tails once. The Address Origins tool and plugin discovery-provenance both consume it, so the bounded loop lives here once rather than being re-implemented per caller.

`climbActivationAncestrySteps()` is the same walk as an async generator — one provider lookup per `next()`, returning the finished `IActivationAncestry` when the climb stops. `climbActivationAncestry()` drains it, so there is still exactly one loop. It exists for callers climbing several addresses at once: the Address Origins stream drives one generator per wallet round-robin, so every ladder fills together instead of the last wallet waiting out the earlier ones. The shared `edgeCache` therefore holds the **in-flight promise** per child address, not the resolved edge — interleaved ladders converging on a common ancestor reach it before either lookup settles, and a resolved-value cache would let both fetch and duplicate every remaining call of the shared tail. A rejected lookup is evicted so it stays retryable.

Every ending is reported as `stopReason`: `'unresolved'`, `'depth-cap'`, `'cycle'`, or `'provider-error'`. **`'unresolved'` is not proof of a root** — a climb can only report that it ran out of resolvable activators, never that an account has none, and consumers must not word it as "origin reached". The legacy `originReached` / `truncated` booleans are derived from `stopReason` so existing consumers keep working.

A sibling transport, `TronScanClient`, lives in the [providers module](../providers/README.md) — a distinct provider with its own base URL, key, and rate budget, currently backing the local TRX price series. Reach for TronGrid for chain and account data; use TronScan only where no TronGrid path exists.

## Feed cadence

Preparing a block and committing it are two separate loops. `BlockchainService` fetches, enriches, and parses each block without ever waiting on a clock and without writing anything, then hands the result to `BlockEmitter`, which holds a lead of prepared blocks and releases one per slot. A release lands in `BlockCommitter`: write the transactions, write the block, advance the cursor, notify observers, broadcast `block:new`, ingest alerts.

The split is the point, in two ways.

The wait used to sit inside the BullMQ worker, immediately before the broadcast, and that worker runs one job at a time — so waiting there blocked the next fetch and the pipeline never held a fetched block in reserve. Any upstream hiccup went straight to the feed as a gap, and no configuration could change that.

And the buffer holds **unwritten** blocks. A block does not exist at any height until its slot arrives, so the REST endpoints, a server-rendered page, a plugin's own collections, and the live feed all report the same height by construction. Buffering only the broadcast left the API reporting a height the feed had not reached. The cost is that the whole deployment sits about a buffer's depth behind the chain head, uniformly.

**Two heights, and using the wrong one is the easy mistake.** `meta.lastFetchedBlock` is how far fetching has got, including blocks still buffered; `cursor.blockNumber` is how far committing has got. The forward walk and `resolveCaughtUp` use the fetch height — walking from the written cursor would re-enqueue every buffered block each tick, and lag measured from it would report a healthy syncer as permanently a buffer's depth behind. Backfill uses the written cursor, because a buffered block is work in flight, not a hole.

| File | Answers |
|---|---|
| `block-emitter.ts` | The stateful loop: holds prepared blocks in block order, builds the initial lead, releases on a timer, flushes for catch-up blocks, discards on shutdown, and reports depth and underruns to `/system`. Decides *when*, never *what* |
| `block-committer.ts` | What a release does: write transactions, write the block, advance the cursor, then notify observers, broadcast `block:new`, and ingest alerts. Serializes commits through one promise chain. Installed via `BlockEmitter.setCommitSink()` |
| `block-emit-buffer.ts` | `resolveReleaseInterval()` — how long to wait before the next release, given depth; `resolveSeedComplete()` — whether the initial lead is built; `insertPendingBlock()` — ordered insert so a late retry cannot make the feed run backwards |
| `block-pacer.ts` | `resolveEmitPacing()` — the carried-forward deadline the emitter releases against; `resolveBlockAgeInBlocks()` — a block's age in blocks, from its own header |
| `sync-mode.ts` | Whether sync treats itself as caught up, using a hysteresis pair so a lag hovering on one boundary cannot flip the mode every block |
| `chain-head.ts` | `resolveCursorBlock()` — read a stored cursor, including the string form older drivers wrote; `resolveCachedHead()` — whether a height recorded by an earlier tick may stand in for a failed head lookup |

Four properties are easy to lose in a rewrite. **Releasing below target must be slower than the chain produces** (`refillIntervalMs` > one block time), or a lead spent on one gap never comes back. **Releasing above target must be faster** (`drainIntervalMs` < one block time, derived by mirroring the refill interval), or every depth between the target and the catch-up depth is an equilibrium and the bursty arrival pattern parks the buffer at the top of that band for good. **The deadline carries forward** rather than resetting per release; a per-release stopwatch can only add delay, so the average drifts above the block time and accumulates until the syncer abandons the cadence and dumps a burst. But **a deadline that has fallen into the past is discarded when a block arrives at an empty buffer**, because slots missed for want of arrivals are not debt, and repaying them keeps the buffer empty through the whole recovery.

This is the only playout clock in the system. `SocketBridge.tsx` on the frontend used to hold a second one that paced `block:new` into Redux, and it lacked the refill rule above, so any burst left it parked around eleven blocks behind the height this buffer had actually committed. The block ticker then disagreed with every other surface, including plugin displays driven by a block observer. It has been removed, and a frontend buffer must not be reintroduced: a deployment that needs a smoother feed raises `emitBufferTargetDepth` here instead.

The five settings shaping that clock are stored configuration, not environment variables. `BlockEmitter.configure(settings)` is the only way in: bootstrap calls it once with the stored values, and the `/system` Configuration tab calls it again on every save, which applies the change to the live feed without a restart. The emitter never reads the database itself — the caller passes the values in, so a test drives it with plain numbers and the class stays free of the config service. `config/emit-buffer.ts` holds the defaults and the accepted range for each field.

`resolveBlockAgeInBlocks()` is what lets each block be classified on its own rather than on a flag the scheduler stamped on the whole batch. It is evaluated at fetch time, before the block enters the buffer, so the buffer's own wait cannot inflate it. A block too old to be live work bypasses the buffer entirely.

## A restart loses work, not data

The buffer holds unwritten blocks in memory, so a process that stops loses them — and that costs only the refetch. The write is what advances the cursor, so a block that never committed left no trace and the next forward walk fetches it again.

One correction is needed on the way back up: `meta.lastFetchedBlock` was advanced when each block entered the buffer, so it sits above blocks that never landed. `resetFetchHeightToCursor()` runs once at startup and drops it back to the written cursor. A deployment with no recorded fetch height reads it as the cursor, so the first boot after this change needs no special case. Shutdown discards the buffer rather than flushing it, since rushing writes into the moments before `process.exit` would only risk tearing one.

## A failed head lookup no longer costs the whole tick

`syncLatestBlocks()` opens by asking TronGrid for the chain head, and that one call used to decide the fate of everything after it. A failure aborted the tick, including the backfill queue — old work that never needed the head. `resolveChainHead()` now falls back to `meta.lastNetworkHeight`, the height the previous tick recorded, so repair work keeps running while the head is unreachable.

The fallback cannot replay a block. The height is only ever the ceiling of the forward walk in `computeBlockTargets()`, which starts at the stored cursor, so a stale ceiling shrinks the batch and can never walk back over covered ground. Two rules hold that line and both are enforced in `chain-head.ts` rather than at the call site. **The height is used exactly as recorded, never extrapolated** — a height above the real head schedules blocks TRON has not produced, and each costs six client retries before landing in cooldown and the backfill queue as a phantom entry. And **the fallback is refused when there is no usable cursor**, because `getLastProcessedBlock()` then seeds the cursor *from* the height instead of bounding a walk with it, which would start the deployment at the wrong block permanently.

A tick that ran on a cached height records `meta.lastError` instead of clearing it, and skips the lag warning, since lag measured against a frozen ceiling improves the longer the head stays unreachable.

Full rationale, settings table, and how to read the two lag figures on `/system`: [system-blockchain-sync-architecture.md](../../../../docs/system/system-blockchain-sync-architecture.md#commit-buffering).

## Canonical documentation

- [system-blockchain-sync-architecture.md](../../../../docs/system/system-blockchain-sync-architecture.md) — block retrieval, enrichment pipeline, observer dispatch
- [plugins-blockchain-observers.md](../../../../docs/plugins/plugins-blockchain-observers.md) — building observers that react to transactions this module notifies
