# Blockchain Sync Architecture

This document explains how TronRelic retrieves blocks from the TRON network, processes transactions, and notifies observers through the blockchain observer pattern.

## Why This Matters

Understanding the blockchain sync pipeline is critical for:

- **Diagnosing stale data issues** - Knowing the rate limiting strategy helps troubleshoot why transactions appear delayed
- **Adding new transaction analysis features** - The observer pattern lets you react to transactions without modifying core sync logic
- **Tuning performance** - Understanding the retrieval strategy helps optimize for throughput vs. API rate limits
- **Monitoring system health** - The sync status dashboard (`/system`) provides real-time visibility into processing lag

## Architecture Overview

The blockchain sync system consists of three main components:

```
┌──────────────────────────────────────────────────────┐
│ 1. Block Retrieval                                   │
│    TronGrid API → Serial requests, 200ms throttling  │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│ 2. Transaction Enrichment                            │
│    Parse, categorize, add USD prices, energy costs   │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│ 3. Observer Notification                             │
│    Route enriched transactions to subscribed         │
│    observers (whale alerts, delegations, etc.)       │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│ 4. Persistence & Events                              │
│    Write to MongoDB, emit WebSocket events           │
└──────────────────────────────────────────────────────┘
```

## Block Retrieval Strategy

### Why Serial Requests?

TronRelic fetches blocks **serially** (one at a time) rather than in parallel because:

1. **Rate limit preservation** - TronGrid allows ~1,000 requests/second with an API key, but serial requests ensure consistent throughput without burst limits
2. **Queue predictability** - Serial processing makes request ordering deterministic and easier to debug
3. **Backpressure handling** - If a block takes longer to process, the system automatically slows down rather than flooding the network with requests

### Rate Limiting: 200ms Between Requests

Each block retrieval is throttled to a **minimum of 200ms between requests**:

```typescript
// Simplified flow
for (let blockNum = cursor; blockNum < networkHeight; blockNum++) {
    const block = await tronGrid.getBlockByNumber(blockNum);  // API call
    await sleep(200);  // Always wait 200ms before next request
    // Process block transactions...
}
```

**Why 200ms?**
- At 200ms per block: ~5 requests/second sustained
- Network produces ~20 blocks/minute on TRON
- At 5 req/sec: System can catch up to live in ~4 seconds if behind
- Leaves headroom for TronGrid rate limits (1,000 req/sec with key)

### Rotating API Keys

If three TronGrid API keys are configured, requests rotate between them:

```
Request 1 → Key 1
Request 2 → Key 2
Request 3 → Key 3
Request 4 → Key 1 (cycles back)
```

This distributes load and provides fallback if one key hits rate limits.

### Block Overflow Protection

If the system falls behind and blocks accumulate, the sync service:

1. **Monitors queue depth** - Tracks how many blocks are waiting to be processed
2. **Implements backfill strategy** - Prioritizes catching up to the live chain height
3. **Caps queue size** - Prevents unbounded memory growth (default: 100 blocks max pending)
4. **Logs warnings** - Alerts administrators if queue exceeds thresholds

## Transaction Enrichment Pipeline

Once a block is retrieved, each transaction goes through enrichment:

### 1. Parse Raw Transaction

Extract transaction type, parties, amounts, and contract data from the raw block:

```typescript
interface RawTransaction {
    txID: string;
    blockNumber: number;
    timestamp: number;
    contractType: string;  // e.g., "TransferContract"
    contractData: {
        owner_address: string;
        to_address: string;
        amount: number;
    };
}
```

### 2. Categorize by Type

Classify into business categories:

- **TransferContract** → "Transfer" (whale tracking)
- **DelegateResourceContract** → "Delegation" (energy/bandwidth tracking)
- **FreezeBalanceV2Contract** → "Stake" (staking tracking)
- **TriggerSmartContract** → "SmartContract" (contract interactions)

### 3. Calculate USD Value

For each transaction, calculate equivalent USD cost:

```typescript
const usdAmount = transaction.amount * (tronPrice / 1_000_000);
```

The TRON price is fetched from market data (updated every 10 minutes via scheduler).

### 4. Calculate Energy Costs

For transactions that consume energy:

```typescript
const energyCost = contractData.energyUsed;  // From blockchain
const energyPrice = chainParameters.energyPrice;  // Updated every 10 minutes
const energyCostTRX = energyCost * energyPrice / 1_000_000;
```

Chain parameters (energy cost per unit) are fetched periodically from the blockchain via `triggerconstantcontract`.

### 5. Build ProcessedTransaction

Combine all enriched data:

```typescript
interface ProcessedTransaction {
    txID: string;
    blockNumber: number;
    timestamp: Date;
    type: string;  // "Transfer", "Delegation", etc.
    from: string;
    to: string;
    amount: number;
    amountUsd: number;  // Calculated
    energyUsed: number;
    energyCostTrx: number;  // Calculated
    isWhale: boolean;  // Based on whale threshold
    isDelegation: boolean;
    isStaking: boolean;
}
```

## Observer Notification Flow

After enrichment, the transaction is broadcast to all subscribed observers:

### 1. Registry Lookup

The blockchain service queries the observer registry: "Who cares about this transaction type?"

```typescript
const observers = registry.getObserversFor(transaction.type);
// Returns all observers subscribed to this transaction type
```

### 2. Queue Each Observer

Each observer receives the transaction independently:

```typescript
for (const observer of observers) {
    observer.enqueue(transaction);  // Fire-and-forget, async
}
```

**Key property:** Observers process **asynchronously**. The blockchain service does NOT wait for observers to complete before moving to the next block.

### 3. Async Processing

Each observer has its own queue and processes transactions in order:

```typescript
// Observer internal queue processing
while (queue.length > 0) {
    const tx = queue.shift();
    try {
        await this.process(tx);
    } catch (error) {
        logger.error(`Observer ${this.name} failed:`, error);
        // Continue with next transaction (error isolation)
    }
}
```

**Timing guarantee:** Observers are notified **after** enrichment but **before** the transaction is written to MongoDB. This allows observers to validate or transform data before persistence.

### 4. Error Isolation

If one observer crashes:

- ✅ Other observers still receive the transaction
- ✅ Blockchain service continues processing
- ✅ Error is logged but doesn't block sync
- ✅ Next transaction is queued normally

### 5. Queue Overflow Protection

If an observer's queue exceeds 1,000 transactions:

1. Log warning about processing lag
2. Clear queue to prevent memory leak
3. Skip oldest transactions (may lose some data)
4. Continue with incoming transactions

## Blockchain Service Lifecycle

### Startup

1. **Load sync state** - Query MongoDB for last processed block
2. **Fetch network height** - Get current network block number from TronGrid
3. **Calculate lag** - Difference between last processed and current
4. **Start sync loop** - Begin fetching from last processed block + 1

### During Sync

```
while (true) {
    1. Fetch next block from TronGrid (with 200ms throttle)
    2. For each transaction in block:
        a. Parse and enrich
        b. Notify subscribed observers (async)
    3. Save block to MongoDB
    4. Update sync state (cursor = blockNumber)
    5. Emit WebSocket events (if enabled)
    6. Wait 200ms before next block
}
```

### Monitoring

The system tracks and exposes:

- **Current block** - Last processed block number
- **Network block** - Current network height
- **Lag** - Difference between them
- **Processing rate** - Blocks per minute
- **Estimated catch-up time** - Minutes to reach live state
- **Error tracking** - Failed blocks and reasons

Access these metrics via `/system` dashboard or `/api/admin/system/scheduler/status`.

## Performance Characteristics

### Throughput

Under normal conditions:

- **Blocks per minute:** ~3 (200ms per block + processing)
- **Transactions per minute:** ~1,500-3,000 (varies by block fullness)
- **API calls per minute:** ~3 (one per block)

### Scalability

**Bottlenecks:**
1. **API rate limiting** - TronGrid max ~1,000 req/sec, we use ~5 req/sec (high headroom)
2. **Database write speed** - MongoDB can handle thousands of inserts/second
3. **Observer processing** - Each observer runs async independently

**To improve throughput:**
- Increase parallelism (fetch multiple blocks simultaneously) - **not recommended** due to complexity
- Reduce 200ms throttle - **only if** rate limits allow
- Optimize observer logic - process transactions faster

## Fresh Install Optimization

On fresh installation, instead of starting from block 0 (which would take months), TronRelic:

1. Fetches current network height at startup
2. Begins sync from `current - lookbackBlocks` (e.g., 2 weeks ago)
3. Processes recent history to populate initial data
4. Gradually fills in remaining history in background (if configured)

This allows the system to be useful immediately rather than requiring weeks of backfill.

## Related Documentation

- [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) - How to build observers that react to transactions
- [scheduler-operations.md](./scheduler-operations.md) - How the `blockchain:sync` job is scheduled and controlled
- [environment.md](../environment.md) - `ENABLE_SCHEDULER` and `TRONGRID_API_KEY` configuration
- [tron-chain-parameters.md](../tron/tron-chain-parameters.md) - How chain parameters (energy costs) are fetched and cached
