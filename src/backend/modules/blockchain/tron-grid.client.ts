import TronWeb from 'tronweb';
import { httpClient } from '../../lib/http-client.js';
import { env } from '../../config/env.js';
import { blockchainConfig } from '../../config/blockchain.js';
import { retry } from '../../lib/retry.js';
import { logger } from '../../lib/logger.js';
import type { ITrc10, IActivatingTransaction } from '@/types';

/**
 * Raw TRC10 asset-issue record as TronGrid returns it from
 * `/wallet/getassetissuebyid` and `/wallet/getassetissuebyaccount`.
 *
 * Text fields (`name`, `abbr`, `description`, `url`) arrive hex-encoded and the
 * owner address arrives hex; the mapper to {@link ITrc10} owns all decoding so
 * nothing outside this client sees the wire shape.
 */
interface TronGridAssetIssue {
    id?: string | number;
    owner_address?: string;
    name?: string;
    abbr?: string;
    description?: string;
    url?: string;
    total_supply?: number;
    precision?: number;
    trx_num?: number;
    num?: number;
    start_time?: number;
    end_time?: number;
    frozen_supply?: Array<{ frozen_amount?: number; frozen_days?: number }>;
    free_asset_net_limit?: number;
    public_free_asset_net_limit?: number;
    vote_score?: number;
}

const tronWeb = new TronWeb({
    fullHost: 'https://api.trongrid.io'
});

const BASE_URL = 'https://api.trongrid.io';

// Minimum delay between requests (milliseconds)
const REQUEST_THROTTLE_MS = 200;

/**
 * Tolerance for the account `create_time` vs activating-transaction
 * `block_timestamp` comparison in {@link TronGridClient.getActivatingTransaction}.
 *
 * Why a tolerance is needed at all: `create_time` is not the activating
 * transaction's own timestamp. Every activation path in java-tron stamps the new
 * account with `latestBlockHeaderTimestamp`, and a block's own header timestamp
 * is not saved until after its transactions have executed — so a transaction in
 * block N writes the timestamp of block N-1. `create_time` therefore sits
 * exactly one block interval (3000 ms) before the `block_timestamp` the v1 feed
 * reports for that same transaction. A strict `block_timestamp > create_time`
 * comparison rejects every ordinary wallet on that offset alone. Measured on 45
 * mainnet accounts the gap was 3000 ms in 44 cases.
 *
 * Why three blocks rather than one: a missed block slot widens the gap to 6000
 * or 9000 ms without making the activation any less genuine, because the stamp
 * comes from whatever the previous block header said. Three blocks covers that.
 *
 * Why not wider: this window is the width of the hole left in the guard, and a
 * contract-created account is routinely acted on within seconds of being
 * created, so a minute-wide tolerance accepts that later, unrelated sender as
 * the activator — exactly the false edge the check exists to reject. The
 * timestamp test is deliberately not the only test for that reason; see
 * {@link ACCOUNT_CREATING_CONTRACT_TYPES}.
 */
const ACTIVATION_CREATE_TIME_SKEW_MS = 9_000;

// Collect all available API keys
function getApiKeys(): string[] {
    const keys: string[] = [];
    if (env.TRONGRID_API_KEY) keys.push(env.TRONGRID_API_KEY);
    if (env.TRONGRID_API_KEY_2) keys.push(env.TRONGRID_API_KEY_2);
    if (env.TRONGRID_API_KEY_3) keys.push(env.TRONGRID_API_KEY_3);
    return keys;
}

// Global state for rate limiting (shared across all instances)
let lastRequestTime = 0;
let currentKeyIndex = 0;
const availableKeys = getApiKeys();

// Request queue to ensure truly serial execution across all callers
let requestQueue = Promise.resolve();

// Queue size tracking to prevent unbounded growth
let queueSize = 0;
const MAX_QUEUE_SIZE = 100;

// Log configuration on module load
if (availableKeys.length > 0) {
    logger.info(
        {
            keyCount: availableKeys.length,
            throttleMs: REQUEST_THROTTLE_MS
        },
        'TronGrid client initialized with rate limiting'
    );
} else {
    logger.warn('No TronGrid API keys configured - requests may be rate limited');
}

export interface TronGridContract {
    parameter: {
        value: Record<string, unknown>;
        type_url?: string;
    };
    type: string;
    /** Permission ID used to authorize this transaction (0=owner, 1=witness, 2=active, 3+=custom) */
    Permission_id?: number;
}

export interface TronGridTransaction {
    txID: string;
    raw_data: {
        timestamp: number;
        ref_block_hash: string;
        ref_block_bytes: string;
        contract: TronGridContract[];
        data?: string;
        fee_limit?: number;
    };
    raw_data_hex?: string;
    /**
     * ECDSA signature(s) over sha256(raw_data) — which equals the txID, so
     * the signer is recoverable from `txID` + this field alone. Multi-signed
     * transactions carry one entry per signer.
     */
    signature?: string[];
    ret?: Array<{ contractRet: string; fee: number }>;
}

export interface TronGridTransactionInfo {
    id: string;
    fee: number;
    blockNumber: number;
    blockTimeStamp: number;
    receipt?: {
        energy_usage_total?: number;
        energy_fee?: number;
        net_usage?: number;
        net_fee?: number;
        result?: string;
    };
    contractResult?: string[];
    log?: Array<Record<string, unknown>>;
    internal_transactions?: Array<Record<string, unknown>>;
    assetIssueID?: string;
    result?: string;
    resMessage?: string;
}

export interface TronGridBlock {
    blockID: string;
    block_header: {
        raw_data: {
            number: number;
            timestamp: number;
            parentHash: string;
            witness_address: string;
            witness_signature?: string;
            account_state_root?: string;
            transactions_root?: string;
        };
        witness_signature: string;
    };
    transactions?: TronGridTransaction[];
    txTrieRoot?: string;
    size?: number;
}

/**
 * Get next API key using round-robin rotation
 */
function getNextApiKey(): string | undefined {
    if (availableKeys.length === 0) {
        return undefined;
    }

    const key = availableKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % availableKeys.length;
    return key;
}

/**
 * Build headers with rotating API key
 */
function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const apiKey = getNextApiKey();
    if (apiKey) {
        headers['TRON-PRO-API-KEY'] = apiKey;
    }
    return headers;
}

/**
 * Enqueue a request to ensure serial execution with rate limiting
 * This creates a true queue where each request waits for all previous requests to complete
 * Throws an error if queue exceeds MAX_QUEUE_SIZE to prevent unbounded growth
 */
async function enqueueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    // Check queue size limit to prevent unbounded growth
    if (queueSize >= MAX_QUEUE_SIZE) {
        const error = new Error(
            `TronGrid request queue is full (${queueSize}/${MAX_QUEUE_SIZE}). ` +
            'System is overloaded or rate limiting is too aggressive. Rejecting new requests.'
        );
        logger.error({ queueSize, maxQueueSize: MAX_QUEUE_SIZE }, 'TronGrid request queue overflow');
        throw error;
    }

    // Increment queue size
    queueSize++;

    // Chain this request after all previous requests
    const previousQueue = requestQueue;

    // Create a new promise for this request
    let resolveRequest: (value: T) => void;
    let rejectRequest: (error: unknown) => void;

    const currentRequest = new Promise<T>((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
    });

    // Update the queue to wait for this request to complete
    requestQueue = currentRequest.then(() => {}, () => {});

    // Wait for all previous requests, then execute this one
    previousQueue.then(async () => {
        try {
            // Enforce minimum delay since last request
            const now = Date.now();
            const timeSinceLastRequest = now - lastRequestTime;

            if (timeSinceLastRequest < REQUEST_THROTTLE_MS) {
                const delayNeeded = REQUEST_THROTTLE_MS - timeSinceLastRequest;
                await new Promise(resolve => setTimeout(resolve, delayNeeded));
            }

            // Execute the actual request
            const result = await requestFn();

            // Update timestamp after request completes
            lastRequestTime = Date.now();

            // Decrement queue size on success
            queueSize--;

            resolveRequest!(result);
        } catch (error) {
            lastRequestTime = Date.now();

            // Decrement queue size on error
            queueSize--;

            rejectRequest!(error);
        }
    }).catch(error => {
        // If previous request failed, still execute this one
        // But decrement queue size
        queueSize--;
        rejectRequest!(error);
    });

    return currentRequest;
}

export interface TronGridEvent {
    event_name: string;
    contract_address?: string;
    result?: Record<string, unknown>;
    transaction_id: string;
    /** Ordinal of this log within its parent transaction — the protocol `log_index`. */
    event_index?: number;
    /** Including block height. */
    block_number?: number;
    /** Block execution time in epoch milliseconds. */
    block_timestamp?: number;
}

export interface TronGridAccountResourceResponse {
    TotalEnergyLimit: number;
    TotalEnergyWeight: number;
    TotalNetLimit: number;
    TotalNetWeight: number;
    EnergyLimit?: number;
    EnergyUsage?: number;
    NetLimit?: number;
    NetUsage?: number;
    freeNetLimit?: number;
    freeNetUsed?: number;
}

export interface TronGridEnergyPricePoint {
    time: string;
    price: number;
}

export interface TronGridDelegatedAccountIndexResponse {
    toAccounts?: Array<string | { toAddress?: string }>;
}

export interface TronGridDelegatedResourceEntry {
    from?: string;
    fromAddress?: string;
    to?: string;
    toAddress?: string;
    frozen_balance_for_energy?: number;
    expire_time_for_energy?: number;
    frozen_balance_for_bandwidth?: number;
    expire_time_for_bandwidth?: number;
}

export interface TronGridDelegatedResourceResponse {
    delegatedResource?: TronGridDelegatedResourceEntry[];
}

export interface TronGridAccountPermission {
    id: number;
    permission_name?: string;
    threshold?: number;
    keys?: Array<{
        address: string;
        weight: number;
    }>;
}

export interface TronGridAccountResponse {
    address?: string;
    balance?: number;
    create_time?: number;
    active_permission?: TronGridAccountPermission[];
    owner_permission?: TronGridAccountPermission;
    /**
     * Stake 2.0 staked balances. Each entry's `type` is `'ENERGY'` or
     * `'BANDWIDTH'`; TronGrid omits `type` for the bandwidth entry, so an absent
     * type means bandwidth. `amount` is in sun.
     */
    frozenV2?: Array<{ type?: string; amount?: number }>;
    /**
     * Stake 2.0 pending unstake operations. `unfreeze_amount` (sun) is locked
     * until `unfreeze_expire_time` (epoch ms); summed, this is the unstaking queue.
     */
    unfrozenV2?: Array<{ type?: string; unfreeze_amount?: number; unfreeze_expire_time?: number }>;
    /** Current Super Representative vote allocations. */
    votes?: Array<{ vote_address?: string; vote_count?: number }>;
    /**
     * TRC20 balances as an array of single-entry `{ contractAddress: rawBalance }`
     * objects (TronGrid's wire shape), the raw balance a decimal string.
     */
    trc20?: Array<Record<string, string>>;
    /**
     * TRX (sun) this account froze for bandwidth but delegated OUT to another
     * address to use. Still this account's own stake — it counts toward its
     * net worth and its own TRON Power/votes — TronGrid just excludes it from
     * `frozenV2` once delegated out. Mirrors protobuf
     * `Account.delegated_frozenV2_balance_for_bandwidth`.
     */
    delegated_frozenV2_balance_for_bandwidth?: number;
    /** Nested per protobuf `Account.account_resource`; carries the energy-side delegated-out counterpart. */
    account_resource?: {
        /**
         * TRX (sun) this account froze for energy but delegated OUT to
         * another address. Same ownership semantics as the bandwidth field above.
         */
        delegated_frozenV2_balance_for_energy?: number;
    };
}

/**
 * Minimal shape of the v1 `/accounts/{address}/transactions` response consumed
 * when resolving an activator — only the oldest row's owner, id, timestamp, and
 * contract type are read, so the rest of TronGrid's envelope is intentionally
 * left untyped.
 */
interface IAccountTransactionsResponse {
    data?: Array<{
        txID: string;
        block_timestamp: number;
        raw_data?: {
            contract?: Array<{
                type?: string;
                parameter?: { value?: { owner_address?: string; to_address?: string } };
            }>;
        };
    }>;
}

/**
 * Minimal internal-transaction envelope, typed to the fields the activator
 * fallback reads. Declared locally for the same reason as
 * {@link IAccountTransactionsResponse} — and deliberately not imported from the
 * account-history module, which keeps its own richer copy: a cross-module type
 * import would couple this transport to one of its consumers.
 *
 * Addresses arrive as 41-prefixed hex. `data.rejected` marks an internal
 * transfer whose execution reverted — it moved no value and so activated
 * nothing.
 */
interface IAccountInternalTransactionsResponse {
    data?: Array<{
        internal_tx_id?: string;
        tx_id?: string;
        block_timestamp?: number;
        from_address?: string;
        to_address?: string;
        data?: {
            note?: string;
            rejected?: boolean;
            call_value?: Record<string, number | string>;
        };
    }>;
}

/**
 * Contract type reported for an edge resolved from the internal-transactions
 * feed. An internal transfer carries no protocol contract type of its own — the
 * enclosing transaction's type describes the call, not the value move — so this
 * synthetic label tells consumers (and the ladder UI that prints it) that the
 * hop came from TVM-level execution rather than a signed top-level contract.
 */
const INTERNAL_ACTIVATION_CONTRACT_TYPE = 'InternalTransaction';

/**
 * Page size for the internal-transactions activator lookup. The activating
 * transfer is the oldest inbound one, but the feed also carries outbound and
 * reverted rows, so `limit: 1` could land on a row that is not a usable edge.
 * A small page gives the scan something to skip past at the cost of a single
 * request; an account whose first rows are all unusable is treated as
 * unresolvable rather than paged further, because the climb must stay bounded
 * against the shared TronGrid budget.
 */
const INTERNAL_ACTIVATION_SCAN_LIMIT = 20;

/**
 * Contract types that can bring a new account into existence, and therefore the
 * only ones whose sender may be attributed as an activator.
 *
 * On TRON an account comes into existence in exactly these ways: a TRX transfer,
 * a TRC-10 asset transfer, an explicit account creation, a contract deployment,
 * or a TVM-level transfer of TRX/TRC-10 (which this feed cannot see at all and
 * which `resolveInternalActivator` handles instead). Nothing else creates an
 * account, and two types make that concrete: `DelegateResourceContract` and
 * `AccountPermissionUpdateContract` are both *rejected* by java-tron when the
 * target account does not exist, so neither can ever be an activation.
 *
 * Why this is a filter and not a comment: the timestamp check alone is not
 * sufficient. A mainnet account activated by an internal transfer was found
 * whose oldest visible transaction is a third party's `DelegateResourceContract`
 * landing three blocks after creation — inside any sane skew window. Attributing
 * that delegator would be a false parent presented as fact, and the fix is to
 * ask what the transaction *does* rather than only when it happened. The type
 * filter also covers the case where `create_time` is unavailable (contract
 * accounts carry none), which leaves the timestamp check with nothing to test.
 *
 * A TRC-20 transfer is deliberately absent. It only writes an entry in the token
 * contract's own storage, so it activates nothing — an address can hold a USDT
 * balance with no account record at all.
 *
 * `AccountCreateContract` is the protobuf name; `CreateAccountContract` is the
 * spelling some tooling reports, so both are accepted rather than betting on
 * which one a given response carries.
 */
/**
 * What one `wallet/getaccount` read contributes to an activation edge.
 *
 * Bundled rather than returned as two values because both come off the same
 * response and both paths through {@link TronGridClient.getActivatingTransaction}
 * need them: the creation stamp to verify the attribution, the controllers to
 * report who else can act for the account.
 */
interface IAccountActivationFacts {
    /** Creation stamp in epoch ms, or undefined when the record carries none. */
    createTime?: number;
    /** Other accounts holding owner or active permission, excluding the subject. */
    controllers: string[];
}

const ACCOUNT_CREATING_CONTRACT_TYPES = new Set([
    'AccountCreateContract',
    'CreateAccountContract',
    'TransferContract',
    'TransferAssetContract',
    'CreateSmartContract'
]);

export class TronGridClient {
    private static instance: TronGridClient | null = null;

    /**
   * Private constructor to enforce singleton pattern
   * Rate limiting is enforced at the module level (global queue/state)
   * but singleton ensures we don't waste memory with multiple instances
   */
    private constructor() {}

    /**
   * Get the singleton instance of TronGridClient
   * This ensures all parts of the application share the same client instance
   */
    static getInstance(): TronGridClient {
        if (!TronGridClient.instance) {
            TronGridClient.instance = new TronGridClient();
        }
        return TronGridClient.instance;
    }

    /**
   * Reset the singleton instance (for testing only)
   * @internal
   */
    static resetInstance(): void {
        TronGridClient.instance = null;
    }

    /**
     * Create an independent TronWeb instance pre-configured with the platform's
     * TronGrid host and a rotating API key.
     *
     * Each call returns a fresh instance that the caller owns completely. The
     * caller may set a private key, change the address, or reconfigure the
     * instance without affecting other consumers or the shared TronGridClient.
     *
     * @param options - Optional overrides for the default platform configuration
     * @param options.privateKey - Private key to enable signing and wallet operations
     * @param options.fullHost - Override the default TronGrid endpoint
     * @returns A new, fully independent TronWeb instance
     */
    createTronWeb(options?: { privateKey?: string; fullHost?: string }): TronWeb {
        const instance = new TronWeb({
            fullHost: options?.fullHost ?? BASE_URL,
            privateKey: options?.privateKey
        });
        const apiKey = getNextApiKey();
        if (apiKey) {
            instance.setHeader({ 'TRON-PRO-API-KEY': apiKey });
        }
        return instance;
    }

    async getNowBlock(): Promise<TronGridBlock> {
        return retry(() => this.post<TronGridBlock>('/wallet/getnowblock', {}), {
            ...blockchainConfig.retry,
            onRetry: (attempt, error) => logger.warn({ attempt, error }, 'Retrying TronGrid getNowBlock')
        });
    }

    /**
     * Fetch a transaction's decoded event logs without error handling. Shared by
     * the lenient {@link getTransactionEvents} and the strict
     * {@link getTransactionEventsOrThrow} so the two differ only in how a failure is
     * surfaced, never in how the request is made.
     *
     * @param txId - Transaction hash whose event logs to read.
     * @returns The decoded events, or an empty array when the transaction has none.
     */
    private async fetchTransactionEvents(txId: string): Promise<TronGridEvent[]> {
        return enqueueRequest(async () => {
            const response = await httpClient.get<{ data: TronGridEvent[] }>(
                `${BASE_URL}/v1/transactions/${txId}/events`,
                {
                    headers: buildHeaders()
                }
            );
            return response.data?.data ?? [];
        });
    }

    /**
     * Lenient events read: returns `[]` on any failure. Suited to best-effort
     * enrichment where a missed fetch is acceptable (e.g. alert decoration) and the
     * caller cannot distinguish — nor needs to distinguish — "no events" from
     * "fetch failed".
     *
     * @param txId - Transaction hash whose event logs to read.
     * @returns The decoded events, or `[]` when the transaction has none OR the fetch failed.
     */
    async getTransactionEvents(txId: string): Promise<TronGridEvent[]> {
        try {
            return await this.fetchTransactionEvents(txId);
        } catch (error) {
            logger.error({ error, txId }, 'Failed to fetch transaction events');
            return [];
        }
    }

    /**
     * Strict events read: throws on a fetch failure instead of masking it as `[]`.
     * Required by callers that key durable state on the result — the account-history
     * token-leg sweep advances a cursor past each transaction it reads, so a
     * silently-empty result on a transient 429/network error would skip a
     * transaction's token legs permanently (they are unreconstructable without the
     * events `log_index`). Throwing lets the caller's insert-before-cursor-advance
     * discipline leave the work re-ingestable.
     *
     * @param txId - Transaction hash whose event logs to read.
     * @returns The decoded events, or `[]` only when the transaction genuinely has none.
     */
    async getTransactionEventsOrThrow(txId: string): Promise<TronGridEvent[]> {
        return this.fetchTransactionEvents(txId);
    }

    async getBlockByNumber(blockNumber: number): Promise<TronGridBlock> {
        return retry(() => this.post<TronGridBlock>('/wallet/getblockbynum', { num: blockNumber }), {
            retries: 6,
            delayMs: 1000,
            factor: 2,
            onRetry: (attempt, error) => logger.warn({ attempt, error, blockNumber }, 'Retrying TronGrid getBlockByNumber')
        });
    }

    /**
     * Fetch a single raw transaction by id via `/wallet/gettransactionbyid`.
     *
     * Returns the transaction's `raw_data` (contract, memo, type) and `ret`
     * (contractRet status). This is the complement to `getTransactionInfo`,
     * which carries the receipt, fee, and block number but not `raw_data`.
     * Returns null on any error or when the id is unknown so callers can treat
     * a miss as "not resolvable" rather than throwing.
     *
     * @param txId - Transaction hash to fetch.
     * @returns The raw transaction, or null.
     */
    async getTransactionById(txId: string): Promise<TronGridTransaction | null> {
        try {
            const tx = await retry(
                () => this.post<TronGridTransaction>('/wallet/gettransactionbyid', { value: txId }),
                {
                    ...blockchainConfig.retry,
                    onRetry: (attempt, error) => logger.warn({ attempt, error, txId }, 'Retrying TronGrid getTransactionById')
                }
            );
            // An unknown id returns an empty object `{}` (no txID), not an error.
            return tx?.txID ? tx : null;
        } catch (error) {
            logger.error({ error, txId }, 'Failed to fetch transaction by id');
            return null;
        }
    }

    /**
     * Fetch every transaction receipt in one block via
     * `/wallet/gettransactioninfobyblocknum`.
     *
     * Block sync needs receipts to populate the energy, bandwidth, and internal
     * transaction fields, which the block payload itself does not carry. Asking
     * for them one transaction at a time through {@link getTransactionInfo} would
     * mean several hundred requests for a busy block, and at the client's 200ms
     * request gap that is tens of seconds per block. This endpoint answers for
     * the whole block at once, so the cost stays at one extra call — one extra
     * throttle slot — however many transactions the block holds.
     *
     * A failure returns an empty array rather than throwing, because the caller
     * treats receipts as enrichment: a block that loses them is still a complete,
     * correctly indexed block, and failing the whole block over an optional
     * enrichment call would push it into the backfill queue over a problem it can
     * survive.
     *
     * @param blockNumber - Height whose receipts are wanted. The caller already
     *                      holds the block itself and needs only the execution
     *                      results the block payload omits.
     * @returns One entry per transaction, each carrying the `id` a caller joins
     *          back to the block's transactions on. Empty when the block has no
     *          transactions or the request failed.
     */
    async getTransactionInfoByBlockNum(blockNumber: number): Promise<TronGridTransactionInfo[]> {
        let infos: TronGridTransactionInfo[] = [];

        try {
            const response = await retry(
                () => this.post<TronGridTransactionInfo[]>('/wallet/gettransactioninfobyblocknum', { num: blockNumber }),
                {
                    ...blockchainConfig.retry,
                    onRetry: (attempt, error) =>
                        logger.warn({ attempt, error, blockNumber }, 'Retrying TronGrid getTransactionInfoByBlockNum')
                }
            );
            // A block holding no transactions answers with an empty object rather
            // than an empty array, so the shape check is what stops a non-array
            // reaching a caller that is about to map over it.
            infos = Array.isArray(response) ? response : [];
        } catch (error) {
            logger.error({ error, blockNumber }, 'Failed to fetch block transaction receipts');
        }

        return infos;
    }

    async getTransactionInfo(txId: string): Promise<TronGridTransactionInfo | null> {
        try {
            return await retry(
                () => this.post<TronGridTransactionInfo>('/wallet/gettransactioninfobyid', { value: txId }),
                {
                    ...blockchainConfig.retry,
                    onRetry: (attempt, error) => logger.warn({ attempt, error, txId }, 'Retrying TronGrid getTransactionInfo')
                }
            );
        } catch (error) {
            logger.error({ error, txId }, 'Failed to fetch transaction info');
            return null;
        }
    }

    async getAccountResource(address: string, visible = true): Promise<TronGridAccountResourceResponse> {
        return retry(
            () => this.post<TronGridAccountResourceResponse>('/wallet/getaccountresource', { address, visible }),
            {
                ...blockchainConfig.retry,
                onRetry: (attempt, error) =>
                    logger.warn({ attempt, error, address }, 'Retrying TronGrid getAccountResource')
            }
        );
    }

    async getEnergyPrices(): Promise<TronGridEnergyPricePoint[]> {
        try {
            return await enqueueRequest(async () => {
                const response = await httpClient.get<{ prices: string | null }>(`${BASE_URL}/wallet/getenergyprices`, {
                    headers: buildHeaders()
                });

                const raw = response.data?.prices;
                if (!raw) {
                    return [];
                }

                return raw
                    .split(',')
                    .map(point => point.trim())
                    .filter(Boolean)
                    .map(point => {
                        const [time, price] = point.split(':');
                        const numericPrice = Number(price);
                        return {
                            time,
                            price: Number.isFinite(numericPrice) ? numericPrice : NaN
                        };
                    })
                    .filter(item => Number.isFinite(item.price));
            });
        } catch (error) {
            logger.error({ error }, 'Failed to fetch energy prices');
            return [];
        }
    }

    async getDelegatedResourceAccountIndex(address: string, visible = true): Promise<string[]> {
        try {
            const response = await this.post<TronGridDelegatedAccountIndexResponse>(
                '/wallet/getdelegatedresourceaccountindexv2',
                {
                    value: address,
                    visible
                }
            );

            const accounts = response?.toAccounts;
            if (!accounts || !Array.isArray(accounts)) {
                return [];
            }

            return accounts
                .map(item => {
                    if (typeof item === 'string') {
                        return item;
                    }
                    if (item && typeof item.toAddress === 'string') {
                        return item.toAddress;
                    }
                    return null;
                })
                .filter((value): value is string => Boolean(value));
        } catch (error) {
            logger.error({ error, address }, 'Failed to fetch delegated resource account index');
            return [];
        }
    }

    async getDelegatedResource(
        fromAddress: string,
        toAddress: string,
        visible = true
    ): Promise<TronGridDelegatedResourceResponse | null> {
        try {
            return await this.post<TronGridDelegatedResourceResponse>('/wallet/getdelegatedresourcev2', {
                fromAddress,
                toAddress,
                visible
            });
        } catch (error) {
            logger.error({ error, fromAddress, toAddress }, 'Failed to fetch delegated resource');
            return null;
        }
    }

    /**
     * Get account information including permissions.
     * Used by plugins to discover pool memberships via active_permission keys.
     */
    async getAccount(address: string, visible = true): Promise<TronGridAccountResponse | null> {
        try {
            return await retry(
                () => this.post<TronGridAccountResponse>('/wallet/getaccount', { address, visible }),
                {
                    ...blockchainConfig.retry,
                    onRetry: (attempt, error) =>
                        logger.warn({ attempt, error, address }, 'Retrying TronGrid getAccount')
                }
            );
        } catch (error) {
            logger.error({ error, address }, 'Failed to fetch account');
            return null;
        }
    }

    /**
     * Probe an account's unclaimed (withdrawable) staking/vote rewards via
     * `/wallet/getReward`. The reward is real net worth the ledger cannot see —
     * it enters the balance only when a `WithdrawBalanceContract` claims it — so
     * the balance-snapshot sampler reads it here. Returns 0 on a miss or a
     * transport failure (logged) rather than throwing: a snapshot without the
     * reward figure is still worth capturing, and callers treat 0 as "none known".
     *
     * @param address - Base58 account address to probe.
     * @param visible - True to send/receive base58 addresses (TronGrid's `visible` flag).
     * @returns The withdrawable reward in sun, or 0 when none/unavailable.
     */
    async getReward(address: string, visible = true): Promise<number> {
        try {
            const response = await retry(
                () => this.post<{ reward?: number }>('/wallet/getReward', { address, visible }),
                {
                    ...blockchainConfig.retry,
                    onRetry: (attempt, error) =>
                        logger.warn({ attempt, error, address }, 'Retrying TronGrid getReward')
                }
            );
            const reward = Number(response?.reward ?? 0);
            return Number.isFinite(reward) && reward > 0 ? reward : 0;
        } catch (error) {
            logger.error({ error, address }, 'Failed to fetch withdrawable reward');
            return 0;
        }
    }

    /**
     * Resolve a TRC10 token to its source-agnostic record by chain-assigned id.
     *
     * Queries `/wallet/getassetissuebyid` and maps the raw asset to {@link ITrc10}.
     * The hex form is requested deliberately so decoding is deterministic; the
     * caller never sees the wire shape. Returns null on a malformed id, a miss,
     * or a transport failure (logged) so callers branch on presence, not throws.
     *
     * @param tokenId - Chain-assigned numeric asset id, as a string.
     * @returns The resolved token, or null when none carries that id.
     */
    async getTrc10(tokenId: string): Promise<ITrc10 | null> {
        if (!tokenId || !/^\d+$/.test(String(tokenId))) {
            return null;
        }
        try {
            const raw = await retry(
                () => this.post<TronGridAssetIssue>('/wallet/getassetissuebyid', { value: String(tokenId) }),
                {
                    ...blockchainConfig.retry,
                    onRetry: (attempt, error) =>
                        logger.warn({ attempt, error, tokenId }, 'Retrying TronGrid getAssetIssueById')
                }
            );
            return TronGridClient.mapAssetIssueToTrc10(raw);
        } catch (error) {
            logger.error({ error, tokenId }, 'Failed to fetch TRC10 token by id');
            return null;
        }
    }

    /**
     * Resolve the single TRC10 token issued by an account, by owner address.
     *
     * TRON permits exactly one asset issuance per account, so the owner resolves
     * the token deterministically even when its id is not yet known — the case a
     * creation observer faces, and the basis for the "already issued?" pre-flight
     * check. Queries `/wallet/getassetissuebyaccount` (owner sent as hex for
     * deterministic decoding) and returns the first asset mapped to {@link ITrc10}.
     *
     * @param ownerAddress - Base58 issuer address.
     * @returns The account's token, or null when it has issued none.
     */
    async getTrc10ByOwner(ownerAddress: string): Promise<ITrc10 | null> {
        if (!ownerAddress) {
            return null;
        }
        let ownerHex: string;
        try {
            ownerHex = ownerAddress.startsWith('T') ? tronWeb.address.toHex(ownerAddress) : ownerAddress;
        } catch (error) {
            logger.warn({ error, ownerAddress }, 'Failed to convert owner address to hex');
            return null;
        }
        try {
            const response = await retry(
                () => this.post<{ assetIssue?: TronGridAssetIssue[] }>('/wallet/getassetissuebyaccount', { address: ownerHex }),
                {
                    ...blockchainConfig.retry,
                    onRetry: (attempt, error) =>
                        logger.warn({ attempt, error, ownerAddress }, 'Retrying TronGrid getAssetIssueByAccount')
                }
            );
            const first = response?.assetIssue?.[0];
            return first ? TronGridClient.mapAssetIssueToTrc10(first) : null;
        } catch (error) {
            logger.error({ error, ownerAddress }, 'Failed to fetch TRC10 token by owner');
            return null;
        }
    }

    /**
     * Map a raw TronGrid asset-issue record to the normalized {@link ITrc10}.
     *
     * Centralizes every decode (hex text → UTF-8, hex owner → Base58, SUN/epoch
     * normalization) so the wire shape stays contained in this client. Returns
     * null when the record lacks a token id, since an id-less record cannot be
     * linked or looked up and is not worth surfacing.
     *
     * @param raw - The asset object straight from TronGrid.
     * @returns A normalized token record, or null when it has no id.
     */
    private static mapAssetIssueToTrc10(raw: TronGridAssetIssue | null | undefined): ITrc10 | null {
        if (!raw || raw.id === undefined || raw.id === null || String(raw.id).length === 0) {
            return null;
        }
        return {
            tokenId: String(raw.id),
            ownerAddress: TronGridClient.toBase58Address(raw.owner_address) ?? '',
            name: TronGridClient.hexToUtf8(raw.name),
            abbreviation: TronGridClient.hexToUtf8(raw.abbr),
            description: TronGridClient.hexToUtf8(raw.description),
            url: TronGridClient.hexToUtf8(raw.url),
            totalSupply: Number(raw.total_supply ?? 0),
            precision: Number(raw.precision ?? 0),
            icoNumTokens: Number(raw.num ?? 0),
            icoTrxNum: Number(raw.trx_num ?? 0),
            saleStart: Number(raw.start_time ?? 0),
            saleEnd: Number(raw.end_time ?? 0),
            frozenSupply: Array.isArray(raw.frozen_supply)
                ? raw.frozen_supply.map(entry => ({
                    frozenAmount: Number(entry.frozen_amount ?? 0),
                    frozenDays: Number(entry.frozen_days ?? 0)
                }))
                : [],
            freeAssetNetLimit: Number(raw.free_asset_net_limit ?? 0),
            publicFreeAssetNetLimit: Number(raw.public_free_asset_net_limit ?? 0),
            voteScore: Number(raw.vote_score ?? 0)
        };
    }

    /**
     * Decode a TronGrid hex-encoded text field to UTF-8.
     *
     * Asset name/abbr/description/url come back hex-encoded when queried without
     * `visible`. The guard tolerates an already-decoded value (returned as-is)
     * so a provider quirk can't crash the mapper.
     *
     * @param hex - Hex string from TronGrid, or undefined.
     * @returns The decoded text, or '' when absent or undecodable.
     */
    private static hexToUtf8(hex?: string): string {
        if (!hex) {
            return '';
        }
        try {
            if (/^[0-9a-fA-F]*$/.test(hex) && hex.length % 2 === 0) {
                return Buffer.from(hex, 'hex').toString('utf8');
            }
            return hex;
        } catch {
            return '';
        }
    }

    /**
     * Fetch paginated TRC20 transactions for an account via the v1 REST API.
     *
     * @param base58Address - Account address in base58 format
     * @param params - Query parameters (only_confirmed, limit, fingerprint, etc.)
     * @returns Raw response data with transactions and pagination metadata
     */
    async getTrc20Transactions<T>(base58Address: string, params: Record<string, string | number | boolean>): Promise<T> {
        return enqueueRequest(async () => {
            const response = await httpClient.get<T>(
                `${BASE_URL}/v1/accounts/${base58Address}/transactions/trc20`,
                { params, headers: buildHeaders(), timeout: 15000 }
            );
            return response.data;
        });
    }

    /**
     * Fetch a contract's emitted events via the v1 REST API, filtered
     * server-side by `event_name` so rare events on a high-volume contract
     * cost one request per poll instead of a client-side sift through the
     * firehose. The address-tags module polls the USDT contract's
     * `AddedBlackList`/`RemovedBlackList` this way — the alternative, a
     * `TriggerSmartContract` observer, would receive every USDT transfer on
     * TRON and shed exactly the rare events that matter when its bounded
     * queue overflows.
     *
     * Routed through the same `enqueueRequest` throttle and rotating-key
     * headers as every other call, so scheduled polls share the global
     * TronGrid budget with live block sync.
     *
     * @param contractAddress - Base58 contract address whose events to read.
     * @param params - Query parameters (`event_name`, `min_block_timestamp`,
     *                 `order_by`, `limit`, `fingerprint`).
     * @returns Raw response data with events and pagination metadata
     *          (`meta.fingerprint`).
     */
    async getContractEvents<T>(contractAddress: string, params: Record<string, string | number | boolean>): Promise<T> {
        return enqueueRequest(async () => {
            const response = await httpClient.get<T>(
                `${BASE_URL}/v1/contracts/${contractAddress}/events`,
                { params, headers: buildHeaders(), timeout: 15000 }
            );
            return response.data;
        });
    }

    /**
     * Fetch paginated native/contract transactions for an account via the v1 REST API.
     *
     * Covers every non-TRC20 transaction type — native TRX transfers, TRC10,
     * staking/delegation, and raw contract calls — that the account participated
     * in. Pair this with `getTrc20Transactions` to assemble an account's complete
     * history; the account-history module walks both, fingerprint-paged.
     *
     * Routed through the same `enqueueRequest` throttle and rotating-key headers
     * as every other call, so a long account backfill shares the global TronGrid
     * rate budget rather than competing with live block sync.
     *
     * @param base58Address - Account address in base58 format.
     * @param params - Query parameters (`only_confirmed`, `limit`, `fingerprint`, optional `min_timestamp`/`max_timestamp`).
     * @returns Raw response data with transactions and pagination metadata (`meta.fingerprint`).
     */
    async getAccountTransactions<T>(base58Address: string, params: Record<string, string | number | boolean>): Promise<T> {
        return enqueueRequest(async () => {
            const response = await httpClient.get<T>(
                `${BASE_URL}/v1/accounts/${base58Address}/transactions`,
                { params, headers: buildHeaders(), timeout: 15000 }
            );
            return response.data;
        });
    }

    /**
     * Fetch paginated internal (TVM) transactions for an account via the v1 REST
     * API. Internal transfers are TRX/TRC10 moves a contract performs during
     * execution; they are not top-level transactions, so neither
     * `getAccountTransactions` nor `getTrc20Transactions` surfaces them — a contract
     * paying TRX to the account is invisible without this endpoint. Each item
     * carries the protocol internal-transaction hash (`internal_tx_id`, identical to
     * the node's `TransactionInfo` hash) and an inline `call_value` asset map, so
     * value attribution needs no per-transaction detail call.
     *
     * Routed through the same `enqueueRequest` throttle and rotating-key headers as
     * every other call, so it shares the global TronGrid budget with live block sync.
     *
     * @param base58Address - Account address in base58 format.
     * @param params - Query parameters (`only_confirmed`, `limit`, `fingerprint`, `order_by`).
     * @returns Raw response data with internal transactions and pagination metadata (`meta.fingerprint`).
     */
    async getAccountInternalTransactions<T>(base58Address: string, params: Record<string, string | number | boolean>): Promise<T> {
        return enqueueRequest(async () => {
            const response = await httpClient.get<T>(
                `${BASE_URL}/v1/accounts/${base58Address}/internal-transactions`,
                { params, headers: buildHeaders(), timeout: 15000 }
            );
            return response.data;
        });
    }

    /**
     * Resolve the account that activated `base58Address`, guarding against the
     * top-level feed's blind spot for internally-activated accounts.
     *
     * Why: every TRON address only exists after a funded account pays (~1 TRX) to
     * create it, so the account's activating transaction is its oldest and that
     * transaction's `owner_address` is the activator. Ancestor-climb tooling walks
     * this edge repeatedly to trace an address back toward its origin, so resolving
     * it from just the single oldest transaction (ascending, `limit=1`) keeps the
     * common path to one request rather than a full history walk.
     *
     * The trap: the account-transactions feed surfaces only top-level transactions,
     * NOT the internal (contract) transfer that activates an account created by a
     * contract. For such an account the oldest VISIBLE transaction is a later,
     * unrelated transfer, and its `owner_address` is that later sender — not the
     * activator. The `owner !== self` check alone cannot tell this false edge apart
     * from a genuine funder→account transfer, because both have a third-party owner.
     *
     * How: after finding a candidate edge, put it through
     * {@link isPlausibleActivation}, which asks both what the transaction does
     * and when it happened — the account's authoritative `create_time` comes from
     * {@link getAccount} for the second half of that test. A candidate that fails
     * either half is not the activation, which means the real one happened
     * through an internal transfer this feed cannot see, so the method falls back
     * to {@link resolveInternalActivator}: it reads the same activation off the
     * internal-transactions endpoint and returns the contract that paid for it.
     * Only when that fallback also finds nothing is the activator truly
     * unresolvable and null returned.
     *
     * Cost: two throttled requests on the common path, three when the internal
     * fallback runs — which includes accounts with no top-level transactions at
     * all, because those still need the account record and the internal feed
     * before they can be called unresolvable. Every call shares the rotating-key
     * headers and the global TronGrid rate budget, so a caller climbing a chain
     * must stay sequential and bound its depth.
     *
     * @param base58Address - Account whose activator to resolve, base58 format.
     * @returns The activating edge — from the top-level feed, or from the internal
     *   feed when the account was activated by a contract — or null when neither
     *   feed yields a usable edge (no transactions at all, or an activation whose
     *   sender cannot be attributed).
     * @throws When the account record cannot be read, because the guard below
     *   cannot distinguish a genuine activation from a false one without it and
     *   an unverified edge must never be published as fact.
     */
    async getActivatingTransaction(base58Address: string): Promise<IActivatingTransaction | null> {
        const response = await this.getAccountTransactions<IAccountTransactionsResponse>(base58Address, {
            only_confirmed: true,
            limit: 1,
            order_by: 'block_timestamp,asc'
        });
        let result: IActivatingTransaction | null = null;
        // Read once and reused by both paths below: the account record carries the
        // creation stamp the guard needs and the permission keys the subject is
        // controlled by, and neither path should pay for a second lookup.
        let facts: IAccountActivationFacts | null = null;
        const oldest = response.data?.[0];
        const contract = oldest?.raw_data?.contract?.[0];
        const activatorAddress = TronGridClient.toBase58Address(contract?.parameter?.value?.owner_address);
        if (oldest && activatorAddress && activatorAddress !== base58Address) {
            // Confirm the candidate is genuinely the activation and not a later
            // transfer that merely happens to be the oldest VISIBLE one. The account
            // was activated at its authoritative create_time; if that predates the
            // oldest visible transaction, the real (internal) activation is invisible
            // to this feed and attributing this transfer's sender would be a false
            // edge, so leave result null.
            facts = await this.fetchAccountActivationFacts(base58Address);
            if (TronGridClient.isPlausibleActivation(oldest.block_timestamp, facts.createTime, contract?.type)) {
                result = {
                    subjectAddress: base58Address,
                    activatorAddress,
                    txId: oldest.txID,
                    blockTimestamp: oldest.block_timestamp,
                    contractType: contract?.type ?? 'unknown',
                    subjectControllers: facts.controllers,
                    creationTimeVerified: typeof facts.createTime === 'number'
                };
            }
        }
        if (!result) {
            // Every path that lands here means the top-level feed could not name an
            // activator: no transactions at all, an oldest transaction the account
            // sent itself, or a candidate the create_time guard rejected as a false
            // edge. All three are the signature of a contract-created account, whose
            // activating value move is an internal transfer. Resolving it costs one
            // more request and is paid only on this uncommon path.
            if (!facts) {
                facts = await this.fetchAccountActivationFacts(base58Address);
            }
            result = await this.resolveInternalActivator(base58Address, facts);
        }
        return result;
    }

    /**
     * Read everything the account record contributes to an activation edge in one
     * request: the creation stamp the guard checks against, and the other accounts
     * holding permission over this one.
     *
     * Why the two come together: both live on the same `wallet/getaccount`
     * response, the guard already requires that call, and a separate lookup for
     * the permission keys would double the cost of the common path for
     * information already in hand.
     *
     * Why a failed lookup throws: the guard treats an unknown `create_time` as
     * having nothing to disprove a candidate edge with. `getAccount` answers null
     * on a transport failure, so folding that into the same undefined value let
     * one failed request turn into a confidently-wrong parent presented to the
     * user as fact. The ancestry climb reports the throw as `provider-error` and
     * the tool offers a retry.
     *
     * @param base58Address - Account to read.
     * @returns Its creation stamp (undefined when the record carries none, as
     *   contract and genesis-era accounts do) and its other controllers.
     * @throws When the account lookup itself failed, so a provider outage is
     *   never mistaken for an account without a creation stamp.
     */
    private async fetchAccountActivationFacts(base58Address: string): Promise<IAccountActivationFacts> {
        const account = await this.getAccount(base58Address);
        if (!account) {
            throw new Error(`TronGrid account lookup failed for ${base58Address}; cannot verify its activating transaction.`);
        }
        return {
            createTime: typeof account.create_time === 'number' ? account.create_time : undefined,
            controllers: TronGridClient.resolveAccountControllers(base58Address, account)
        };
    }

    /**
     * List the other accounts that can authorise this account's transactions.
     *
     * Why an ancestry consumer wants this: a multi-signed account acts on keys
     * that may appear nowhere in its activation ancestry, so a single ladder
     * presented as the whole story is misleading. Surfacing the co-controllers
     * lets the reader follow a second lead instead.
     *
     * Every account has owner and active permissions listing itself, so the
     * subject is filtered out — what is left is non-empty only for genuinely
     * shared control. Addresses arrive base58 already because `getAccount` is
     * called with TronGrid's `visible` flag set.
     *
     * @param base58Address - The subject, excluded from its own controller list.
     * @param account - Account record whose permission keys to read.
     * @returns De-duplicated controller addresses, empty for a normal account.
     */
    private static resolveAccountControllers(
        base58Address: string,
        account: TronGridAccountResponse
    ): string[] {
        const permissions = [account.owner_permission, ...(account.active_permission ?? [])];
        const controllers = new Set<string>();
        for (const permission of permissions) {
            for (const key of permission?.keys ?? []) {
                if (key.address && key.address !== base58Address) {
                    controllers.add(key.address);
                }
            }
        }
        return [...controllers];
    }

    /**
     * Decide whether a candidate top-level transaction can be the account's
     * activation.
     *
     * Two independent tests, and a candidate must pass both. **What it does**: a
     * transaction type that cannot create an account never activated one, no
     * matter how close to creation it landed (see
     * {@link ACCOUNT_CREATING_CONTRACT_TYPES}). **When it happened**: a creating
     * transaction confirmed more than {@link ACTIVATION_CREATE_TIME_SKEW_MS}
     * after the account already existed is ordinary later funding rather than the
     * activation. Each test catches false edges the other lets through — a
     * delegation landing in the very next block passes the timestamp test, and a
     * transfer arriving years later passes the type test.
     *
     * The timestamp test is skipped, not failed, when the account carries no
     * `create_time`. Contract accounts have none, so requiring one would refuse
     * to resolve any deployed contract to its deployer; the type test still
     * applies and is what keeps that case honest.
     *
     * @param blockTimestamp - Block-confirmation time of the candidate transaction.
     * @param createTime - The account's creation stamp, or undefined when TronGrid
     *   carries none, which disables the proximity test alone.
     * @param contractType - Candidate's contract type, tested against the set of
     *   types that can create an account.
     * @returns True when the candidate may be attributed as the activator.
     */
    private static isPlausibleActivation(
        blockTimestamp: number,
        createTime: number | undefined,
        contractType: string | undefined
    ): boolean {
        const couldCreateAccount = ACCOUNT_CREATING_CONTRACT_TYPES.has(contractType ?? '');
        const withinCreationWindow =
            typeof createTime !== 'number' ||
            blockTimestamp - createTime <= ACTIVATION_CREATE_TIME_SKEW_MS;
        return couldCreateAccount && withinCreationWindow;
    }

    /**
     * Resolve an activator from the internal-transactions feed, why: an account
     * created by a contract — an exchange sweeper, a router, a batch disburser —
     * is funded by a TVM-level transfer that no top-level feed reports, so
     * {@link getActivatingTransaction} alone stops the ancestry climb at a wall
     * and reports a false origin. Reading the same activation from
     * {@link getAccountInternalTransactions} names the contract that paid for it
     * and lets the climb continue through it.
     *
     * How: take the oldest confirmed inbound, non-reverted, value-bearing
     * internal transfer and treat its sender as the activator. `only_to=true`
     * asks the provider for inbound rows alone, so the page cannot be filled
     * with the account's own outbound transfers and push the activating row past
     * the scan limit — which would report a contract-created account as having
     * no attributable activator at all. Rows are still filtered here rather than
     * trusting position, because a reverted or zero-value inbound row activates
     * nothing and the provider has no flag for either. The
     * candidate is then held to the same `create_time` proximity test the
     * top-level path uses ({@link ACTIVATION_CREATE_TIME_SKEW_MS}): a transfer
     * arriving long after the account already existed is ordinary later activity,
     * not the activation, and attributing it would trade one false edge for
     * another.
     *
     * The contract is only half the answer, so the parent transaction is read as
     * well and its signer recorded as {@link IActivatingTransaction.callerAddress}.
     * A contract is code and cannot own an account; the signer is the
     * key-controlled party that caused the execution and paid for it. Both are
     * genuine and neither is sufficient — the signer may be a relayer acting for
     * someone else, and the value may have been passed through the contract from
     * the signer rather than drawn from the contract's own balance, which this
     * feed cannot distinguish. Recording both is the only honest option, and it
     * costs one extra request on a path taken by roughly one account in fifty.
     *
     * @param base58Address - Account whose activator to resolve, base58 format.
     * @param facts - The subject's creation stamp and controllers, already fetched
     *        by the caller so this method adds no second `getAccount` call. An
     *        absent creation stamp disables the proximity test rather than
     *        rejecting the edge, there being nothing to disprove it with.
     * @returns The internal activating edge, or null when no inbound transfer
     *          qualifies — the genuinely unresolvable case.
     */
    private async resolveInternalActivator(
        base58Address: string,
        facts: IAccountActivationFacts
    ): Promise<IActivatingTransaction | null> {
        const response = await this.getAccountInternalTransactions<IAccountInternalTransactionsResponse>(base58Address, {
            only_confirmed: true,
            only_to: true,
            limit: INTERNAL_ACTIVATION_SCAN_LIMIT,
            order_by: 'block_timestamp,asc'
        });
        let result: IActivatingTransaction | null = null;
        for (const item of response.data ?? []) {
            if (item.data?.rejected) {
                continue;
            }
            // `call_value` maps asset → raw amount; key '_' is TRX (sun), any other
            // key a TRC10 id. A zero-value or empty map is a bare contract call,
            // which cannot have paid the account-creation fee.
            const movesValue = Object.values(item.data?.call_value ?? {})
                .some(amount => Number(amount) > 0);
            const recipient = TronGridClient.toBase58Address(item.to_address);
            const sender = TronGridClient.toBase58Address(item.from_address);
            const timestamp = item.block_timestamp;
            if (!movesValue || recipient !== base58Address || !sender || sender === base58Address || typeof timestamp !== 'number') {
                continue;
            }
            const arrivedAfterCreation =
                typeof facts.createTime === 'number' &&
                timestamp - facts.createTime > ACTIVATION_CREATE_TIME_SKEW_MS;
            if (!arrivedAfterCreation) {
                result = {
                    subjectAddress: base58Address,
                    activatorAddress: sender,
                    // The parent transaction hash, not `internal_tx_id`: consumers link
                    // this id to an explorer, and only the enclosing transaction has a
                    // page there. The internal hash is the fallback purely so a row
                    // TronGrid returns without a parent id still yields provenance.
                    txId: item.tx_id ?? item.internal_tx_id ?? '',
                    blockTimestamp: timestamp,
                    contractType: INTERNAL_ACTIVATION_CONTRACT_TYPE,
                    callerAddress: await this.resolveTransactionSigner(item.tx_id),
                    subjectControllers: facts.controllers,
                    creationTimeVerified: typeof facts.createTime === 'number'
                };
            }
            // The oldest qualifying row decides the outcome either way: if it failed
            // the proximity test, every later row is further from creation still.
            break;
        }
        return result;
    }

    /**
     * Resolve the key-controlled account that signed a transaction.
     *
     * Why the activation path needs it: an internal transfer names the contract
     * whose balance moved, and a contract cannot own anything. The signer of the
     * enclosing transaction is the party that ran that code and paid the energy,
     * so it is the account an ancestry climb should follow. It is deliberately not
     * presented as "the funder" — a relayer signs on someone else's behalf, and
     * the value may have originated with the signer rather than the contract.
     *
     * A failure returns undefined rather than throwing: the activation edge itself
     * is already resolved and useful, so losing the signer should cost the extra
     * lead, not the hop. The climb then falls back to the contract.
     *
     * @param txId - Enclosing transaction hash, taken from the internal row.
     * @returns The signer in base58, or undefined when the transaction could not
     *   be read or carries no owner — both of which leave the edge intact.
     */
    private async resolveTransactionSigner(txId: string | undefined): Promise<string | undefined> {
        let signer: string | undefined;
        if (txId) {
            const transaction = await this.getTransactionById(txId);
            const owner = transaction?.raw_data?.contract?.[0]?.parameter?.value?.owner_address;
            signer = TronGridClient.toBase58Address(typeof owner === 'string' ? owner : null) ?? undefined;
        }
        return signer;
    }

    /**
     * Execute a read-only smart contract call via triggerconstantcontract.
     *
     * No gas cost — used for querying contract state (e.g. allowance, balanceOf).
     *
     * @param payload - Contract call parameters (owner_address, contract_address, function_selector, parameter, visible)
     * @returns Trigger constant contract response with result data
     */
    async triggerConstantContract<T>(payload: Record<string, unknown>): Promise<T> {
        return this.post<T>('/wallet/triggerconstantcontract', payload);
    }

    private async post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
        return enqueueRequest(async () => {
            try {
                const response = await httpClient.post<T>(`${BASE_URL}${path}`, payload, {
                    headers: buildHeaders()
                });
                return response.data;
            } catch (error: unknown) {
                // Enhanced error handling to preserve API-specific error details
                if (error && typeof error === 'object') {
                    const err = error as { response?: { status?: number; data?: unknown }; code?: string; message?: string };

                    // Rate limit error (429)
                    if (err.response?.status === 429) {
                        const enhancedError = new Error('TronGrid API rate limit exceeded (HTTP 429). Too many requests. Consider adding more API keys or reducing request frequency.');
                        (enhancedError as { originalError?: unknown }).originalError = error;
                        throw enhancedError;
                    }

                    // SSL/TLS errors
                    if (err.code && (err.code.includes('SSL') || err.code.includes('TLS') || err.code === 'ERR_SSL_CIPHER_OPERATION_FAILED')) {
                        const enhancedError = new Error(`TLS/SSL cipher error (${err.code}): OpenSSL compatibility issue detected. This is a known issue in some development environments (WSL/OpenSSL 3.x).`) as Error & { code?: string; originalError?: unknown };
                        enhancedError.code = err.code;
                        enhancedError.originalError = error;
                        throw enhancedError;
                    }

                    // Network errors
                    if (err.code === 'ECONNREFUSED') {
                        const enhancedError = new Error('Network connection refused. Cannot reach TronGrid API (ECONNREFUSED). Check network connectivity.') as Error & { code?: string; originalError?: unknown };
                        enhancedError.code = 'ECONNREFUSED';
                        enhancedError.originalError = error;
                        throw enhancedError;
                    }

                    if (err.code === 'ETIMEDOUT') {
                        const enhancedError = new Error('Network connection timeout. TronGrid API request timed out (ETIMEDOUT).') as Error & { code?: string; originalError?: unknown };
                        enhancedError.code = 'ETIMEDOUT';
                        enhancedError.originalError = error;
                        throw enhancedError;
                    }

                    // API error response with data
                    if (err.response?.data) {
                        const apiError = err.response.data;
                        const message = typeof apiError === 'object' && apiError !== null && 'message' in apiError
                            ? String((apiError as { message: unknown }).message)
                            : JSON.stringify(apiError);
                        const enhancedError = new Error(`TronGrid API error (HTTP ${err.response.status}): ${message}`);
                        (enhancedError as { originalError?: unknown }).originalError = error;
                        throw enhancedError;
                    }
                }

                // Re-throw original error if we can't enhance it
                throw error;
            }
        });
    }

    static toBase58Address(hex?: string | null): string | null {
        if (!hex) {
            return null;
        }
        try {
            const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
            return tronWeb.address.fromHex(normalized);
        } catch (error) {
            logger.warn({ error, hex }, 'Failed to convert address from hex');
            return null;
        }
    }

    /**
     * Decode memo from TronGrid raw_data.data field.
     *
     * TronGrid returns memo data as a hex-encoded string.
     * Each pair of hex characters represents one byte of the original UTF-8 memo.
     *
     * @param data - Hex-encoded memo string from raw_data.data
     * @returns Decoded UTF-8 string, or null if empty/invalid
     */
    static decodeMemo(data?: string): string | null {
        if (!data) {
            return null;
        }
        try {
            const buffer = Buffer.from(data, 'hex');
            const memo = buffer.toString('utf8').replace(/\0+$/u, '').trim();
            return memo.length ? memo : null;
        } catch (error) {
            logger.warn({ error }, 'Failed to decode memo');
            return null;
        }
    }
}
