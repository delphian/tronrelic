import TronWeb from 'tronweb';
import { httpClient } from '../../lib/http-client.js';
import { env } from '../../config/env.js';
import { blockchainConfig } from '../../config/blockchain.js';
import { retry } from '../../lib/retry.js';
import { logger } from '../../lib/logger.js';

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
    active_permission?: TronGridAccountPermission[];
    owner_permission?: TronGridAccountPermission;
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
