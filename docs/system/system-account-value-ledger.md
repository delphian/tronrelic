# Account Value-Transfer Ledger (Proposed)

A normalized, source-independent ledger of on-chain **value movements** for tracked accounts, replacing the overloaded single `account_transactions` table. Status: **proposed** — this document is the design and the staged migration plan; nothing here is built yet.

## Why This Matters

The account-history module stores one flat row per transaction in `account_transactions`, keyed `(account, timestamp, tx_id, source, to_address)`. That single table conflates distinct on-chain entities and cannot represent a transaction that moves value **more than once**. The chain produces exactly that in three places: internal (TVM) transfers (`callValueInfo[]`), `VoteWitnessContract.votes[]`, and a contract paying several recipients in one call. Cramming them into one row causes two concrete failures already seen in production:

- **`amount_sun`-by-type pollution.** `amount_sun` is filled from a *different* on-chain field per contract type (`transaction-parse.ts`): a TRC10 count for `TransferAssetContract`, delegated stake for `Delegate*`. Consumers that summed it as TRX inflated both the valuation balance series and the money-in/out chart. The fix shipped today is a contract-type guard in valuation `toMove` and the flow query — a symptom patch this redesign removes.
- **Contract-deposited TRX is invisible.** TRX a contract sends to the account is an internal transfer, never a `TransferContract` row, so it never appears in the ledger — only the balance snapshot reflects it. Money-in/out and the reconstructed curve silently miss it.

A third risk is forward-looking: the storage must survive a **provider swap** (TronGrid → a self-hosted java-tron node, TronScan, or an archive). The current row shape is close to source-independent, but the design below makes the value identity explicit and protocol-grounded so a swap is a provider reimplementation, not a data migration.

## How TRON Models the Data

TRON — and java-tron's own `TransactionInfo` — separate account data into distinct entities, each a flat projection any provider must satisfy:

| Entity | Grain | Carries |
|--------|-------|---------|
| Top-level (external) transaction | 1 per `tx_id` | One contract type + its params, status, fees, energy/bandwidth |
| Internal transaction | 0..N per `tx_id` | A protocol **hash**, caller, recipient, `callValueInfo[]` = list of `<callValue, tokenId>` (empty `tokenId` = TRX) |
| Event log | 0..N per `tx_id` | Contract address, `topic0-3`, data, `log_index` (where TRC20/721 transfers live) |
| Account state | point-in-time | Balances, staking (frozenV2), delegation, resources, votes |

The error in the current table is modeling all of these as one row type. The redesign mirrors the chain: top-level transactions stay one table, value movements get their own normalized ledger, state stays in the snapshot tables.

## Target Schema

| Table | Grain | Role |
|-------|-------|------|
| `account_transactions` | 1 per `(account, tx_id)` | **Top-level record only** — contract type, status, from/to, fees, energy/bandwidth, contract addr/method. Stops holding value legs. |
| `account_value_transfers` *(new)* | 1 per value leg | The unifying value ledger — every TRX/token movement involving the account, whatever its origin. |
| `account_balance_snapshots` + `account_token_balances` | 1 per `(account, day)` | State over time (unchanged). |
| `account_events` *(future)* | 1 per `(tx_id, log_index)` | Decoded contract logs, when richer attribution is needed. |

### `account_value_transfers`

`ReplacingMergeTree(ingested_at)`, `PARTITION BY toYYYYMM(timestamp)`, ordered (and deduped) by a **natural key built only from protocol facts**:

```
ORDER BY (account, timestamp, tx_id, origin, leg_key, asset_id)
```

| Column | Meaning |
|--------|---------|
| `account` | Tracked account this leg is recorded for |
| `tx_id` | Parent transaction hash |
| `origin` | `native` (top-level contract value) \| `internal` (TVM transfer) \| `token_event` (TRC20/721 log) |
| `leg_key` | Source-independent leg identity within the parent: `''` for `native`; the **protocol internal-transaction hash** for `internal`; the `log_index` for `token_event` |
| `asset_type` | `TRX` \| `TRC10` \| `TRC20` \| `TRC721` |
| `asset_id` | `''` for TRX; TRC10 `tokenId`; contract address for TRC20/721 |
| `from_address` / `to_address` | Base58 parties (direction derived against `account`) |
| `amount_raw` | Raw amount as a string (sun for TRX; token base units otherwise) |
| `asset_decimals` | Decimals when known, else null |
| `timestamp` / `block_number` | Block time / height |
| `ingested_at` | ReplacingMergeTree version |

The `leg_key` is the crux. It is **not** a synthesized ordinal and **not** a provider id: the internal-transaction hash is computed by java-tron and stored in `TransactionInfo`, verified identical between a node's `gettransactioninfobyid` and TronGrid's `internal_tx_id`. Every value identity in the table is therefore an on-chain fact any provider reproduces, so dedup is correct and cross-provider consistent.

With this table, downstream questions stop pattern-matching contract types: "is it TRX?" is `asset_type = 'TRX'`; money-in/out is a group-by on `(direction, asset_type)`; a contract deposit is just an `origin = 'internal'` row. The `toMove` and flow-chart type guards that exist today become unnecessary.

## Provider Independence

The provider seam (`IAccountHistoryProvider`) already isolates the data source; this design keeps the durable schema keyed on protocol facts so the seam is the only thing a swap touches. One coupling is deliberate and correct: the Mongo `progress` cursors are provider-shaped (TronGrid fingerprints). A provider swap re-walks with the new cursor type; stored rows stay valid because their keys are protocol facts, and ReplacingMergeTree absorbs the re-walk idempotently. Control-plane coupling, data-plane independence. See [system-domain-types.md](./system-domain-types.md) for the admission rule every column here satisfies, and [system-block-provider-migration.md](./system-block-provider-migration.md) for the same thesis at the block-sync layer.

## Staged Migration Plan

Each stage ships independently; dual-write keeps reads correct until the cutover.

1. **Domain + provider. (Done.)** `IValueTransfer` domain type plus `IAccountHistoryProvider.fetchInternalTransfersPage` and the pure `toValueTransfers` deriver; the TronGrid `internal-transactions` source sits behind the seam. No storage change.
2. **Create the table + dual-write. (Done.)** Migration `004_create_account_value_transfers_table.ts` creates the ledger; ingest dual-writes legs on both the backfill and forward-sync paths — native via `toValueTransfers`, token via the per-transaction events source (`fetchTokenTransferLegs`, keyed by `log_index`), internal via the internal source (its own cursor and three-way completion gate). Reads unchanged.
3. **Backfill. (Done.)** Two idempotent mechanisms populate the ledger for accounts that completed before the dual-write shipped. Migration `005` reconstructs *native* legs from `account_transactions` inside ClickHouse (their `leg_key` is empty, so storage suffices). *Internal* and *token* legs must hit the provider — internal never lived in `account_transactions`, and a token leg's `log_index` key is only on the events endpoint — so a paced `account-history:ledger-backfill` tick drains the internal source and re-fetches each stored `trc20` transaction's token legs (`fetchTokenTransferLegs`), keyset-resumable per account. The selector targets only the legacy population and self-quiesces; accounts completing under current code are marked token-current at the `complete` gate. Operator-triggered via `/system/database` (migration) and a `/system/account-history` button (tick).
4. **Cut over reads. (Done — verified, pending merge.)** Valuation and the money-in/out chart now read `account_value_transfers` (`getValueTransfers`/`getValueTransfersByTxIds`); the contract-type guards (`TRX_VALUE_CONTRACT_TYPES`, the flow query's `TransferContract`-only filter) are gone. Verified against wallet `TCRq2FJVoN5mpHJgBR6KcavKWEYhQ45BrK`: ledger TRX net reconciles with the old path — new `native` = old `TransferContract` + `TriggerSmartContract` call-value — plus the newly-visible `internal` deposits. One semantic shift: the flow chart now counts `TriggerSmartContract` call-value (the `native` origin carries no type discriminator to re-exclude it), and token holdings label from the contract address since the ledger carries no symbol.
5. **Slim the top-level table.** Stop writing value legs into `account_transactions`; it becomes the top-level record only. Optionally retire the `trc20` `source` rows in favor of `token_event` legs.

Rollback at any stage is reverting the read cutover (stage 4) or pausing dual-write (stage 2); no destructive step precedes a verified cutover.

## Open Questions

- Finalize the `origin` and `asset_type` enums (above is the proposal).
- A standalone `account_events` table stays deferred. The `log_index` question is **resolved**: `/transactions/trc20` omits it, so token legs are sourced per-transaction from `/transactions/{txId}/events` (`fetchTokenTransferLegs`), whose `event_index` is the `log_index`. A dedicated events table is only needed if richer log attribution (beyond the transfer leg) is later required.
- Whether `amount_raw` stays a string uniformly or TRX gets a convenience `amount_sun Int64` companion.

## Further Reading

- [Account History Module README](../../src/backend/modules/account-history/README.md) — current ingest, cursors, and the `account_transactions` table this supersedes
- [Valuation Module README](../../src/backend/modules/valuation/README.md) — the first read consumer to cut over
- [system-domain-types.md](./system-domain-types.md) — the source-independence admission test the schema obeys
- [system-block-provider-migration.md](./system-block-provider-migration.md) — provider-neutral ingestion at the block-sync layer
- [system-database-migrations.md](./system-database-migrations.md) — how the ClickHouse-targeted migrations in this plan are authored and run
</content>
</invoke>
