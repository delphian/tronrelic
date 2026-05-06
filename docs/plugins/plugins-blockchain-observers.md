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

## Transaction Flow and Timing

Blockchain Service fetches a block, parses raw contract data, enriches it (USD pricing, address metadata, energy/bandwidth, whale categorization), and builds a `ProcessedTransaction` (implements `ITransaction`). Then it calls `observerRegistry.notifyTransaction(transaction)` — **after enrichment but before the database write**, so observers see fully-parsed data and run concurrently with persistence. Observer failures cannot affect database writes or block sync.

## Data Model

Plugins type the parameter as `ITransaction` from `@/types`. The runtime instance is the `ProcessedTransaction` class, which adds methods (`isDelegation()`, `isStake()`, `isTokenCreation()`) that supersede the deprecated `categories` flags. Use the methods when you have access to the runtime class; otherwise check fields on `payload` directly.

`ITransaction` exposes:

- **payload** — the full persistable transaction: tx id, block, timestamp, type (`TransferContract`, `TriggerSmartContract`, etc.), Base58 from/to addresses with enriched metadata (exchange vs wallet, known names), amounts in TRX/USD, energy/bandwidth, contract details, analysis data
- **snapshot** — Socket.IO-ready representation for real-time emission
- **rawValue** — original contract parameter values from TronGrid
- **info** — transaction receipt with energy/bandwidth (may be null)

Addresses arrive Base58, amounts in both SUN and TRX, USD already converted. Observers receive model objects, never raw TronGrid responses — that abstraction enables future provider changes.

## Creating an Observer

Plugin observers are factory functions: receive injected dependencies, return an instance of an internal class extending `BaseObserver`.

```typescript
// src/plugins/<id>/src/backend/delegation-tracker.observer.ts
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
// src/plugins/<id>/src/backend/backend.ts
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
