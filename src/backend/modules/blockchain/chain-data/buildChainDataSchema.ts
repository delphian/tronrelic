/**
 * @fileoverview The ClickHouse `tron` database: every table's definition, in one place.
 *
 * Block sync keeps a short-term, normalized copy of each committed block in
 * ClickHouse, laid out after java-tron's own protobuf messages so anyone who
 * knows java-tron's HTTP API can read the tables without a glossary. The layout
 * and the reasoning behind it are in `docs/system/system-chain-data-clickhouse.md`;
 * this file is the executable form of that document and must agree with it.
 *
 * The tables are created by the writer at startup with `CREATE … IF NOT EXISTS`
 * rather than by a migration. Migrations here are started by an operator, so a
 * migration would leave the writer with nowhere to write after a deploy until
 * somebody remembered to run it. A later change to an existing table — a new
 * column, a different retention — is a migration, because `IF NOT EXISTS` never
 * alters a table that is already there.
 *
 * @module backend/modules/blockchain/chain-data/buildChainDataSchema
 */

/** The ClickHouse database that holds the chain data, apart from the application's own. */
export const CHAIN_DATA_DATABASE = 'tron';

/**
 * Days of chain data each table keeps before whole days are dropped.
 *
 * Sized from production in October 2026, when one full day measured about
 * 9 GiB across every table, so fourteen days is about 126 GiB on the 298 GiB
 * ClickHouse volume. It is written into each table's definition when the table
 * is created, so an edit here alone reaches only tables created afterwards.
 * Changing it for a deployment that already has the tables also takes a
 * migration that runs {@link buildChainDataRetentionStatements}.
 */
export const CHAIN_DATA_RETENTION_DAYS = 14;

/**
 * The derived table recording each value movement between two accounts twice,
 * once from each party's side. `buildTransferRows.ts` lists which movements it
 * covers. Not a java-tron message, hence the leading underscore.
 */
export const TRANSFER_TABLE = '_transfer';

/**
 * Token metadata read from the token contracts themselves. Not a java-tron
 * message, hence the leading underscore.
 */
export const TOKEN_TABLE = '_token';

/**
 * Days a recorded gap is kept. Longer than the data itself, because a gap is
 * the evidence someone reads when working out why a stretch of history looks
 * wrong, and that question can arrive after the data it describes has expired.
 */
export const CHAIN_DATA_GAP_RETENTION_DAYS = 90;

/**
 * The context every per-transaction table carries, so each can be filtered by
 * time and put in chain order without a join back to `tron.block`.
 */
const CONTEXT_COLUMNS = `
    block_number UInt64,
    block_timestamp DateTime64(3, 'UTC'),
    transaction_index UInt32,`;

/**
 * Columns the ingest adds and java-tron does not define, marked by the leading
 * underscore. `_ingested_at` is also the version a `ReplacingMergeTree` keeps
 * when a block is written twice.
 */
const BOOKKEEPING_COLUMNS = `
    _provider LowCardinality(String),
    _ingested_at DateTime64(3, 'UTC')`;

/**
 * The storage clause every data table shares.
 *
 * `ReplacingMergeTree` collapses a block written twice — after a restart between
 * the ledger write and the cursor advance — to one copy when parts merge, which
 * is why each sort key is a table's natural identity rather than just the
 * columns it is read by. Partitioning by UTC day lets the time-to-live drop
 * whole days instead of rewriting data.
 *
 * `materialize_ttl_recalculate_only` keeps a later retention change cheap. By
 * default, `ALTER TABLE … MODIFY TTL` rewrites every column of every stored
 * part, and the `ALTER` does not return until that finishes. With this setting
 * ClickHouse reuses the existing column files and only recomputes each part's
 * expiry time. That is all a table needs, because `ttl_only_drop_parts` drops a
 * whole day at once rather than deleting rows inside it.
 *
 * @param orderBy - The sort key, which is also the identity duplicates collapse on.
 * @param timeColumn - The column the table is partitioned and expired by.
 * @param retentionDays - How many days of data the table keeps.
 * @returns The engine, partition, sort, and expiry clause.
 */
function storageClause(orderBy: string, timeColumn: string, retentionDays: number): string {
    return `
ENGINE = ReplacingMergeTree(_ingested_at)
PARTITION BY toYYYYMMDD(${timeColumn})
ORDER BY (${orderBy})
${ttlClause(timeColumn, retentionDays)}
SETTINGS ttl_only_drop_parts = 1, materialize_ttl_recalculate_only = 1`;
}

/**
 * The expiry expression a data table carries, written in one place so the
 * `CREATE TABLE` statements and a later `MODIFY TTL` cannot disagree.
 *
 * @param timeColumn - The column the table is expired by.
 * @param retentionDays - How many days of data the table keeps.
 * @returns The `TTL … DELETE` clause.
 */
function ttlClause(timeColumn: string, retentionDays: number): string {
    return `TTL toDateTime(${timeColumn}) + INTERVAL ${retentionDays} DAY DELETE`;
}

/**
 * Convert a java-tron contract type into its table name.
 *
 * The rule is mechanical so nobody has to remember exceptions: an underscore
 * goes before each capital letter that follows a lowercase letter or a digit,
 * then everything is lowercased. `UnDelegateResourceContract` becomes
 * `un_delegate_resource_contract` and `FreezeBalanceV2Contract` becomes
 * `freeze_balance_v2_contract`.
 *
 * @param contractType - The `raw_data.contract[0].type` value java-tron reports.
 * @returns The table name, without the database.
 */
export function contractTableName(contractType: string): string {
    return contractType.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** One contract type that has a table of its own, and that table's columns. */
interface IContractTableSpec {
    /** The java-tron contract type, as `raw_data.contract[0].type` names it. */
    contractType: string;
    /** The contract message's own fields as column definitions. */
    columns: string;
    /** The column naming the other party, given a skip index, or null when the message names none. */
    counterparty: string | null;
}

/**
 * The contract types with a typed table. Every transaction also lands in
 * `tron.transaction` with its parameter as canonical JSON, so a type missing
 * here loses nothing; a table is added when something needs to read one.
 */
export const CONTRACT_TABLE_SPECS: readonly IContractTableSpec[] = [
    {
        contractType: 'TransferContract',
        columns: 'owner_address String, to_address String, amount Int64',
        counterparty: 'to_address'
    },
    {
        contractType: 'TransferAssetContract',
        columns: 'asset_name String, owner_address String, to_address String, amount Int64',
        counterparty: 'to_address'
    },
    {
        contractType: 'TriggerSmartContract',
        columns: 'owner_address String, contract_address String, call_value Int64, data String, call_token_value Int64, token_id Int64',
        counterparty: 'contract_address'
    },
    {
        contractType: 'DelegateResourceContract',
        columns: 'owner_address String, resource LowCardinality(String), balance Int64, receiver_address String, lock Bool, lock_period Int64',
        counterparty: 'receiver_address'
    },
    {
        contractType: 'UnDelegateResourceContract',
        columns: 'owner_address String, resource LowCardinality(String), balance Int64, receiver_address String',
        counterparty: 'receiver_address'
    },
    {
        contractType: 'FreezeBalanceV2Contract',
        columns: 'owner_address String, frozen_balance Int64, resource LowCardinality(String)',
        counterparty: null
    },
    {
        contractType: 'UnfreezeBalanceV2Contract',
        columns: 'owner_address String, unfreeze_balance Int64, resource LowCardinality(String)',
        counterparty: null
    },
    {
        contractType: 'WithdrawExpireUnfreezeContract',
        columns: 'owner_address String',
        counterparty: null
    },
    {
        contractType: 'AccountCreateContract',
        columns: 'owner_address String, account_address String, type LowCardinality(String)',
        counterparty: 'account_address'
    },
    {
        contractType: 'AccountPermissionUpdateContract',
        columns: 'owner_address String, owner String, witness String, actives Array(String)',
        counterparty: null
    },
    {
        contractType: 'VoteWitnessContract',
        columns: 'owner_address String, votes Nested(vote_address String, vote_count Int64), support Bool',
        counterparty: null
    }
];

/**
 * The `CREATE TABLE` statement for one contract table.
 *
 * The sort key leads with the owner because "everything this wallet did" is the
 * question these tables answer, and it ends with `tx_id` because the key is also
 * the identity duplicates collapse on — without it, two transfers one wallet
 * made in the same block would merge into one.
 *
 * @param spec - The contract type and its columns.
 * @param retentionDays - How many days of data the table keeps.
 * @returns The statement, safe to repeat.
 */
function contractTableStatement(spec: IContractTableSpec, retentionDays: number): string {
    const index = spec.counterparty
        ? `,
    INDEX idx_${spec.counterparty} ${spec.counterparty} TYPE bloom_filter(0.01) GRANULARITY 4`
        : '';
    return `CREATE TABLE IF NOT EXISTS ${CHAIN_DATA_DATABASE}.${contractTableName(spec.contractType)} (${CONTEXT_COLUMNS}
    tx_id String,
    contract_ret LowCardinality(String),
    permission_id Int32,
    ${spec.columns},${BOOKKEEPING_COLUMNS}${index}
)${storageClause('owner_address, block_timestamp, tx_id', 'block_timestamp', retentionDays)}`;
}

/**
 * Every statement that brings the `tron` database to the shape the writer
 * expects, in the order they must run.
 *
 * @param retentionDays - How many days of data each data table keeps. Supplied
 *                        rather than read from the constant so a test can
 *                        assert the clause without depending on today's value.
 * @returns The statements, each safe to repeat on a database that already has it.
 */
export function buildChainDataSchema(retentionDays: number = CHAIN_DATA_RETENTION_DAYS): string[] {
    const db = CHAIN_DATA_DATABASE;
    const statements: string[] = [
        `CREATE DATABASE IF NOT EXISTS ${db}`,

        `CREATE TABLE IF NOT EXISTS ${db}.block (
    block_number UInt64,
    block_id String,
    timestamp DateTime64(3, 'UTC'),
    parent_hash String,
    tx_trie_root String,
    witness_address String,
    witness_id Int64,
    version Int32,
    account_state_root String,
    witness_signature String,
    transaction_count UInt32,
    _receipts_fetched Bool,${BOOKKEEPING_COLUMNS}
)${storageClause('block_number', 'timestamp', retentionDays)}`,

        `CREATE TABLE IF NOT EXISTS ${db}.transaction (${CONTEXT_COLUMNS}
    tx_id String,
    ref_block_bytes String,
    ref_block_num Int64,
    ref_block_hash String,
    expiration DateTime64(3, 'UTC'),
    timestamp Nullable(DateTime64(3, 'UTC')),
    fee_limit Int64,
    data String,
    contract_type LowCardinality(String),
    permission_id Int32,
    parameter String,
    contract_count UInt8,
    signature Array(String),
    contract_ret LowCardinality(String),
    fee Int64,
    raw_data_hex String,${BOOKKEEPING_COLUMNS},
    INDEX idx_tx_id tx_id TYPE bloom_filter(0.01) GRANULARITY 4
)${storageClause('block_number, transaction_index', 'block_timestamp', retentionDays)}`,

        ...CONTRACT_TABLE_SPECS.map(spec => contractTableStatement(spec, retentionDays)),

        `CREATE TABLE IF NOT EXISTS ${db}.transaction_info (${CONTEXT_COLUMNS}
    tx_id String,
    fee Int64,
    result LowCardinality(String),
    res_message String,
    contract_address String,
    contract_result Array(String),
    receipt_energy_usage Int64,
    receipt_energy_fee Int64,
    receipt_origin_energy_usage Int64,
    receipt_energy_usage_total Int64,
    receipt_net_usage Int64,
    receipt_net_fee Int64,
    receipt_result LowCardinality(String),
    receipt_energy_penalty_total Int64,
    asset_issue_id String,
    withdraw_amount Int64,
    unfreeze_amount Int64,
    withdraw_expire_amount Int64,
    packing_fee Int64,
    cancel_unfreeze_v2_amount Map(String, Int64),
    exchange_received_amount Int64,
    exchange_inject_another_amount Int64,
    exchange_withdraw_another_amount Int64,
    exchange_id Int64,
    shielded_transaction_fee Int64,
    order_id String,
    order_details String,${BOOKKEEPING_COLUMNS},
    INDEX idx_tx_id tx_id TYPE bloom_filter(0.01) GRANULARITY 4
)${storageClause('block_number, transaction_index', 'block_timestamp', retentionDays)}`,

        `CREATE TABLE IF NOT EXISTS ${db}.log (${CONTEXT_COLUMNS}
    tx_id String,
    log_index UInt32,
    address String,
    topics Array(String),
    data String,
    _topic0 String,${BOOKKEEPING_COLUMNS}
)${storageClause('address, _topic0, block_timestamp, tx_id, log_index', 'block_timestamp', retentionDays)}`,

        `CREATE TABLE IF NOT EXISTS ${db}.internal_transaction (${CONTEXT_COLUMNS}
    tx_id String,
    internal_index UInt32,
    hash String,
    caller_address String,
    transfer_to_address String,
    call_value_info Nested(call_value Int64, token_id String),
    note String,
    rejected Bool,
    extra String,${BOOKKEEPING_COLUMNS}
)${storageClause('block_number, transaction_index, internal_index', 'block_timestamp', retentionDays)}`,

        // One row per party per value movement: the sender's row says `out`,
        // the receiver's says `in`, and each names the other as its
        // counterparty. Leading the sort key with `address` is what makes
        // "everything this wallet sent or received" a range read in both
        // directions; the java-tron tables sort by sender only, and the TRC-20
        // parties sit inside `tron.log` topics. `amount` is 256-bit because a
        // TRC-20 amount is a uint256 and spam tokens use values far beyond
        // Int64. The key ends in the movement's identity plus `direction`, so a
        // wallet paying itself keeps both of its rows.
        `CREATE TABLE IF NOT EXISTS ${db}.${TRANSFER_TABLE} (${CONTEXT_COLUMNS}
    tx_id String,
    source LowCardinality(String),
    event_index UInt32,
    address String,
    direction LowCardinality(String),
    counterparty String,
    asset_type LowCardinality(String),
    token String,
    amount UInt256,${BOOKKEEPING_COLUMNS},
    INDEX idx_tx_id tx_id TYPE bloom_filter(0.01) GRANULARITY 4
)${storageClause('address, token, block_timestamp, tx_id, source, event_index, direction', 'block_timestamp', retentionDays)}`,

        // Written by the token metadata job, not by the block writer. Kept
        // without a time-to-live because a token's decimals never change and
        // the table holds one row per token, not one per movement.
        `CREATE TABLE IF NOT EXISTS ${db}.${TOKEN_TABLE} (
    asset_type LowCardinality(String),
    token String,
    status LowCardinality(String),
    decimals UInt8,
    symbol String,
    name String,
    checked_at DateTime64(3, 'UTC'),${BOOKKEEPING_COLUMNS}
)
ENGINE = ReplacingMergeTree(_ingested_at)
ORDER BY (asset_type, token)`,

        `CREATE TABLE IF NOT EXISTS ${db}._ingest_state (
    writer LowCardinality(String),
    block_number UInt64,
    block_timestamp DateTime64(3, 'UTC'),${BOOKKEEPING_COLUMNS}
)
ENGINE = ReplacingMergeTree(_ingested_at)
ORDER BY writer`,

        `CREATE TABLE IF NOT EXISTS ${db}._ingest_gap (
    block_number UInt64,
    reason String,
    recorded_at DateTime64(3, 'UTC'),
    _provider LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(recorded_at)
ORDER BY (block_number, recorded_at)
TTL toDateTime(recorded_at) + INTERVAL ${CHAIN_DATA_GAP_RETENTION_DAYS} DAY DELETE`
    ];

    return statements;
}

/** One data table that expires on {@link CHAIN_DATA_RETENTION_DAYS}, and the column it expires by. */
export interface IChainDataExpiringTable {
    /** The table name, without the database. */
    table: string;
    /** The column the table is partitioned and expired by. */
    timeColumn: string;
}

/**
 * Every table whose `CREATE TABLE` statement uses {@link storageClause}, so
 * every table a retention change has to reach.
 *
 * `_token`, `_ingest_state`, and `_ingest_gap` are left out on purpose. The
 * first two never expire, and the gap table keeps its own longer retention.
 * A test checks this list against the statements, so a data table added to
 * {@link buildChainDataSchema} without being listed here fails the suite
 * rather than keeping the old retention after the next change.
 *
 * @returns The tables in the order {@link buildChainDataSchema} creates them.
 */
export function chainDataExpiringTables(): IChainDataExpiringTable[] {
    const tables: IChainDataExpiringTable[] = [
        { table: 'block', timeColumn: 'timestamp' },
        { table: 'transaction', timeColumn: 'block_timestamp' },
        ...CONTRACT_TABLE_SPECS.map(spec => ({ table: contractTableName(spec.contractType), timeColumn: 'block_timestamp' })),
        { table: 'transaction_info', timeColumn: 'block_timestamp' },
        { table: 'log', timeColumn: 'block_timestamp' },
        { table: 'internal_transaction', timeColumn: 'block_timestamp' },
        { table: TRANSFER_TABLE, timeColumn: 'block_timestamp' }
    ];
    return tables;
}

/**
 * The statements that move one existing data table to a new retention.
 *
 * The setting is applied first, in its own `ALTER`, so that the `MODIFY TTL`
 * which follows only recomputes each part's expiry time instead of rewriting
 * the table. Tables created before that setting joined {@link storageClause}
 * do not have it, and on the production volume a full rewrite would copy about
 * 60 GiB while the `ALTER` waited. Both statements are safe to repeat.
 *
 * @param target - The table and the column it expires by.
 * @param retentionDays - How many days of data the table should keep.
 * @returns The two `ALTER TABLE` statements, in the order they must run.
 */
export function buildChainDataRetentionStatements(target: IChainDataExpiringTable, retentionDays: number): string[] {
    const table = `${CHAIN_DATA_DATABASE}.${target.table}`;
    return [
        `ALTER TABLE ${table} MODIFY SETTING materialize_ttl_recalculate_only = 1`,
        `ALTER TABLE ${table} MODIFY ${ttlClause(target.timeColumn, retentionDays)}`
    ];
}
