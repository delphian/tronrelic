# Contract Events and Token Transfers

Block sync turns each transaction receipt's event logs into typed facts and delivers them to plugins by subscription. This document covers what core decodes, how a plugin subscribes to it, and what a consumer must check before trusting it.

## Why This Matters

Core used to find token transfers only in call data: the function and arguments the signer asked a contract to run. That sees a direct `transfer` or `transferFrom` call on a token and nothing else. Any token movement that happens inside another contract is invisible, because the signer called that other contract rather than the token. That covers DEX swaps, cross-chain bridges, the batch payout contracts exchanges use, lending protocols, and any wallet contract that moves tokens for its owner.

Every one of those movements emits a `Transfer` event log from the token contract. The event log is what explorers and analytics firms read, and it is only available in the transaction receipt. Core fetches receipts when an operator has switched `fetchBlockReceipts` on (see [Energy and Bandwidth Are Off by Default](./system-blockchain-sync-architecture.md#energy-and-bandwidth-are-off-by-default)).

Decoding belongs in core rather than in one plugin because several plugins read token movement, and each one writing its own decoder, its own call-data fallback, and its own unique key is how the same mistakes get made several times.

## How It Works

The work is split into three layers. Core decodes facts, core delivers them by subscription, and each plugin interprets them for itself.

### Layer 1: Core Decodes Facts

While building each transaction, `resolveTransactionEvents` in `src/backend/modules/blockchain/contract-events.ts` sets three observer-only fields on the payload.

| Field | Type | Contents |
|---|---|---|
| `events` | `IContractEvent[]` | Every log, with the emitting contract as base58, lowercase `topics` and `data`, and an `eventId` of `${txId}:${logIndex}`. No ABI knowledge is applied. |
| `tokenTransfers` | `ITokenTransferEvent[]` | Standard `Transfer(address,address,uint256)` events, decoded. Three topics means TRC20 (`rawAmount` from `data`), four means TRC721 (`tokenId` from the last topic). |
| `internalTransfers` | `IInternalTransfer[]` | TRX and TRC10 moved by contracts, decoded from the receipt's `internal_transactions`. Only entries carrying value. |

Log addresses arrive as 40 hex characters without TRON's `41` prefix, unlike every other address in a TronGrid response; the decoder adds it. Contract-specific events such as USDT `Issue` and `Redeem`, SunSwap `Swap`, and bridge events stay raw in `events` for plugins to decode. Once core decodes one protocol's events it owns all of them, so it stops at the standards.

### The Source Rule

Whether transfers come from logs or from call data is decided **per block**, from `receiptsFetched`, never per transaction.

| Block state | `events` | `tokenTransfers` | `internalTransfers` |
|---|---|---|---|
| Receipts complete | Every log | From logs only, `source: 'log'` | Set, possibly empty |
| Receipts off, failed, or partial | Absent | From call data only, `source: 'calldata'`, and only for a `SUCCESS` call | Absent |

The two sources are never mixed in one list, so there are no duplicates for a plugin to merge and no plugin writes its own fallback. A consumer that needs complete data filters on `source === 'log'`. A reverted transaction emits no logs, so in log mode an entry means the tokens moved; the call-data workaround for a token that returns `false` while the chain reports `SUCCESS` is not needed there. In call-data mode that caveat still applies.

`payload.tokenTransfer`, the single call-data decode, keeps its existing meaning so plugins that read it do not change behaviour without their knowledge. Each plugin moves to `tokenTransfers` or the event subscription in its own change.

### Layer 2: Subscribe by Event, Not by Transaction Type

Following token movement through `subscribeTransactionType('TriggerSmartContract', …)` hands a plugin the chain's busiest transaction type and leaves it to throw nearly all of it away. The observer registry offers an event subscription instead.

```typescript
observerRegistry.subscribeEventsBatch(
    { topic0: TRANSFER_TOPIC, contractAddresses: [USDT_ADDRESS] },
    observer // extends context.BaseEventObserver
);
```

When a block is committed, `BlockCommitter` calls `notifyBlockEvents`, which indexes the block's events once by `topics[0]` and hands each event observer one `IContractEventBatch` holding only its matches. Each match is an `IObservedContractEvent`: the event, the transaction it came from, and the decoded `tokenTransfer` when core recognised it. Calling `subscribeEventsBatch` again for the same observer adds a filter; the observer still gets one batch per block, each event once, in chain order. A malformed signature hash throws at subscription time.

**A gap is delivered, not skipped.** A block whose receipts are incomplete has no events. Every event observer then receives an empty batch with `receiptsFetched: false`, so it can record the gap. Without it, a missing block would look exactly like a block in which nothing matched.

Plugins extend `context.BaseEventObserver` and implement `processEvents(batch)`. It queues up to 100 batches, drops the incoming batch on overflow, and reports the same statistics as the other observer kinds, with `totalProcessed` counting events. The per-plugin facade tracks the subscription, so disabling the plugin revokes it.

### Layer 3: Interpretation Stays in Plugins

Everything that depends on the consumer belongs to the consumer: grouping the legs of a swap, inflow and outflow direction, ignoring an exchange moving its own funds, and thresholds. If two plugins need the same interpretation, one publishes it through the service registry. It does not move into core.

## Storage

The decoded fields are observer-only. `toTransactionWriteFields` in `transaction-write.ts` strips them, along with `tokenTransfer` and `transactionIndex`, because a busy block carries hundreds of logs and MongoDB is the wrong store at that volume. `toSnapshot` copies named fields only, so they do not reach broadcasts either. The raw internal transactions are still stored as `internalTransactions`.

If a consumer needs history for replay, for backfilling a new plugin, or for queries across plugins, the plan is a core-owned append-only ClickHouse table keyed on `eventId`, with a read service in front of it. It is not built yet.

## What Consumers Must Check

- **`receiptsFetched` before reading silence.** Blocks synced before receipts were switched on carry no events and cannot get them back. Absent `events` means unknown, not nothing.
- **`source` before trusting a transfer as proof.** Call-data transfers record what was requested.
- **`eventId` as the unique key.** One transaction can emit several `Transfer` events for the same token, so a `txId`-only unique index silently drops all but one.
- **Idempotency per block.** The backfill queue can deliver a block twice.

## Quick Reference

| Need | Use |
|---|---|
| Every token movement in one transaction | `payload.tokenTransfers` |
| A contract-specific event | `payload.events`, filter on `topics[0]` and `contractAddress` |
| TRX paid out by a contract | `payload.internalTransfers` |
| Follow one token's transfers across the chain | `subscribeEventsBatch({ topic0, contractAddresses }, observer)` with `BaseEventObserver` |
| The raw receipt | `transaction.info` (`ITransactionReceipt`) |
| How many observers follow a signature | `observerRegistry.getEventSubscriptionStats()` |

## Further Reading

- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) — where decoding sits in the prepare and commit loops, and the `receiptsFetched` flag
- [plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) — building observers, including an event observer
- [Blockchain module README](../../src/backend/modules/blockchain/README.md) — the decoder files and their tests
- [Providers Module README](../../src/backend/modules/providers/README.md) — the `fetchBlockReceipts` switch
