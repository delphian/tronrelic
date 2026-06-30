import TronWeb from 'tronweb';
import { httpClient } from '../../lib/http-client.js';
import { env } from '../../config/env.js';
import { blockchainConfig } from '../../config/blockchain.js';
import { retry } from '../../lib/retry.js';
import { logger } from '../../lib/logger.js';
import type { ITrc10 } from '@/types';

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
}

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

    async getTransactionEvents(txId: string): Promise<TronGridEvent[]> {
        try {
            return await enqueueRequest(async () => {
                const response = await httpClient.get<{ data: TronGridEvent[] }>(
                    `${BASE_URL}/v1/transactions/${txId}/events`,
                    {
                        headers: buildHeaders()
                    }
                );
                return response.data?.data ?? [];
            });
        } catch (error) {
            logger.error({ error, txId }, 'Failed to fetch transaction events');
            return [];
        }
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
