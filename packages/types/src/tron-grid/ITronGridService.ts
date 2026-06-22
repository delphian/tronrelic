/**
 * TronGrid account permission structure.
 * Represents an active_permission entry from TronGrid's /wallet/getaccount response.
 */
export interface ITronGridAccountPermission {
    /** Permission ID (0=owner, 1=witness, 2=default active, 3+=custom) */
    id: number;
    /** Permission name (e.g., "TronLending", "EnergyPool") */
    permission_name?: string;
    /** Threshold required to authorize transactions */
    threshold?: number;
    /** Addresses authorized to sign with this permission */
    keys?: Array<{
        address: string;
        weight: number;
    }>;
}

/**
 * TronGrid account response structure.
 * Subset of fields relevant to permission discovery.
 */
export interface ITronGridAccountResponse {
    /** Account address in base58 format */
    address?: string;
    /** Account TRX balance in SUN */
    balance?: number;
    /** Account creation timestamp in milliseconds (from first on-chain activation) */
    create_time?: number;
    /** Custom active permissions (id >= 2) */
    active_permission?: ITronGridAccountPermission[];
    /** Owner permission (id = 0) */
    owner_permission?: ITronGridAccountPermission;
}

import type { ITrc10 } from '../trc10/index.js';

/**
 * TronGrid service interface for plugins.
 *
 * Provides access to TronGrid API with built-in rate limiting, key rotation,
 * and retry logic. Plugins use this instead of making direct HTTP calls
 * to ensure consistent API access patterns across the application.
 */
export interface ITronGridService {
    /**
     * Get account information including permissions.
     * Used by plugins to discover pool memberships via active_permission keys.
     *
     * @param address - Account address to query
     * @param visible - Whether to return addresses in base58 format (default: true)
     * @returns Account response or null if request fails
     */
    getAccount(address: string, visible?: boolean): Promise<ITronGridAccountResponse | null>;

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
    createTronWeb(options?: { privateKey?: string; fullHost?: string }): any;

    /**
     * Resolve a TRC10 token to its source-agnostic on-chain record by token id.
     *
     * Why callers need it: a token page (or any consumer holding only the
     * chain-assigned id) needs the canonical name, supply, precision, and
     * tokenomics without learning the wire shape of the underlying provider.
     * The implementation owns the source and the decoding; the caller depends
     * only on {@link ITrc10}.
     *
     * @param tokenId - Chain-assigned numeric asset id, as a string.
     * @returns The resolved token, or null when no asset carries that id.
     */
    getTrc10(tokenId: string): Promise<ITrc10 | null>;

    /**
     * Resolve the single TRC10 token issued by an account, by owner address.
     *
     * Why this exists separately from {@link ITronGridService.getTrc10}: when a
     * creation is detected on-chain the chain-assigned token id is not yet known
     * to the observer — but TRON permits exactly one asset issuance per account,
     * so the owner address resolves the just-created token deterministically.
     * This is also the basis for the "has this wallet already issued a token?"
     * pre-flight check that guards user-initiated creation.
     *
     * @param ownerAddress - Base58 issuer address.
     * @returns The account's token, or null when the account has issued none.
     */
    getTrc10ByOwner(ownerAddress: string): Promise<ITrc10 | null>;
}
