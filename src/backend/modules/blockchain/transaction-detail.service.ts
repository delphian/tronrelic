/**
 * Read-through cache of full transaction detail, keyed by transaction id.
 *
 * A confirmed TRON transaction is immutable, so its detail is cached
 * permanently in `core_transaction_details`: a hit is an indexed local read; a
 * miss fetches the transaction from the provider (two calls — raw transaction
 * plus receipt), persists it in the clean `IBlockTransaction` shape, and
 * returns it. The cache shape *is* the contract, so there is no legacy-shape
 * mapping and no retention gap.
 *
 * Published on the service registry as `'transaction-details'`. Singleton with
 * injected resources (database + provider), matching the registry convention
 * for `IXxxService` implementations.
 */
import type { IDatabaseService, IBlockTransaction, IResourceUsage, ITransactionDetailService } from '@/types';
import { logger } from '../../lib/logger.js';
import { TronGridClient, type TronGridTransaction, type TronGridTransactionInfo } from './tron-grid.client.js';
import { normalizeContractType, resolveOwnerAddress, resolveRecipient, resolveAmounts, describeContract } from './transaction-parse.js';

/** Permanent cache collection for resolved transaction detail. */
const COLLECTION = 'core_transaction_details';

/** A TRON transaction id is a 64-character hex hash. Guards the public contract. */
const TXID_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Max cache misses filled concurrently per chunk. Each miss issues two provider
 * requests, and the provider's request queue is shared (with the sync pipeline)
 * and capped, so 25 keeps in-flight requests (≤50) well under that ceiling.
 */
const FILL_CHUNK_SIZE = 25;

/** Stored cache document — the contract shape plus Mongo's id. */
type CachedTransaction = IBlockTransaction & { _id?: unknown };

/**
 * Lazily-populated, permanent transaction-detail lookup service.
 */
export class TransactionDetailService implements ITransactionDetailService {
    private static instance: TransactionDetailService | null = null;

    private readonly logger = logger.child({ service: 'transaction-detail' });

    /**
     * @param database - Core database for the cache collection.
     * @param provider - Block provider used to fill cache misses.
     */
    private constructor(
        private readonly database: IDatabaseService,
        private readonly provider: TronGridClient
    ) {}

    /**
     * Wire dependencies and create the singleton on first call. Subsequent
     * calls are ignored so the instance and its resources stay stable.
     *
     * @param database - Core database service.
     * @param provider - Block provider (TronGrid today).
     */
    public static setDependencies(database: IDatabaseService, provider: TronGridClient): void {
        if (!TransactionDetailService.instance) {
            TransactionDetailService.instance = new TransactionDetailService(database, provider);
        }
    }

    /**
     * Retrieve the singleton. Throws if `setDependencies` has not run.
     */
    public static getInstance(): TransactionDetailService {
        if (!TransactionDetailService.instance) {
            throw new Error('TransactionDetailService.setDependencies() must be called before getInstance()');
        }
        return TransactionDetailService.instance;
    }

    /**
     * Create the cache indexes. Idempotent — safe to call once at bootstrap.
     * The address indexes back per-account retrieval; `txId` is the unique
     * lookup and dedup key.
     */
    public async ensureIndexes(): Promise<void> {
        await this.database.createIndex(COLLECTION, { txId: 1 }, { unique: true });
        await this.database.createIndex(COLLECTION, { 'from.address': 1 });
        await this.database.createIndex(COLLECTION, { 'to.address': 1 });
    }

    /**
     * Resolve a single transaction, cache-first.
     *
     * @param txId - Transaction hash.
     * @returns The transaction, or null if it cannot be resolved.
     */
    public async getTransactionById(txId: string): Promise<IBlockTransaction | null> {
        const [tx] = await this.getTransactionsByIds([txId]);
        return tx ?? null;
    }

    /**
     * Resolve many transactions, cache-first. Reads all cache hits in one
     * indexed `$in` query, then fills only the misses from the provider
     * concurrently. Returns the transactions that resolved, in no guaranteed
     * order — map by `txId` if alignment matters.
     *
     * @param txIds - Transaction hashes (duplicates are de-duplicated).
     * @returns Resolved transactions.
     */
    public async getTransactionsByIds(txIds: string[]): Promise<IBlockTransaction[]> {
        const unique = [...new Set(txIds)].filter(id => id && TXID_PATTERN.test(id));
        if (unique.length === 0) {
            return [];
        }

        const cached = await this.database.find<CachedTransaction>(COLLECTION, { txId: { $in: unique } });
        const hits = cached.map(stripId);
        const found = new Set(hits.map(tx => tx.txId));

        const missing = unique.filter(id => !found.has(id));

        // Fill misses in bounded chunks. Each miss issues two provider requests
        // against a shared, capped queue, so an unbounded fan-out would overflow
        // it (and starve the sync pipeline) on large batches.
        const filled: IBlockTransaction[] = [];
        for (let i = 0; i < missing.length; i += FILL_CHUNK_SIZE) {
            const chunk = missing.slice(i, i + FILL_CHUNK_SIZE);
            const results = await Promise.all(chunk.map(id => this.fetchAndCache(id)));
            for (const tx of results) {
                if (tx !== null) {
                    filled.push(tx);
                }
            }
        }

        return [...hits, ...filled];
    }

    /**
     * Fetch a transaction's raw data and receipt from the provider, assemble
     * the clean record, persist it, and return it. Returns null when either
     * provider call fails to resolve the transaction.
     */
    private async fetchAndCache(txId: string): Promise<IBlockTransaction | null> {
        const [rawTx, info] = await Promise.all([
            this.provider.getTransactionById(txId),
            this.provider.getTransactionInfo(txId)
        ]);

        const tx = this.assemble(rawTx, info);
        if (!tx) {
            return null;
        }

        await this.persist(tx);
        return tx;
    }

    /**
     * Persist a resolved transaction. Write-once: a duplicate-key race (two
     * concurrent fills of the same id) is expected and ignored. Other write
     * failures are logged but not thrown — the lookup still returns its data.
     */
    private async persist(tx: IBlockTransaction): Promise<void> {
        try {
            await this.database.insertOne(COLLECTION, { ...tx });
        } catch (error) {
            if ((error as { code?: number }).code === 11000) {
                return;
            }
            this.logger.warn({ error, txId: tx.txId }, 'Failed to cache transaction detail');
        }
    }

    /**
     * Assemble an `IBlockTransaction` from a raw transaction and its receipt.
     * Both are required: `raw_data` carries type/parties/amount/memo/status,
     * the receipt carries the only source of block number, fee, and resource
     * accounting. Returns null if either is absent or the transaction has no
     * contract.
     */
    private assemble(rawTx: TronGridTransaction | null, info: TronGridTransactionInfo | null): IBlockTransaction | null {
        if (!rawTx || !info) {
            return null;
        }

        const contract = rawTx.raw_data?.contract?.[0];
        if (!contract) {
            return null;
        }

        const contractType = normalizeContractType(contract.type);
        const value = (contract.parameter?.value ?? {}) as Record<string, unknown>;
        const ownerAddress = resolveOwnerAddress(value);
        const recipientAddress = resolveRecipient(contractType, value, ownerAddress);
        const { rawAmountSun } = resolveAmounts(contractType, value);
        const isContractCall = contractType === 'TriggerSmartContract' || contractType === 'CreateSmartContract';

        const tx: IBlockTransaction = {
            txId: rawTx.txID,
            blockNumber: info.blockNumber,
            timestamp: new Date(info.blockTimeStamp),
            type: contractType,
            status: rawTx.ret?.[0]?.contractRet || info.receipt?.result || 'UNKNOWN',
            from: { address: ownerAddress },
            to: { address: recipientAddress },
            feeSun: info.fee,
            memo: TronGridClient.decodeMemo(rawTx.raw_data?.data)
        };

        if (rawAmountSun > 0) {
            tx.amountSun = rawAmountSun;
        }

        const energy = toResourceUsage(info.receipt?.energy_usage_total, info.receipt?.energy_fee);
        if (energy) {
            tx.energy = energy;
        }

        const bandwidth = toResourceUsage(info.receipt?.net_usage, info.receipt?.net_fee);
        if (bandwidth) {
            tx.bandwidth = bandwidth;
        }

        if (isContractCall) {
            tx.contract = describeContract(contractType, value);
        }

        return tx;
    }
}

/**
 * Drop Mongo's `_id` from a cached document so callers receive the clean
 * `IBlockTransaction` contract.
 */
function stripId(doc: CachedTransaction): IBlockTransaction {
    const { _id, ...tx } = doc;
    return tx;
}

/**
 * Project chain receipt usage/fee into the clean `IResourceUsage` shape, or
 * undefined when the resource was neither consumed nor charged.
 *
 * @param consumed - Units drawn (`energy_usage_total` or `net_usage`).
 * @param feeSun - TRX burned in sun (`energy_fee` or `net_fee`).
 */
function toResourceUsage(consumed?: number, feeSun?: number): IResourceUsage | undefined {
    const units = consumed ?? 0;
    const fee = feeSun ?? 0;
    if (!units && !fee) {
        return undefined;
    }
    return { consumed: units, feeSun: fee };
}
