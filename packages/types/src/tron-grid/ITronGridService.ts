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
}
