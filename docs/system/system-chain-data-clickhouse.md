# TRON Chain Data in ClickHouse

A normalized, short-term copy of TRON block data kept in ClickHouse, laid out after java-tron's own protobuf messages so that anyone who knows java-tron's HTTP API can read the tables without a glossary.

The executable form of this document is `src/backend/modules/blockchain/chain-data/`: `buildChainDataSchema.ts` holds every table definition, `buildChainDataRows.ts` turns a fetched block into rows, and `ChainDataWriter.ts` writes them. A change to one side must be made to the other. The retention period is a starting value until one day of real data has been measured.

## Why This Matters

Block sync already fetches every block's full contents from TronGrid, then keeps a small, enriched subset in the MongoDB `transactions` collection for four days (the hourly `blockchain:prune` job). MongoDB is the wrong store for asking questions of that history. The collection keeps its indexes to a minimum to protect write speed, so any question shaped like "every delegation signed under a custom permission last week" becomes a collection scan. The fields such questions need are also not stored: the lock period, `Permission_id`, and the signatures are passed to observers during sync and then discarded (`blockchain.service.ts`, `transaction-parse.ts`).

ClickHouse fits this workload. It stores data by column and compresses it heavily, so time-ranged scans and aggregations over millions of rows are fast, and extra fields cost little. Recording the block data sync already receives costs no additional TronGrid requests.

Using java-tron's canonical shapes rather than TronGrid's is what keeps the data independent of any one provider. The `/wallet/*` responses are byte-identical across TronGrid, hosted providers, and a raw java-tron node ([system-block-provider-migration.md](./system-block-provider-migration.md)). A table laid out after java-tron's messages stays correct when the block source changes.

## How It Works

### One database, named after the chain

Every table lives in a ClickHouse database called `tron`, separate from the application database `tronrelic` (`CLICKHOUSE_DATABASE`). Chain data is large, belongs to no module or plugin, and is governed by its own retention, so it does not share a namespace with `traffic_events` or with `plugin_<id>_` tables. Queries name the database explicitly, as in `SELECT … FROM tron.transaction`.

The unscoped table browser in `/system` lists every database except ClickHouse's own, so these tables appear there as `tron.block`, `tron.transaction`, and so on. Scoped browsers on module and plugin pages stay inside the application database ([ClickHouse module README](../../src/backend/modules/clickhouse/README.md)).

### The java-tron analogue

Each table corresponds to one java-tron protobuf message. The messages are defined in java-tron's `protocol/src/main/protos/core/Tron.proto` and `core/contract/*.proto`, and they are the objects the HTTP API returns as JSON.

| Table | java-tron message | Where it appears in the HTTP API |
|---|---|---|
| `tron.block` | `Block`, `BlockHeader.raw` | `/wallet/getblockbynum` |
| `tron.transaction` | `Transaction`, `Transaction.raw`, `Transaction.Contract`, `Transaction.Result` | `getblockbynum` → `transactions[]` |
| `tron.<contract>` | One table per contract message, such as `DelegateResourceContract` | `contract[0].parameter.value` |
| `tron.transaction_info` | `TransactionInfo`, `ResourceReceipt` | `/wallet/gettransactioninfobyblocknum` |
| `tron.log` | `TransactionInfo.Log` | the same response, `log[]` |
| `tron.internal_transaction` | `InternalTransaction` | the same response, `internal_transactions[]` |
| `tron._transfer`, `tron._token` | none | derived tables we build for querying, described under [Derived tables](#derived-tables) |
| `tron._ingest_state`, `tron._ingest_gap` | none | our own bookkeeping |

The analogue follows the protobuf messages rather than java-tron's internal storage names (`trans`, `transactionRetStore`, `block-index`), because those names are what the node uses on disk, not what a developer reads, and most of them hold account state this design does not copy.

### Naming rules

The rules are mechanical so that nobody has to remember exceptions beyond the short list below.

- **Tables** take the message name converted to snake case at each capital letter: `DelegateResourceContract` becomes `delegate_resource_contract`, `UnDelegateResourceContract` becomes `un_delegate_resource_contract`, and `FreezeBalanceV2Contract` becomes `freeze_balance_v2_contract`.
- **Columns** take the protobuf field name as it appears in java-tron's JSON, converted to snake case the same way.
- **A nested single message is flattened** with its parent field as a prefix: `receipt.energy_fee` becomes `receipt_energy_fee`.
- **A leading underscore marks anything java-tron does not define**, on tables and on columns alike: derived tables such as `_transfer`, bookkeeping tables, and columns the ingest adds to an analogue table, such as `_provider`. Inside a table that is already underscored, the columns it defines itself take no second underscore.

These fields do not convert cleanly, so each is named here once:

| java-tron field | Column |
|---|---|
| `txID`, and `TransactionInfo.id` | `tx_id` |
| `blockID` | `block_id` |
| `Permission_id` | `permission_id` |
| `contractRet` | `contract_ret` |
| `assetIssueID` | `asset_issue_id` |
| `cancel_unfreezeV2_amount` | `cancel_unfreeze_v2_amount` |
| `transferTo_address` | `transfer_to_address` |
| `blockNumber`, `blockTimeStamp` | `block_number`, `block_timestamp` |

### Value conventions

| Kind of value | How it is stored |
|---|---|
| Addresses | Base58 (`T…`), converted at write time from java-tron's hex form, including the 20-byte form log addresses use |
| Other bytes (hashes, call data, topics, signatures, memos) | Lowercase hex without `0x`, as the API returns them |
| Amounts | `Int64` in SUN or token base units, exactly as java-tron states them. A plain `JSON.parse` rounds any integer beyond 2^53, and TRC-10 amounts do go that high, so `TronGridClient` parses the block and receipt responses with `parseJsonExactIntegers`, which keeps such a value as its exact decimal string. The mapper passes that string to ClickHouse, which reads a quoted integer into `Int64` exactly. A value outside the `Int64` range is written as 0, because ClickHouse would wrap it into a different number without raising an error |
| Enumerations | The name java-tron's JSON uses (`ENERGY`, `REVERT`, `SUCESS`), as `LowCardinality(String)`. java-tron's own spelling `SUCESS` is kept rather than corrected |
| Times | `DateTime64(3, 'UTC')` |
| Absent fields | Written as the protobuf default (0, false, empty). java-tron omits default values from its JSON, so a missing `resource` on a delegation means `BANDWIDTH`, and the ledger stores `BANDWIDTH` rather than a null |

### Context columns on every row

Every table below `tron.block` also carries `block_number`, `block_timestamp`, and `transaction_index` (the transaction's position in its block, which is the order the chain executed it). These let each table be filtered by time and ordered correctly without a join. Every table also carries `_provider` (the block source, such as `trongrid`) and `_ingested_at` (when the row was written).

### Engine, partitioning, and retention

Every data table uses `ReplacingMergeTree(_ingested_at)`, and its sort key is its natural identity, so a block written twice (a block fetched twice, or one refetched after the process stopped between its MongoDB block write and its hand-off to ClickHouse) collapses to one copy when parts merge. Because the sort key doubles as that identity, every key ends in whatever makes a row unique, such as `tx_id`; a key without it would merge two different rows into one. A query needing exact counts before a merge adds `FINAL`.

Every data table is partitioned by UTC day, `toYYYYMMDD(block_timestamp)`, with a time-to-live of `CHAIN_DATA_RETENTION_DAYS` (seven days) and `ttl_only_drop_parts = 1`, so expiry drops whole days rather than rewriting data.

### Creating and changing the tables

The writer creates the `tron` database and every table the first time a block reaches it, with `CREATE … IF NOT EXISTS`, and retries once a minute if ClickHouse was unreachable. That is deliberately not a migration: migrations here run only when an operator starts them from `/system/database`, which would leave the writer with nowhere to write after a deploy. A change to an existing table — a new column, or a different retention through `ALTER TABLE … MODIFY TTL` — is a migration, because `IF NOT EXISTS` never alters a table that is already there.

### Write path

Sync builds a block's rows while it prepares the block, from the untouched TronGrid response rather than from the enriched transactions, and carries them through the playout buffer. When `BlockCommitter` has written the block to MongoDB, it hands the rows to the writer and moves on, so the ClickHouse height matches the height every other surface reports and ClickHouse can never delay sync.

The writer writes in order, in batches: while one write is in flight later blocks wait, and the next write takes up to 50 of them with one insert per table. At the chain's pace that is one block per write; after a restart or a backfill, when sync commits blocks much faster, batching is what keeps the writer ahead. Each insert is synchronous (`{ synchronous: true }`, which sends `async_insert: 0`): the rows are already batched, so they skip the server's async-insert buffer and are stored straight away. That way a failure is caught rather than lost in the asynchronous-insert log, and no insert holds one of the shared client's ten pooled connections while the buffer waits to be written, which would leave every other ClickHouse caller queued behind a batch. `tron._ingest_state` is updated only after every table succeeded. Any block it loses is recorded in `tron._ingest_gap` with the reason: an insert that failed (every block in that batch), rows that could not be built, or a full queue (at most 100 blocks wait, bounding memory if ClickHouse stalls). Blocks refused by a full queue are recorded together, in one gap insert after the batch in flight, rather than one insert each, so a stall does not add a stream of extra writes to a ClickHouse that is already struggling. A block lost before the tables exist cannot be recorded straight away, since the gap table is part of what is missing. The writer holds those block numbers in memory and records them as soon as the tables are created. It holds up to 60,000 of them, about two days of blocks, and logs the count of any beyond that at `fatal`.

Every ClickHouse call the writer makes — creating the tables, each table's insert, the gap insert, and reading and writing `tron._ingest_state` — is tried up to four times through the shared `retry()` helper (`src/backend/lib/retry.ts`). The base wait is 0.5, 1, and 2 seconds between tries, and the helper jitters each wait to between half and all of that, so a failing call gives up after between about 1.75 and 3.5 seconds. Retrying an insert is safe even if an earlier try did commit, because every data table is a `ReplacingMergeTree` keyed on the row's identity, so a repeated row collapses into one. Each retried failure is logged as a warning. A call that fails every try is logged at `fatal`, with a message saying what is now missing, and the writer then falls back as described above: a failed data insert becomes a gap, and a failed table creation waits a minute before trying again. Once shutdown begins, the writer stops retrying, so within the five-second shutdown window a failing block becomes a gap instead of being cut off mid-retry with no record.

The receipt tables (`transaction_info`, `log`, `internal_transaction`) are filled only for blocks whose receipts sync fetched, and `tron.block._receipts_fetched` says which those are.

## Tables

### tron.block

| Column | Type | java-tron source |
|---|---|---|
| `block_number` | `UInt64` | the height sync requested, which `block_header.raw_data.number` should match |
| `block_id` | `String` | `blockID` |
| `timestamp` | `DateTime64(3)` | `block_header.raw_data.timestamp` |
| `parent_hash` | `String` | `raw_data.parentHash` |
| `tx_trie_root` | `String` | `raw_data.txTrieRoot` |
| `witness_address` | `String` | `raw_data.witness_address` |
| `witness_id` | `Int64` | `raw_data.witness_id` |
| `version` | `Int32` | `raw_data.version` |
| `account_state_root` | `String` | `raw_data.accountStateRoot` |
| `witness_signature` | `String` | `block_header.witness_signature` |
| `transaction_count` | `UInt32` | length of `transactions[]` |
| `_receipts_fetched` | `Bool` | whether receipt rows exist for this block |

Ordered by `block_number`. Here the block's own time is `timestamp`; every other table copies it as `block_timestamp`.

### tron.transaction

| Column | Type | java-tron source |
|---|---|---|
| `tx_id` | `String` | `txID` |
| `ref_block_bytes`, `ref_block_num`, `ref_block_hash` | `String`, `Int64`, `String` | `raw_data.*` |
| `expiration` | `DateTime64(3)` | `raw_data.expiration` |
| `timestamp` | `Nullable(DateTime64(3))` | `raw_data.timestamp`, set by the sender's client and often absent |
| `fee_limit` | `Int64` | `raw_data.fee_limit` |
| `data` | `String` | `raw_data.data`, the memo in hex |
| `contract_type` | `LowCardinality(String)` | `raw_data.contract[0].type` |
| `permission_id` | `Int32` | `raw_data.contract[0].Permission_id` |
| `parameter` | `String` | `raw_data.contract[0].parameter.value`, as canonical JSON |
| `contract_count` | `UInt8` | length of `raw_data.contract[]`; always 1 in practice, stored so an exception is visible |
| `signature` | `Array(String)` | `signature[]` |
| `contract_ret` | `LowCardinality(String)` | `ret[0].contractRet` |
| `fee` | `Int64` | `ret[0].fee` |
| `raw_data_hex` | `String` | `raw_data_hex`, the exact bytes that were signed |

Ordered by `(block_number, transaction_index)`, with a bloom-filter skip index on `tx_id`. Every transaction lands here whatever its contract type, so nothing is lost for types without a table of their own.

`raw_data_hex` is what makes the copy lossless. `tx_id` is the SHA-256 of those bytes and every signature signs them, so any stored transaction can be checked against its id, have its signer recovered later, and be decoded again from the source if a column above turns out to be wrong. It costs a few hundred bytes per transaction, which is most of this table's size.

### Contract tables

Each carries the context columns plus `tx_id`, `contract_ret`, and `permission_id`, so a query can keep only successful transactions or only those signed under a custom permission without a join. The remaining columns are the contract message's own fields.

| Table | Columns from the message |
|---|---|
| `tron.transfer_contract` | `owner_address`, `to_address`, `amount` |
| `tron.transfer_asset_contract` | `asset_name` (the token id since `ALLOW_SAME_TOKEN_NAME`), `owner_address`, `to_address`, `amount` |
| `tron.trigger_smart_contract` | `owner_address`, `contract_address`, `call_value`, `data`, `call_token_value`, `token_id` |
| `tron.delegate_resource_contract` | `owner_address`, `resource`, `balance`, `receiver_address`, `lock`, `lock_period` (in blocks) |
| `tron.un_delegate_resource_contract` | `owner_address`, `resource`, `balance`, `receiver_address` |
| `tron.freeze_balance_v2_contract` | `owner_address`, `frozen_balance`, `resource` |
| `tron.unfreeze_balance_v2_contract` | `owner_address`, `unfreeze_balance`, `resource` |
| `tron.withdraw_expire_unfreeze_contract` | `owner_address` |
| `tron.account_create_contract` | `owner_address`, `account_address`, `type` |
| `tron.account_permission_update_contract` | `owner_address`, `owner`, `witness`, `actives` (each `Permission` kept as canonical JSON; `actives` as `Array(String)`) |
| `tron.vote_witness_contract` | `owner_address`, `votes` (`Nested(vote_address String, vote_count Int64)`), `support` |

Ordered by `(owner_address, block_timestamp, tx_id)`, with a bloom-filter skip index on the counterparty column (`to_address`, `receiver_address`, `contract_address`, or `account_address`) where one exists. A table for any other contract type is added when something needs it, following the same rules.

### tron.transaction_info

| Column | Type | java-tron source |
|---|---|---|
| `tx_id` | `String` | `id` |
| `fee` | `Int64` | `fee` |
| `result` | `LowCardinality(String)` | `result` |
| `res_message` | `String` | `resMessage` |
| `contract_address` | `String` | `contract_address` |
| `contract_result` | `Array(String)` | `contractResult[]` |
| `receipt_energy_usage`, `receipt_energy_fee`, `receipt_origin_energy_usage`, `receipt_energy_usage_total`, `receipt_net_usage`, `receipt_net_fee`, `receipt_energy_penalty_total` | `Int64` | `receipt.*` |
| `receipt_result` | `LowCardinality(String)` | `receipt.result` |
| `asset_issue_id` | `String` | `assetIssueID` |
| `withdraw_amount`, `unfreeze_amount`, `withdraw_expire_amount`, `packing_fee` | `Int64` | same names; `packingFee` |
| `cancel_unfreeze_v2_amount` | `Map(String, Int64)` | `cancel_unfreezeV2_amount` |
| `exchange_received_amount`, `exchange_inject_another_amount`, `exchange_withdraw_another_amount`, `exchange_id`, `shielded_transaction_fee` | `Int64` | same names |
| `order_id`, `order_details` | `String` | `orderId`; `orderDetails[]` as canonical JSON |

Ordered by `(block_number, transaction_index)`, with a bloom-filter skip index on `tx_id`. `log[]` and `internal_transactions[]` go to their own tables below.

### tron.log

| Column | Type | java-tron source |
|---|---|---|
| `tx_id` | `String` | the parent `TransactionInfo.id` |
| `log_index` | `UInt32` | position in `log[]` |
| `address` | `String` | `address`, the emitting contract |
| `topics` | `Array(String)` | `topics[]` |
| `data` | `String` | `data` |
| `_topic0` | `String` | the first topic, copied at write time so the event signature can lead the sort key |

Ordered by `(address, _topic0, block_timestamp, tx_id, log_index)`, which serves "every `Transfer` event from the USDT contract" directly.

### tron.internal_transaction

| Column | Type | java-tron source |
|---|---|---|
| `tx_id` | `String` | the parent `TransactionInfo.id` |
| `internal_index` | `UInt32` | position in `internal_transactions[]` |
| `hash` | `String` | `hash` |
| `caller_address`, `transfer_to_address` | `String` | `caller_address`, `transferTo_address` |
| `call_value_info` | `Nested(call_value Int64, token_id String)` | `callValueInfo[]` |
| `note` | `String` | `note` |
| `rejected` | `Bool` | `rejected` |
| `extra` | `String` | `extra` |

Ordered by `(block_number, transaction_index, internal_index)`.

### Derived tables

The analogue tables answer "what did this wallet sign" well, because each contract table sorts by `owner_address`. They answer "what did this wallet receive" badly. The receiver has only a bloom-filter skip index, and a TRC-20 transfer's sender and receiver are inside `tron.log`'s `topics`, which no sort key reaches. A query for one address's USDT activity would read every USDT `Transfer` event in its time range. The derived tables exist to give agents and tools a store they can walk address by address.

#### tron._transfer

Movements of value between two accounts, from the sources listed below, written twice: once with `direction = 'out'` under the sender's address and once with `direction = 'in'` under the receiver's. Each row names the other party as `counterparty`. Built by `buildTransferRows.ts` from the same block and receipts as the analogue tables, and written in the same batch.

| Column | Type | Meaning |
|---|---|---|
| `tx_id` | `String` | the transaction the movement belongs to |
| `source` | `LowCardinality(String)` | `contract` (the transaction's own contract), `log` (a TRC-20 `Transfer` event), or `internal` (an internal transaction) |
| `event_index` | `UInt32` | 0 for `contract`, the log index for `log`, the internal index for `internal` |
| `address` | `String` | the party this row is about |
| `direction` | `LowCardinality(String)` | `out` or `in`, from `address`'s side |
| `counterparty` | `String` | the other party |
| `asset_type` | `LowCardinality(String)` | `trx`, `trc10`, or `trc20` |
| `token` | `String` | empty for TRX, the decimal token id for TRC-10 (decoded from `asset_name`'s hex), the contract address for TRC-20 |
| `amount` | `UInt256` | the amount in the asset's smallest unit. 256-bit because a TRC-20 amount is a uint256 and spam tokens use values far beyond `Int64` |

Ordered by `(address, token, block_timestamp, tx_id, source, event_index, direction)`, with a bloom-filter skip index on `tx_id`. The key ends in the movement's identity plus `direction`, so a wallet paying itself keeps both of its rows.

Only value that moved is written. A top-level TRX or TRC-10 movement counts only when `contractRet` is `SUCCESS`. The `contract` rows come from five contract types:

| Contract type | Movement recorded |
|---|---|
| `TransferContract` | TRX from `owner_address` to `to_address` |
| `TransferAssetContract` | a TRC-10 token from `owner_address` to `to_address` |
| `TriggerSmartContract` | the `call_value` in TRX and the `call_token_value` of `token_id`, from the caller to `contract_address` |
| `CreateSmartContract` | the same two amounts (`call_value` sits inside `new_contract`), from the deployer to the new contract. Its address is the transaction's own `contract_address`, which the block response includes, so these rows need no receipt |
| `ParticipateAssetIssueContract` | the TRX a buyer pays the issuer (`to_address`) in a TRC-10 token sale |

A token sale is recorded only from the buyer's TRX side. The tokens the buyer receives work out to `amount × num / trx_num`, where `num` and `trx_num` were set when the token was issued and are not in the block, so a query for a wallet's incoming TRC-10 will not see tokens bought this way. TRC-20 rows come from `Transfer` logs, which java-tron keeps only for executions that succeeded, and a zero-amount log is kept because zero-value transfers are how address poisoning shows up. Rejected internal transactions are left out. TRC-721 transfers are left out, because they move a token id rather than an amount. Staking, delegation, and rewards are not transfers between two accounts and stay in their own tables.

`log` and `internal` rows come only from receipts. A block whose receipts were not fetched has none at all, and a block whose receipts arrived for only some of its transactions has them for those transactions alone. There is no fallback to decoding call data: a block written once without receipts and again with them would then hold the same transfer under two sources. Read `tron.block._receipts_fetched` to tell a block that had no token activity from one that was not checked.

#### tron._token

| Column | Type | Meaning |
|---|---|---|
| `asset_type` | `LowCardinality(String)` | `trc20` today |
| `token` | `String` | the token contract's base58 address |
| `status` | `LowCardinality(String)` | `resolved`, or `unreadable` when the contract answered no `decimals()` |
| `decimals` | `UInt8` | from `decimals()`; 0 when unreadable |
| `symbol`, `name` | `String` | from `symbol()` and `name()`, cut to 128 characters. Chosen by whoever deployed the contract, so treat them as untrusted text |
| `checked_at` | `DateTime64(3)` | when the contract was last asked |

`ReplacingMergeTree(_ingested_at)` ordered by `(asset_type, token)`, with no time-to-live: it holds one row per token, and decimals never change. Read it with `FINAL` to get one row per token before parts merge.

The block writer does not fill this table. The hourly `blockchain:token-metadata` job (`TokenMetadataRefresher.ts`) does, because each lookup costs three calls on the TronGrid queue block sync shares. Each run takes the TRC-20 tokens with at least 20 movements in `tron._transfer` over the last 24 hours that have no `resolved` row, busiest first, up to 50 of them. An `unreadable` token is retried after 24 hours, because a network failure looks the same as a contract with no `decimals()`. A token below the threshold stays unresolved, and a tool reports its amount in base units only.

### Bookkeeping tables

`tron._ingest_state` holds one row per writer (`block-sync` today): the highest block written completely, its time, the provider, and when. The value never moves backwards. Before its first progress write, each process reads the highest block already stored there, and it writes a new row only when it has written a block above that. Until that read succeeds it writes no progress at all, so a gap refilled soon after a restart cannot lower the recorded height. `tron._ingest_gap` holds one row per block the writer failed to write: its number, the reason, and when it was recorded. Gaps are kept for 90 days, longer than the data, because the question they answer can arrive after the data they describe has expired. A consumer that replays history reads the gap table first, because a missing block and a quiet block look the same in every other table.

## What This Is Not

It does not replace the MongoDB `transactions` collection, which the application's own features read. It is not a deep archive: retention is days, and history beyond the window needs a full node or an external dataset. It does not yet feed anything back through the blockchain observers; replaying stored blocks to plugins is a separate design.

## Open Questions

- **Receipts.** The receipt tables fill only while an operator has `fetchBlockReceipts` enabled, which adds one TronGrid request per block ([system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md#energy-and-bandwidth-are-off-by-default)). It is believed to be on in production; `tron.block._receipts_fetched` will confirm it per block once rows are written.
- **Retention per table.** Seven days is a starting value until one day of data has been measured against the 100 GB production volume. Changing it for a deployment that already has the tables is a migration.
- **Unsolidified blocks.** Sync follows `/wallet/getnowblock`, the latest block, rather than the solidified head, which trails it by about 19 blocks. A block that is later dropped by a fork keeps its rows here, and `ReplacingMergeTree` cannot remove them, because a replacement block's transactions have different ids. TRON forks are rare, but a consumer that needs final data should stay about a minute behind the head.
- **Signer recovery.** Signatures and `raw_data_hex` are stored, but no signer is recovered at write time. Recovering every transaction's signer costs about 1.4 ms each, which is hours of CPU a day at TRON's volume, so recovery belongs to the consumer that needs it.

## Further Reading

- [system-block-provider-migration.md](./system-block-provider-migration.md) — the provider-neutral block interface this schema is designed to sit beneath, and the evidence that java-tron shapes are identical across providers
- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) — the sync pipeline, `BlockCommitter`, and the receipt setting
- [system-blockchain-contract-events.md](./system-blockchain-contract-events.md) — how receipt logs are decoded into events and token transfers today
- [ClickHouse module README](../../src/backend/modules/clickhouse/README.md) — the ClickHouse service and admin browser
- [system-chain-query-tools.md](./system-chain-query-tools.md) — the AI tools that read these tables as the `ai-agent` account
