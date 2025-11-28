/**
 * TronLink wallet provider interface and utilities.
 *
 * Provides type-safe access to the TronLink browser extension
 * via window.tronWeb and window.tronLink.
 *
 * @see https://docs.tronlink.org/tronlink-wallet-extension/request-tronlink-extension/connect-website
 */

/**
 * Response from tron_requestAccounts method.
 * @see https://docs.tronlink.org/tronlink-wallet-extension/request-tronlink-extension/connect-website
 */
export interface TronLinkRequestResponse {
    /** Response code: 200=success, 4000=pending, 4001=rejected, null=locked */
    code: 200 | 4000 | 4001 | null;
    message: string;
}

export interface TronWebProvider {
    ready?: boolean;
    defaultAddress?: {
        base58?: string;
    };
    request?: (args: { method: 'tron_requestAccounts' }) => Promise<TronLinkRequestResponse>;
    trx?: {
        signMessageV2?: (message: string) => Promise<string>;
    };
}

export interface TronLinkProvider {
    ready?: boolean;
    tronWeb?: TronWebProvider;
    request?: (args: { method: 'tron_requestAccounts' }) => Promise<TronLinkRequestResponse>;
}

declare global {
    interface Window {
        tronWeb?: TronWebProvider;
        tronLink?: TronLinkProvider;
    }
}

/**
 * Get the TronLink provider from window.
 * Returns undefined if not available (SSR or TronLink not installed).
 */
export function getTronLink(): TronLinkProvider | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }
    return window.tronLink;
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
