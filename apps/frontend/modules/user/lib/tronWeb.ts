/**
 * TronLink wallet provider interface and utilities.
 *
 * Provides type-safe access to the TronLink browser extension
 * via window.tronWeb. Used by useWallet hook for wallet connection.
 */

export interface TronWebProvider {
    ready?: boolean;
    defaultAddress?: {
        base58?: string;
    };
    request?: (args: { method: 'tron_requestAccounts' }) => Promise<void>;
    trx?: {
        signMessageV2?: (message: string) => Promise<string>;
    };
}

declare global {
    interface Window {
        tronWeb?: TronWebProvider;
    }
}

/**
 * Get the TronWeb provider from window.
 * Returns undefined if not available (SSR or TronLink not installed).
 */
export function getTronWeb(): TronWebProvider | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }
    return window.tronWeb;
}

/**
 * Assert that TronWeb provider is available.
 * Throws an error if not detected.
 */
export function assertTronWeb(message = 'TronLink wallet not detected.'): TronWebProvider {
    const provider = getTronWeb();
    if (!provider) {
        throw new Error(message);
    }
    return provider;
}
