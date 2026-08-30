# Blockchain

Owns TRON block retrieval and persistence: `TronGridClient` pulls blocks, `transaction-parse.ts` decodes embedded contracts, and `BlockchainService` enriches transactions and notifies observers before writing to MongoDB.

## External provider clients

`TronGridClient` (`tron-grid.client.ts`) is the platform's TronGrid transport: block pulls, account transactions (native / TRC20 / internal), and `getActivatingTransaction()` — which resolves the account that activated an address from its oldest transaction, validating the candidate against the account's `create_time` so a later transfer is never mistaken for the activation. The guard tolerates a one-block (~3000 ms) skew because `create_time` trails the activating tx's confirmed `block_timestamp` by exactly one block even for a genuine activation (`ACTIVATION_CREATE_TIME_SKEW_MS`); a strict comparison would misreport every ordinary wallet as its own origin. Every method shares one rotating-key, 200ms-throttled request queue with live block sync.

`getTransactionInfoByBlockNum(blockNumber)` returns every transaction receipt in a block in one call, which is what makes energy and bandwidth affordable to collect at all — the per-transaction `getTransactionInfo` would cost one request per transaction against that same shared 200ms queue. It answers `[]` rather than throwing on failure, and normalises the empty object TRON returns for a transaction-less block, because its one caller treats receipts as enrichment a block can be written without. Sync calls it only when an operator has enabled `fetchBlockReceipts` on the TronGrid card; see [system-blockchain-sync-architecture.md](../../../../docs/system/system-blockchain-sync-architecture.md#energy-and-bandwidth-are-off-by-default).

A contract-created account is funded by a TVM-level transfer no top-level feed reports. Whenever the top-level path yields no edge — no transactions, a self-owned oldest transaction, or a candidate the `create_time` guard rejected — `getActivatingTransaction()` falls back to `resolveInternalActivator()`, which reads `/internal-transactions` and takes the oldest inbound, non-reverted, value-bearing transfer: same proximity test, `contractType: 'InternalTransaction'`, `txId` set to the parent transaction so explorer links resolve. Without it the climb walled off at every contract-created ancestor and reported a false origin. Null now means unresolvable from both feeds. Budget is two calls per hop, three on the fallback path. Selection logic is pinned by `__tests__/activating-transaction.test.ts`.

`BlockchainService.climbActivationAncestry()` (published on `IBlockchainService`) is the whole-ladder counterpart: it walks `getActivatingTransaction` from an address toward its origin — bounded by `MAX_ACTIVATION_ANCESTRY_DEPTH` (20), cycle-guarded — with an optional per-hop streaming callback and a shared edge cache so a batch of addresses fetches common tails once. The Address Origins tool and plugin discovery-provenance both consume it, so the bounded loop lives here once rather than being re-implemented per caller.

`climbActivationAncestrySteps()` is the same walk as an async generator — one provider lookup per `next()`, returning the finished `IActivationAncestry` when the climb stops. `climbActivationAncestry()` drains it, so there is still exactly one loop. It exists for callers climbing several addresses at once: the Address Origins stream drives one generator per wallet round-robin, so every ladder fills together instead of the last wallet waiting out the earlier ones. The shared `edgeCache` therefore holds the **in-flight promise** per child address, not the resolved edge — interleaved ladders converging on a common ancestor reach it before either lookup settles, and a resolved-value cache would let both fetch and duplicate every remaining call of the shared tail. A rejected lookup is evicted so it stays retryable.

Every ending is reported as `stopReason`: `'unresolved'`, `'depth-cap'`, `'cycle'`, or `'provider-error'`. **`'unresolved'` is not proof of a root** — a climb can only report that it ran out of resolvable activators, never that an account has none, and consumers must not word it as "origin reached". The legacy `originReached` / `truncated` booleans are derived from `stopReason` so existing consumers keep working.

A sibling transport, `TronScanClient`, lives in the [providers module](../providers/README.md) — a distinct provider with its own base URL, key, and rate budget, currently backing the local TRX price series. Reach for TronGrid for chain and account data; use TronScan only where no TronGrid path exists.

## Feed cadence

Ingestion and broadcast are two separate loops. `BlockchainService` fetches, enriches, and writes each block without ever waiting on a clock, then hands the finished `block:new` event to `BlockEmitter`, which holds a lead of them and broadcasts on its own clock.

The split is the point. The wait used to sit inside the BullMQ worker, immediately before the broadcast, and that worker runs one job at a time — so waiting there blocked the next fetch and the pipeline never held a fetched block in reserve. Any upstream hiccup went straight to the feed as a gap, and no configuration could change that.

| File | Answers |
|---|---|
| `block-emitter.ts` | The stateful loop: holds pending blocks in block order, builds the initial lead, releases on a timer, flushes for catch-up blocks and on shutdown, and reports depth and underruns to `/system` |
| `block-emit-buffer.ts` | `resolveReleaseInterval()` — how long to wait before the next release, given depth; `resolveSeedComplete()` — whether the initial lead is built; `insertPendingBlock()` — ordered insert so a late retry cannot make the feed run backwards |
| `block-pacer.ts` | `resolveEmitPacing()` — the carried-forward deadline the emitter releases against; `resolveBlockAgeInBlocks()` — a block's age in blocks, from its own header |
| `sync-mode.ts` | Whether sync treats itself as caught up, using a hysteresis pair so a lag hovering on one boundary cannot flip the mode every block |
| `chain-head.ts` | `resolveCursorBlock()` — read a stored cursor, including the string form older drivers wrote; `resolveCachedHead()` — whether a height recorded by an earlier tick may stand in for a failed head lookup |

Two properties are easy to lose in a rewrite. **Releasing below target must be slower than the chain produces** (`refillIntervalMs` > one block time), or a lead spent on one gap never comes back — that is the known limitation of the frontend playout buffer. And **the deadline carries forward** rather than resetting per release; a per-release stopwatch can only add delay, so the average drifts above the block time and accumulates until the syncer abandons the cadence and dumps a burst.

The five settings shaping that clock are stored configuration, not environment variables. `BlockEmitter.configure(settings)` is the only way in: bootstrap calls it once with the stored values, and the `/system` Configuration tab calls it again on every save, which applies the change to the live feed without a restart. The emitter never reads the database itself — the caller passes the values in, so a test drives it with plain numbers and the class stays free of the config service. `config/emit-buffer.ts` holds the defaults and the accepted range for each field.

`resolveBlockAgeInBlocks()` is what lets each block be classified on its own rather than on a flag the scheduler stamped on the whole batch. A block too old to be live work bypasses the buffer entirely.

## A failed head lookup no longer costs the whole tick

`syncLatestBlocks()` opens by asking TronGrid for the chain head, and that one call used to decide the fate of everything after it. A failure aborted the tick, including the backfill queue — old work that never needed the head. `resolveChainHead()` now falls back to `meta.lastNetworkHeight`, the height the previous tick recorded, so repair work keeps running while the head is unreachable.

The fallback cannot replay a block. The height is only ever the ceiling of the forward walk in `computeBlockTargets()`, which starts at the stored cursor, so a stale ceiling shrinks the batch and can never walk back over covered ground. Two rules hold that line and both are enforced in `chain-head.ts` rather than at the call site. **The height is used exactly as recorded, never extrapolated** — a height above the real head schedules blocks TRON has not produced, and each costs six client retries before landing in cooldown and the backfill queue as a phantom entry. And **the fallback is refused when there is no usable cursor**, because `getLastProcessedBlock()` then seeds the cursor *from* the height instead of bounding a walk with it, which would start the deployment at the wrong block permanently.

A tick that ran on a cached height records `meta.lastError` instead of clearing it, and skips the lag warning, since lag measured against a frozen ceiling improves the longer the head stays unreachable.

Full rationale, settings table, and how to read the two lag figures on `/system`: [system-blockchain-sync-architecture.md](../../../../docs/system/system-blockchain-sync-architecture.md#broadcast-buffering).

## Canonical documentation

- [system-blockchain-sync-architecture.md](../../../../docs/system/system-blockchain-sync-architecture.md) — block retrieval, enrichment pipeline, observer dispatch
- [plugins-blockchain-observers.md](../../../../docs/plugins/plugins-blockchain-observers.md) — building observers that react to transactions this module notifies
