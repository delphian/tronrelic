# Blockchain Observer Pattern

This document describes the observer/subscriber pattern implemented in TronRelic's blockchain processing pipeline. The pattern allows multiple independent components to react to blockchain transactions without coupling them to the core processing logic.

## Summary

The observer pattern transforms TronRelic's blockchain processing from a monolithic service into a modular, extensible pipeline. Each observer has a single responsibility, processes transactions independently, and fails safely without affecting the system.

To add new blockchain analysis features:
1. Create a new observer file
2. Extend `BaseObserver`
3. Subscribe to relevant transaction types in the constructor
4. Implement processing logic
5. Self-instantiate at the bottom of the file (optional: add import to `index.ts`)

The pattern provides the foundation for sophisticated blockchain analysis while keeping the codebase maintainable and testable.

## Why We Built This

Previously, all transaction processing logic lived directly inside the blockchain service. As we wanted to add whale detection, delegation tracking, stake monitoring, and other features, the service was becoming increasingly complex with intermingled responsibilities.

The observer pattern solves this by:
- **Separating concerns** - Each observer handles one specific type of analysis or notification
- **Enabling parallel development** - Multiple developers can work on different observers without conflicts
- **Improving testability** - Observers can be tested in isolation
- **Supporting extensibility** - New features can be added by creating new observers without modifying existing code

## Architecture Overview

The pattern consists of three main components:

### 1. Base Observer Class

Every observer extends a base class that provides:
- **Queue management** - Incoming transactions are queued to prevent blocking blockchain processing
- **Overflow protection** - If the queue exceeds 1,000 transactions, it logs an error and clears itself to prevent memory issues
- **Error isolation** - If an observer crashes processing one transaction, it logs the error and continues with the next transaction
- **Fire-and-forget semantics** - Observers process asynchronously and never block the blockchain service

Example structure:
```typescript
import type { IBaseObserver, ITransaction, IObserverStats } from '@tronrelic/types';

export abstract class BaseObserver implements IBaseObserver {
    protected abstract readonly name: string;
    protected abstract process(transaction: ITransaction): Promise<void>;

    public async enqueue(transaction: ITransaction): Promise<void> {
        // Add to queue and start processing if not already running
    }

    public getName(): string {
        return this.name;
    }

    public getStats(): IObserverStats {
        // Return queue depth, processing times, error rates, etc.
    }
}
```

**Important:** Plugins receive `BaseObserver` through dependency injection and should type transaction parameters as `ITransaction` from `@tronrelic/types`. The actual runtime object may be a `ProcessedTransaction` class instance, but plugins should use the interface for type safety.

### 2. Observer Registry

A singleton registry manages all observers and routes transactions to them:
- **Subscription management** - Observers register themselves for specific transaction types
- **Transaction routing** - When a transaction is processed, the registry notifies all subscribed observers
- **Multiple subscribers** - Many observers can subscribe to the same transaction type
- **Independent execution** - Each observer receives transactions independently; one observer's failure doesn't affect others

The registry provides a subscription method:
```typescript
registry.subscribeTransactionType('TransferContract', myObserver);
```

### 3. Concrete Observers

Individual observers implement specific business logic. Each observer:
- Extends the injected `BaseObserver` class received via dependency injection
- Subscribes to transaction types through the injected `observerRegistry`
- Implements the `process()` method for transaction-specific logic
- Has a single, focused responsibility
- Uses factory function pattern to maintain framework independence

## How It Works

### Transaction Flow

1. **Blockchain Service** fetches a block from TronGrid and processes each transaction
2. **Transaction Enrichment** - The service parses raw transaction data, enriches it with USD prices, categorizes it (whale/delegation/stake), and builds a `ProcessedTransaction` instance (implements `ITransaction`)
3. **Observer Notification** - After enrichment but during block processing, the service calls `observerRegistry.notifyTransaction(transaction)`
4. **Registry Routing** - The registry looks up which observers have subscribed to this transaction type
5. **Observer Queuing** - Each matching observer receives the transaction (typed as `ITransaction`) in their internal queue
6. **Async Processing** - Observers process their queues independently and asynchronously
7. **Database Persistence** - The blockchain service continues with database writes and socket events

### Key Timing Detail

Observers are notified **after** a transaction is enriched but **before** it's written to the database. This means:
- Observers receive fully parsed and categorized transaction data (not raw TronGrid responses)
- Observers can perform additional analysis or trigger side effects
- Observer processing happens concurrently with database writes
- If an observer fails, it doesn't affect database persistence or blockchain sync

## Data Model

Observers receive transactions typed as `ITransaction` (from `@tronrelic/types`). The runtime instance is a `ProcessedTransaction` class, but plugins should use the `ITransaction` interface for type annotations to maintain framework independence.

### ITransaction Interface

The transaction object contains:

- **payload** - The full transaction ready for database persistence, including:
  - Transaction ID, block number, timestamp
  - Transaction type (TransferContract, TriggerSmartContract, etc.)
  - From/to addresses with enriched metadata (exchange vs wallet, known names)
  - Amounts in TRX and USD
  - Energy and bandwidth metrics
  - Contract details and parameters
  - Analysis data (whale classification, patterns, clusters)

- **categories** - Boolean flags indicating transaction categories (deprecated, use `ProcessedTransaction` methods instead):
  - `isWhale` - Transaction exceeds whale thresholds
  - `isDelegation` - Resource delegation transaction
  - `isStake` - Freeze/unfreeze balance transaction
  - `isTokenCreation` - New token or contract creation

- **snapshot** - Socket.IO-ready representation for real-time notifications
- **rawValue** - Original contract parameter values from TronGrid
- **info** - Transaction receipt with energy/bandwidth details (may be null)

All addresses are already converted to Base58 format, amounts are calculated in both sun and TRX, and USD conversions are complete. Observers receive model objects, not raw API responses, which abstracts TronGrid and makes future blockchain provider changes easier.

### Type Usage Guidelines

**For plugin observers:**
```typescript
import type { ITransaction } from '@tronrelic/types';

protected async process(transaction: ITransaction): Promise<void> {
    // Use ITransaction interface for type annotations
    const txId = transaction.payload.txId;
    const amount = transaction.payload.amountTRX;
}
```

**ProcessedTransaction class methods:**
The runtime instance is a `ProcessedTransaction` class with additional methods:
- `isDelegation()` - Check if transaction is a delegation
- `isStake()` - Check if transaction is a stake/freeze
- `isTokenCreation()` - Check if transaction creates a token

These methods are preferred over the deprecated `categories` flags. However, since plugins type parameters as `ITransaction`, you may need to check the type or use the categories flags directly.

## Creating a New Observer

Plugin observers use a factory function pattern with dependency injection. This keeps plugins decoupled from backend internals while providing full access to infrastructure services.

### Step 1: Create Observer File

Create a new file in your plugin's backend directory (e.g., `packages/plugins/my-plugin/src/backend/delegation-tracker.observer.ts`).

### Step 2: Implement the Observer Factory

```typescript
import type {
    ITransaction,
    IBaseObserver,
    IObserverRegistry,
    IPluginWebSocketManager,
    ILogger
} from '@tronrelic/types';

/**
 * Create delegation tracker observer with injected dependencies.
 *
 * The factory receives infrastructure services through dependency injection,
 * avoiding direct imports from backend modules and keeping the plugin portable.
 *
 * @param BaseObserver - Base observer class providing queue management and error isolation, needed to extend functionality for delegation tracking
 * @param observerRegistry - Registry for subscribing to specific transaction types, allows this observer to receive relevant blockchain events
 * @param websocket - Plugin-scoped WebSocket manager for room-based event emission with automatic namespacing
 * @param logger - Structured logger scoped to the plugin so delegation logs stay contextualized
 * @returns Instantiated delegation tracker observer ready to process transactions
 */
export function createDelegationTrackerObserver(
    BaseObserver: abstract new (logger: ILogger) => IBaseObserver,
    observerRegistry: IObserverRegistry,
    websocket: IPluginWebSocketManager,
    logger: ILogger
): IBaseObserver {
    const scopedLogger = logger.child({ observer: 'DelegationTrackerObserver' });

    /**
     * Internal observer that tracks delegation and resource management transactions.
     */
    class DelegationTrackerObserver extends BaseObserver {
        protected readonly name = 'DelegationTrackerObserver';
        private readonly websocket: IPluginWebSocketManager;

        constructor() {
            super(scopedLogger);
            this.websocket = websocket;

            // Subscribe to delegation-related transaction types
            observerRegistry.subscribeTransactionType('DelegateResourceContract', this);
            observerRegistry.subscribeTransactionType('UnDelegateResourceContract', this);
        }

        protected async process(transaction: ITransaction): Promise<void> {
            // Your processing logic here
            // - Check transaction properties and categories
            // - Perform calculations or analysis
            // - Write to database if needed
            // - Send notifications via websocketService
            // - Log important events

            // Remember: This should be idempotent and handle errors gracefully
        }
    }

    return new DelegationTrackerObserver();
}
```

**Important:** The factory function receives `BaseObserver` as a parameter, not as an import. This is the actual class constructor injected by the plugin loader, allowing dynamic extension without direct backend dependencies.

### Step 3: Wire Observer in Plugin Init Hook

In your plugin's `src/backend/backend.ts`, call the factory from the `init` hook:

```typescript
import { definePlugin, type IPluginContext } from '@tronrelic/types';
import { myPluginManifest } from '../manifest.js';

export const myPluginBackendPlugin = definePlugin({
    manifest: myPluginManifest,

    init: async (context: IPluginContext) => {
        // Dynamically import the observer factory
        const { createDelegationTrackerObserver } = await import('./delegation-tracker.observer.js');

        const observerLogger = context.logger.child({ observer: 'DelegationTrackerObserver' });

        // Create observer with injected dependencies
        createDelegationTrackerObserver(
            context.BaseObserver,
            context.observerRegistry,
            context.websocket,
            observerLogger
        );

        observerLogger.info(
            { observer: 'DelegationTrackerObserver' },
            'Delegation tracker observer registered'
        );
    }
});
```

**Why this pattern?**
- **Dependency injection** - All infrastructure comes through `IPluginContext`
- **No singleton access** - Observer registry and services are injected, not imported
- **Framework independence** - Plugin only depends on `@tronrelic/types` interfaces
- **Lifecycle control** - Observer instantiates during plugin init, not module load
- **Type safety** - Full TypeScript support through interface contracts
- **Structured logging** - `context.logger` adds plugin metadata automatically so logs are traceable

### Step 4: Test

Your observer will start receiving transactions after the plugin initializes. Check the backend logs to confirm the plugin loaded successfully:

```
{"pluginId":"my-plugin","pluginTitle":"My Plugin","msg":"✓ Initialized plugin"}
```

The observer will automatically process transactions matching its subscriptions.

## Subscription Patterns

Currently, we support transaction type subscriptions:

```typescript
registry.subscribeTransactionType('TransferContract', observer);
```

This is the first pattern we've implemented. Future subscription patterns could include:

- **Amount thresholds** - Only notify for transactions above certain amounts
- **Address patterns** - Watch specific addresses or address types (exchanges, contracts)
- **Contract methods** - Subscribe to specific smart contract method calls
- **Composite filters** - Combine multiple criteria (e.g., large transfers to exchanges)
- **Time windows** - Only receive transactions during specific time periods
- **Block ranges** - Historical processing for specific block ranges

To add new subscription patterns, extend the `ObserverRegistry` class with new `subscribe*` methods following the same pattern as `subscribeTransactionType()`.

## Error Handling

The observer pattern has multiple layers of error protection:

### Queue Overflow Protection
If an observer's queue exceeds 1,000 pending transactions, the base class:
1. Logs an error with observer name and dropped transaction count
2. Clears the entire queue to prevent memory exhaustion
3. Continues accepting new transactions normally

This prevents a slow observer from consuming all system memory.

### Processing Errors
If an observer throws an error while processing a transaction:
1. The error is caught by the base class
2. Logged with observer name, transaction ID, and error details
3. Processing continues with the next queued transaction
4. Other observers are not affected

Observer failures never block blockchain sync or affect other observers.

### Registry Errors
If notifying an observer fails at the registry level:
1. The error is logged with observer name and transaction ID
2. Other observers still receive their notifications
3. Blockchain processing continues normally

### Best Practices
When implementing observers:
- Use try/catch blocks for risky operations
- Log errors with sufficient context (transaction ID, addresses, amounts)
- Don't throw errors for expected conditions (e.g., missing optional data)
- Implement timeouts for external API calls
- Consider retry logic for transient failures

## Performance Considerations

### Queue Processing
Observers process their queues serially (one transaction at a time). This ensures:
- Predictable resource usage
- Deterministic ordering for dependent operations
- Simplified error handling

If an observer needs parallel processing, implement a worker pool inside the `process()` method.

### Memory Usage
Each observer maintains an independent queue in memory. Under normal conditions:
- Queues remain small (< 100 transactions)
- Memory footprint is negligible
- Processing keeps pace with blockchain sync

If blockchain sync is processing 5 blocks/second with 200 transactions/block:
- 1,000 transactions/second are being processed
- Observers should process transactions in < 1ms to keep queues empty
- At 1ms processing time, steady-state queue size is ~1 transaction

The 1,000 transaction queue limit provides a 1-second buffer at peak throughput.

### Database Load
Observers may write to the database. Consider:
- Using bulk operations where possible
- Batching writes instead of one transaction at a time
- Using background jobs for heavy processing
- Implementing rate limiting for external APIs

### Monitoring

The observer pattern includes built-in performance monitoring and statistics tracking. Every observer automatically tracks detailed metrics without requiring any custom code.

#### Per-Observer Statistics

Each observer tracks:
- **Queue depth** - Current number of pending transactions
- **Total processed** - Count of successfully processed transactions
- **Total errors** - Count of failed processing attempts
- **Total dropped** - Count of transactions lost to queue overflow
- **Processing time** - Average, min, and max processing time per transaction
- **Error rate** - Ratio of errors to total transactions
- **Last processed** - Timestamp of most recent successful processing
- **Last error** - Timestamp of most recent error

Access individual observer stats:
```typescript
const registry = ObserverRegistry.getInstance();
const allStats = registry.getAllObserverStats();

// Returns array of IObserverStats:
// [
//   {
//     name: 'WhaleTransactionObserver',
//     queueDepth: 0,
//     totalProcessed: 15234,
//     totalErrors: 3,
//     totalDropped: 0,
//     avgProcessingTimeMs: 2.45,
//     minProcessingTimeMs: 0.12,
//     maxProcessingTimeMs: 156.78,
//     lastProcessedAt: '2025-10-03T12:34:56.789Z',
//     lastErrorAt: '2025-10-03T11:22:33.444Z',
//     errorRate: 0.0002
//   },
//   // ... more observers
// ]
```

#### Aggregate Statistics

Get system-wide metrics across all observers:
```typescript
const aggregate = registry.getAggregateStats();

// Returns:
// {
//   totalObservers: 3,
//   totalProcessed: 45678,
//   totalErrors: 12,
//   totalDropped: 0,
//   totalQueueDepth: 5,
//   avgProcessingTimeMs: 3.21,
//   highestErrorRate: 0.0004,
//   observersWithErrors: 2
// }
```

#### Subscription Statistics

See which observers are subscribed to each transaction type:
```typescript
const subscriptions = registry.getSubscriptionStats();
// Returns: { 'TransferContract': 2, 'DelegateResourceContract': 1 }
```

#### Monitoring Best Practices

- **Alert on queue depth** - If `queueDepth > 100`, the observer may be slow or stuck
- **Track error rates** - If `errorRate > 0.01` (1%), investigate observer logic
- **Monitor dropped transactions** - Any `totalDropped > 0` indicates system overload
- **Watch processing times** - If `avgProcessingTimeMs > 10ms`, consider optimizing
- **Check for stalled observers** - If `lastProcessedAt` is old but transactions are flowing, investigate

These statistics are available in real-time and can be exposed via API endpoints for monitoring dashboards, alerting systems, or debugging tools.

## Example: Whale Transaction Observer

Our first observer demonstrates the pattern:

**Purpose:** Monitor large TRX transfers that exceed whale thresholds

**Subscription:** `TransferContract` transactions only

**Processing:**
1. Check if transaction is categorized as whale activity
2. If not, skip (return early)
3. If yes, log the whale transaction with key details
4. Future: Send push notifications, update dashboards, trigger alerts

**Key Code:**
```typescript
import type { ITransaction } from '@tronrelic/types';

protected async process(transaction: ITransaction): Promise<void> {
    // Check whale threshold (500k TRX in this example)
    const amountTRX = Number(transaction.payload.amountTRX ?? 0);
    if (amountTRX < 500_000) {
        return;
    }

    // Emit whale alert via websocket
    this.websocketService.emit({
        event: 'transaction:large',
        payload: transaction.snapshot
    });
}
```

This example shows the legacy whale-alerts plugin pattern. **For new plugins, use the plugin WebSocket manager instead:**

```typescript
// Modern pattern: Use context.websocket for room-based emission
protected async process(transaction: ITransaction): Promise<void> {
    const amountTRX = Number(transaction.payload.amountTRX ?? 0);
    if (amountTRX < 500_000) {
        return;
    }

    // Emit to plugin-scoped room (automatically namespaced)
    this.websocket.emitToRoom('whale-500000', 'large-transfer', transaction.snapshot);
    // Actual room: 'plugin:whale-alerts:whale-500000'
    // Actual event: 'whale-alerts:large-transfer'
}
```

**Key differences:**
- Uses `ITransaction` type from `@tronrelic/types`
- Checks threshold directly instead of using deprecated `categories` flags
- **New:** Emits to namespaced rooms via `context.websocket` instead of global broadcast
- **New:** Supports multiple subscription thresholds through room-based routing

See **[Plugin WebSocket Subscriptions](./plugins-websocket-subscriptions.md)** for complete subscription management patterns and `packages/plugins/whale-alerts/src/backend/whale-detection.observer.ts` for the updated implementation.
