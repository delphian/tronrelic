/**
 * @fileoverview Token approval scanning service for TRON TRC20 tokens.
 *
 * Queries TronGrid for a wallet's TRC20 transaction history to discover
 * Approval events, then checks live allowances via triggerconstantcontract.
 * Results are cached briefly to avoid redundant multi-call fan-out.
 */

import type { ICacheService } from '@/types';
import type { TronGridClient } from '../../blockchain/tron-grid.client.js';
import { normalizeAddress, toHexAddress } from '../../../lib/tron-address.js';
import { logger } from '../../../lib/logger.js';

/** Maximum unique (token, spender) pairs to query live allowance for. */
const MAX_ALLOWANCE_QUERIES = 20;

/** Cache TTL for approval scan results in seconds. */
const APPROVAL_CACHE_TTL = 60;

/** Maximum uint256 hex — indicates unlimited approval. */
const MAX_UINT256_HEX = 'f'.repeat(64);

/** Single token approval entry returned to consumers. */
export interface IApprovalEntry {
    /** TRC20 token contract address (base58). */
    tokenAddress: string;
    /** Token name from TronGrid metadata. */
    tokenName: string;
    /** Token symbol from TronGrid metadata. */
    tokenSymbol: string;
    /** Token decimal precision. */
    tokenDecimals: number;
    /** Address authorized to spend tokens (base58). */
    spenderAddress: string;
    /** Raw allowance as a decimal string. */
    allowance: string;
    /** Human-readable allowance with decimal formatting. */
    allowanceFormatted: string;
    /** True when allowance equals or approximates MAX_UINT256. */
    isUnlimited: boolean;
}

/** Complete result from an approval check operation. */
export interface IApprovalCheckResult {
    /** Wallet address that was scanned (base58). */
    ownerAddress: string;
    /** Active non-zero approvals discovered. */
    approvals: IApprovalEntry[];
    /** Unix timestamp (ms) when the scan completed. */
    scannedAt: number;
    /** True when more (token, spender) pairs exist than MAX_ALLOWANCE_QUERIES. */
    truncated: boolean;
}

/** TronGrid TRC20 transaction entry. */
interface TronGridTrc20Transaction {
    transaction_id: string;
    token_info: {
        symbol: string;
        address: string;
        decimals: number;
        name: string;
    };
    from: string;
    to: string;
    type: string;
    value: string;
}

/** TronGrid response from triggerconstantcontract endpoint. */
interface TriggerConstantResponse {
    result: { result: boolean; message?: string };
    energy_used: number;
    constant_result?: string[];
}

/**
 * Service for scanning TRC20 token approvals on the TRON blockchain.
 *
 * Queries TronGrid's TRC20 transaction history to discover which tokens
 * a wallet has approved, then fetches live allowance values via read-only
 * contract calls. Results are cached briefly to reduce TronGrid load.
 */
export class ApprovalService {
    /** Module-scoped logger. */
    private readonly logger = logger.child({ service: 'ApprovalService' });

    /**
     * @param tronGridClient - TronGridClient singleton for rate-limited TronGrid access
     * @param cache - Cache service for TTL-based result caching
     */
    constructor(
        private readonly tronGridClient: TronGridClient,
        private readonly cache: ICacheService
    ) {}

    /**
     * Scan a TRON wallet for active TRC20 token approvals.
     *
     * Queries the wallet's TRC20 transaction history for Approval events,
     * deduplicates (token, spender) pairs, fetches current live allowances,
     * and returns only non-zero active approvals.
     *
     * @param address - TRON wallet address in hex or base58 format
     * @returns Approval check result with active approvals
     * @throws ValidationError if the address is invalid
     */
    async checkApprovals(address: string): Promise<IApprovalCheckResult> {
        const normalized = normalizeAddress(address);
        const cacheKey = `tools:approvals:${normalized.base58}`;

        const cached = await this.cache.get<IApprovalCheckResult>(cacheKey);
        if (cached) {
            return cached;
        }

        const approvalEvents = await this.fetchApprovalEvents(normalized.base58);
        const uniquePairs = this.deduplicatePairs(approvalEvents, normalized.base58);
        const truncated = uniquePairs.length > MAX_ALLOWANCE_QUERIES;
        const pairsToQuery = uniquePairs.slice(0, MAX_ALLOWANCE_QUERIES);

        const approvals: IApprovalEntry[] = [];
        for (const pair of pairsToQuery) {
            try {
                const allowanceHex = await this.queryAllowance(
                    normalized.base58,
                    pair.spenderAddress,
                    pair.tokenAddress
                );
                if (!allowanceHex || allowanceHex === '0'.repeat(64)) {
                    continue;
                }

                const isUnlimited = this.isUnlimitedAllowance(allowanceHex);
                const allowanceBigInt = BigInt('0x' + allowanceHex);
                const allowanceFormatted = isUnlimited
                    ? 'Unlimited'
                    : this.formatTokenAmount(allowanceBigInt, pair.tokenDecimals);

                approvals.push({
                    tokenAddress: pair.tokenAddress,
                    tokenName: pair.tokenName,
                    tokenSymbol: pair.tokenSymbol,
                    tokenDecimals: pair.tokenDecimals,
                    spenderAddress: pair.spenderAddress,
                    allowance: allowanceBigInt.toString(),
                    allowanceFormatted,
                    isUnlimited
                });
            } catch (error) {
                this.logger.warn(
                    { error, token: pair.tokenAddress, spender: pair.spenderAddress },
                    'Failed to query allowance, skipping pair'
                );
            }
        }

        const result: IApprovalCheckResult = {
            ownerAddress: normalized.base58,
            approvals,
            scannedAt: Date.now(),
            truncated
        };

        await this.cache.set(cacheKey, result, APPROVAL_CACHE_TTL, ['tools:approvals']);

        return result;
    }

    /**
     * Fetch TRC20 transactions for a wallet and filter for Approval events.
     *
     * Paginates up to 5 pages (1000 transactions) to discover historical approvals.
     *
     * @param base58Address - Wallet address in base58 format
     * @returns Array of TRC20 Approve-type transactions
     */
    private async fetchApprovalEvents(base58Address: string): Promise<TronGridTrc20Transaction[]> {
        const allApprovals: TronGridTrc20Transaction[] = [];
        let fingerprint: string | undefined;
        const maxPages = 5;

        for (let page = 0; page < maxPages; page++) {
            const params: Record<string, string | number | boolean> = {
                only_confirmed: true,
                limit: 200
            };
            if (fingerprint) {
                params.fingerprint = fingerprint;
            }

            try {
                const response = await this.tronGridClient.getTrc20Transactions<{
                    data: TronGridTrc20Transaction[];
                    meta?: { fingerprint?: string };
                }>(base58Address, params);

                const data = response?.data ?? [];
                const approveTransactions = data.filter(tx => tx.type === 'Approve');
                allApprovals.push(...approveTransactions);

                fingerprint = response?.meta?.fingerprint;
                if (!fingerprint || data.length < 200) {
                    break;
                }
            } catch (error) {
                this.logger.error({ error, address: base58Address }, 'Failed to fetch TRC20 transactions');
                break;
            }
        }

        return allApprovals;
    }

    /**
     * Deduplicate (token, spender) pairs from approval events.
     *
     * Keeps only unique pairs and excludes events where the scanned wallet
     * is the spender (those are approvals granted TO the wallet, not BY it).
     *
     * @param events - Raw approval events from TronGrid
     * @param ownerBase58 - The wallet address being scanned
     * @returns Unique pairs with token metadata
     */
    private deduplicatePairs(
        events: TronGridTrc20Transaction[],
        ownerBase58: string
    ): Array<{
        tokenAddress: string;
        spenderAddress: string;
        tokenName: string;
        tokenSymbol: string;
        tokenDecimals: number;
    }> {
        const seen = new Map<string, {
            tokenAddress: string;
            spenderAddress: string;
            tokenName: string;
            tokenSymbol: string;
            tokenDecimals: number;
        }>();

        for (const event of events) {
            if (!event.token_info?.address) {
                continue;
            }

            const spender = event.to;
            if (!spender || spender === ownerBase58) {
                continue;
            }

            const key = `${event.token_info.address}:${spender}`;
            if (!seen.has(key)) {
                seen.set(key, {
                    tokenAddress: event.token_info.address,
                    spenderAddress: spender,
                    tokenName: event.token_info.name || 'Unknown',
                    tokenSymbol: event.token_info.symbol || '???',
                    tokenDecimals: event.token_info.decimals ?? 0
                });
            }
        }

        return Array.from(seen.values());
    }

    /**
     * Query the current allowance for a (owner, spender) pair on a TRC20 token.
     *
     * Calls the token contract's allowance(address,address) view function
     * via TronGrid's triggerconstantcontract endpoint (read-only, no gas cost).
     *
     * @param ownerBase58 - Token owner address (base58)
     * @param spenderBase58 - Approved spender address (base58)
     * @param tokenBase58 - TRC20 token contract address (base58)
     * @returns Hex-encoded uint256 allowance (64 chars), or null on failure
     */
    private async queryAllowance(
        ownerBase58: string,
        spenderBase58: string,
        tokenBase58: string
    ): Promise<string | null> {
        const ownerHex = toHexAddress(ownerBase58).slice(2).toLowerCase();
        const spenderHex = toHexAddress(spenderBase58).slice(2).toLowerCase();

        const parameter = ownerHex.padStart(64, '0') + spenderHex.padStart(64, '0');

        const response = await this.tronGridClient.triggerConstantContract<TriggerConstantResponse>({
            owner_address: ownerBase58,
            contract_address: tokenBase58,
            function_selector: 'allowance(address,address)',
            parameter,
            visible: true
        });

        if (!response?.result?.result) {
            return null;
        }

        const raw = response.constant_result?.[0];
        if (!raw || raw.length < 64) {
            return null;
        }

        return raw.slice(0, 64);
    }

    /**
     * Determine if an allowance hex value represents an unlimited approval.
     *
     * MAX_UINT256 (all f's) is the conventional unlimited approval. Some
     * contracts use slightly lower values — treat anything above 2^255
     * as effectively unlimited.
     *
     * @param hex - 64-character hex allowance string
     * @returns True if the allowance is effectively unlimited
     */
    private isUnlimitedAllowance(hex: string): boolean {
        if (hex === MAX_UINT256_HEX) {
            return true;
        }
        const firstChar = parseInt(hex[0], 16);
        return firstChar >= 8;
    }

    /**
     * Format a token amount with decimal precision for display.
     *
     * @param amount - Raw token amount as BigInt
     * @param decimals - Token decimal places
     * @returns Formatted string with decimal point
     */
    private formatTokenAmount(amount: bigint, decimals: number): string {
        if (decimals === 0) {
            return amount.toString();
        }

        const divisor = 10n ** BigInt(decimals);
        const wholePart = amount / divisor;
        const fractionalPart = amount % divisor;

        const fractionalStr = fractionalPart
            .toString()
            .padStart(decimals, '0')
            .slice(0, 6)
            .replace(/0+$/, '');

        if (!fractionalStr) {
            return wholePart.toString();
        }

        return `${wholePart}.${fractionalStr}`;
    }
}
