# Blockchain Observer Pattern

How plugins react to TRON transactions: extend the injected `BaseObserver`, subscribe to contract types through `observerRegistry`, process asynchronously without blocking sync.

## Why This Matters

Each blockchain feature (whale detection, delegation tracking, dust scoring) lives in its own observer with single responsibility. Crashes are isolated, queues are bounded, and the blockchain service stays free of feature-specific branching. Skipping the pattern reintroduces the monolithic sync service we already moved away from.

## Architecture

Three components: a `BaseObserver` providing queue/error scaffolding, a singleton `ObserverRegistry` routing transactions, and concrete observers implementing feature logic.

### Base Observer

Injected as a constructor argument in `IPluginContext.BaseObserver` — never imported directly. Provides:

- **Queue** — incoming transactions queue per observer; processing runs asynchronously and never blocks blockchain sync.
- **Overflow protection** — queue cap is 1,000 transactions. On overflow the base class logs an error, clears the queue, and continues accepting new transactions.
- **Error isolation** — exceptions in `process()` are caught, logged with observer name and tx id, and processing continues with the next queued transaction. One observer's failure cannot affect others or block sync.

### Observer Registry

A singleton that manages subscriptions and routes enriched transactions:

```typescript
observerRegistry.subscribeTransactionType('TransferContract', this);
```

Multiple observers may subscribe to the same type. Each receives the transaction independently.

Subscribe during `init()` and nothing else is required: `context.observerRegistry` is a per-plugin facade that records every subscription, so disabling the plugin revokes all of them and stops the observers behind them — queued work is discarded rather than left to drain. Do not subscribe from a request handler or scheduled job; the facade only accepts registrations during the install/enable/init window and throws outside it, because a subscription made later could not be tracked and would survive teardown. Re-enabling re-runs `init()`, so construct observers there rather than reusing an instance across the cycle.

## Transaction Flow and Timing

Blockchain Service fetches a block, parses raw contract data, enriches it (USD pricing, address metadata, energy/bandwidth, whale categorization), and builds a `ProcessedTransaction` (implements `ITransaction`). All of that runs flat out, as fast as the TronGrid rate limit allows, and **writes nothing**.

The prepared block goes into a playout buffer called `BlockEmitter`, which holds a lead — twenty blocks by default — and releases one at TRON's own three-second cadence. That release is where the block is written to the database, and observers are notified immediately after the write, alongside alert ingestion and the core `block:new` broadcast.

Three consequences matter when writing an observer.

Your observer receives a block roughly the buffer depth behind the chain head, about sixty seconds at the default setting, rather than as soon as the block is fetched. The whole deployment sits at that distance, so nothing your observer can read is ahead of it.

The block **already exists in the database** when your observer runs. Anything your observer writes lands at the same height every other surface reports, so a page that reads a core transaction and your plugin's data for it cannot find one without the other.

An observer may be notified about the same block twice. The backfill queue re-processes blocks routinely, so an observer keeping a running total should be idempotent per block. A restart is *not* one of those cases: the buffer holds unwritten blocks, so a lost buffer means those blocks were never committed and never announced, and the next tick fetches them fresh.

Observer failures still cannot affect database writes or block sync. See [system-blockchain-sync-architecture.md](../system/system-blockchain-sync-architecture.md#commit-buffering).

## Data Model

Plugins type the parameter as `ITransaction` from `@/types`. The runtime instance is the `ProcessedTransaction` class, which adds methods (`isDelegation()`, `isStake()`, `isTokenCreation()`) that supersede the deprecated `categories` flags. Use the methods when you have access to the runtime class; otherwise check fields on `payload` directly.

`ITransaction` exposes:

- **payload** — the full persistable transaction: tx id, block, timestamp, type (`TransferContract`, `TriggerSmartContract`, etc.), Base58 from/to addresses with enriched metadata (exchange vs wallet, known names), amounts in TRX/USD, energy/bandwidth, contract details, analysis data
- **snapshot** — Socket.IO-ready representation for real-time emission
- **rawValue** — original contract parameter values from TronGrid
- **info** — transaction receipt with energy/bandwidth (may be null)

To relate two transactions from the same block, use `payload.transactionIndex`, the transaction's position in its block. The chain executes a block in that order, while every transaction in the block shares one timestamp and a batch observer receives the block grouped by transaction type, so neither the timestamp nor arrival order can tell you which ran first. The field is present on transactions delivered by sync and absent on documents read back from the database. See [system-blockchain-sync-architecture.md](../system/system-blockchain-sync-architecture.md#order-within-a-block).

For a TRC20 token transfer, use `payload.tokenTransfer` (`ITokenTransfer`). On a `TriggerSmartContract` the payload's own `to` is the token contract and its TRX amount is the call value, usually zero, so the real recipient and token amount exist only in the call data. Sync decodes standard `transfer` and `transferFrom` calls once into `{ contractAddress, method, from, to, rawAmount }`, where `rawAmount` is a decimal string in the token's smallest units. Do not write your own calldata decoder. The field records the transfer the call requested, not proof that tokens moved. Check `payload.status === 'SUCCESS'` first, because a reverted transfer is still decoded. That check rules out reverts only: a non-standard token that returns `false` instead of reverting also ends as `'SUCCESS'` with nothing moved, and sync cannot detect that without block receipts, which are off by default. To turn `rawAmount` into whole tokens, get the token's decimals once from `context.tronGrid.getTrc20TokenInfo()` (`ITronGridService`). Like `transactionIndex`, the field is observer-only and absent on documents read back from the database.

Addresses arrive Base58, amounts in both SUN and TRX, USD already converted. Observers receive model objects, never raw TronGrid responses — that abstraction enables future provider changes.

## Creating an Observer

Plugin observers are factory functions: receive injected dependencies, return an instance of an internal class extending `BaseObserver`.

```typescript
// src/plugins/trp-<id>/src/backend/delegation-tracker.observer.ts
import type {
    ITransaction,
    IBaseObserver,
    IObserverRegistry,
    IPluginWebSocketManager,
    ISystemLogService
} from '@/types';

export function createDelegationTrackerObserver(
    BaseObserver: abstract new (logger: ISystemLogService) => IBaseObserver,
    observerRegistry: IObserverRegistry,
    websocket: IPluginWebSocketManager,
    logger: ISystemLogService
): IBaseObserver {
    class DelegationTrackerObserver extends BaseObserver {
        protected readonly name = 'DelegationTrackerObserver';
        constructor() {
            super(logger.child({ observer: 'DelegationTrackerObserver' }));
            observerRegistry.subscribeTransactionType('DelegateResourceContract', this);
            observerRegistry.subscribeTransactionType('UnDelegateResourceContract', this);
        }
        protected async process(transaction: ITransaction): Promise<void> {
            // Feature logic. Should be idempotent and tolerate transient failures.
        }
    }
    return new DelegationTrackerObserver();
}
```

Wire it from the plugin's `init` hook using only the injected `IPluginContext`:

```typescript
// src/plugins/trp-<id>/src/backend/backend.ts
export const myPluginBackendPlugin = definePlugin({
    manifest: myPluginManifest,
    init: async (context: IPluginContext) => {
        const { createDelegationTrackerObserver } = await import('./delegation-tracker.observer.js');
        createDelegationTrackerObserver(
            context.BaseObserver,
            context.observerRegistry,
            context.websocket,
            context.logger.child({ observer: 'DelegationTrackerObserver' })
        );
    }
});
```

The factory takes `BaseObserver` as a parameter, not an import — that is what makes plugins independent of backend internals. Subscriptions belong in the constructor so wiring happens at instantiation. ERROR and WARN logs from the scoped logger are automatically persisted to MongoDB (see [system-logging.md](../system/system-logging.md)).

Successful registration logs:

```
{"pluginId":"my-plugin","pluginTitle":"My Plugin","msg":"✓ Initialized plugin"}
```

## WebSocket Emission

The injected `context.websocket` is an `IPluginWebSocketManager` — plugin-scoped with **automatic namespacing**. Room and event names get prefixed at the manager so plugins cannot collide:

```typescript
this.websocket.emitToRoom('whale-500000', 'large-transfer', transaction.snapshot);
// Actual room:  plugin:<plugin-id>:whale-500000
// Actual event: <plugin-id>:large-transfer
```

This enables multiple subscription tiers (e.g., `whale-100000`, `whale-500000`) and isolates plugins from each other's traffic. See [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md) for the full subscription manager API.

## Error Handling

Three protection layers:

- **Queue overflow** — base class logs error with observer name and dropped count, clears the queue, continues accepting transactions. Prevents memory exhaustion from a slow observer.
- **Processing errors** — caught in the base class, logged with observer name, tx id, and error details. Next queued transaction processes normally. Other observers unaffected.
- **Registry errors** — failure to notify one observer is logged; remaining observers still receive the transaction; blockchain processing continues.

In observer code: `try`/`catch` around risky operations, log with context (tx id, addresses, amounts), do not throw on expected-missing data, set timeouts on external API calls.

## Performance

Queues process serially (one tx at a time per observer) for predictable resource usage and deterministic ordering. Memory footprint is negligible under normal load — queues stay near zero when processing keeps pace with sync.

Capacity reference: at 5 blocks/sec × ~200 tx/block = ~1000 tx/sec, an observer must process each transaction in under 1ms to keep its queue empty. The 1,000-transaction cap is roughly a one-second buffer at peak. Heavy work (DB writes, external APIs) belongs in batched/background paths, not the hot `process()` path.

## Monitoring

Every observer auto-tracks metrics. The registry exposes:

```typescript
ObserverRegistry.getInstance().getAllObserverStats();   // IObserverStats[]
ObserverRegistry.getInstance().getAggregateStats();      // system-wide totals
ObserverRegistry.getInstance().getSubscriptionStats();   // { 'TransferContract': 2, ... }
```

Per-observer `IObserverStats` fields: `name`, `queueDepth`, `totalProcessed`, `totalErrors`, `totalDropped`, `avgProcessingTimeMs`, `minProcessingTimeMs`, `maxProcessingTimeMs`, `lastProcessedAt`, `lastErrorAt`, `errorRate`.

Aggregate fields: `totalObservers`, `totalProcessed`, `totalErrors`, `totalDropped`, `totalQueueDepth`, `avgProcessingTimeMs`, `highestErrorRate`, `observersWithErrors`.

Operational thresholds:

- `queueDepth > 100` — observer is slow or stuck
- `errorRate > 0.01` — investigate observer logic
- `totalDropped > 0` — system overload
- `avgProcessingTimeMs > 10` — optimize
- Stale `lastProcessedAt` while transactions flow — observer stalled

## Whale Observer Example

Subscribes to `TransferContract`, filters in `process()`, emits to a namespaced room:

```typescript
protected async process(transaction: ITransaction): Promise<void> {
    const amountTRX = Number(transaction.payload.amountTRX ?? 0);
    if (amountTRX < 500_000) return;

    this.websocket.emitToRoom('whale-500000', 'large-transfer', transaction.snapshot);
}
```

Reference implementation: `src/plugins/trp-whale-alerts/src/backend/`.

## Further Reading

- [plugins.md](./plugins.md) — Plugin lifecycle and extension surfaces
- [plugins-system-architecture.md](./plugins-system-architecture.md) — Manifest, package layout, runtime flow
- [plugins-websocket-subscriptions.md](./plugins-websocket-subscriptions.md) — Namespaced rooms and subscription handlers
- [system-blockchain-sync-architecture.md](../system/system-blockchain-sync-architecture.md) — Block retrieval, enrichment pipeline
- [system-logging.md](../system/system-logging.md) — Pino, MongoDB persistence, log queries
