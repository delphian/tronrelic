/**
 * SSR state building utilities for user module.
 *
 * Provides functions to construct Redux initial state from server-fetched
 * user data, enabling hydration without UI flash.
 */

import type { UserState } from '../slice';
import type { IWalletLink } from '../types';

/**
 * SSR user data passed from server layout to client providers.
 */
export interface SSRUserData {
    userId: string;
    wallets: IWalletLink[];
}

/**
 * Build Redux UserState from SSR-fetched data.
 *
 * Used during SSR hydration to preload user state, preventing
 * wallet button flash on page load. If user has linked wallets,
 * shows their primary wallet as connected with its actual verification status.
 *
 * The isPrimary field is auto-maintained by the backend based on:
 * 1. Most recent lastUsed among verified wallets
 * 2. Fallback: Most recent lastUsed among unverified wallets
 *
 * @param ssrData - User data fetched during SSR
 * @returns Complete UserState for Redux preloading
 */
export function buildSSRUserState(ssrData: SSRUserData): UserState {
    // isPrimary is auto-maintained by backend - just find it
    const primaryWallet = ssrData.wallets.find(w => w.isPrimary);

    return {
        userId: ssrData.userId,
        userData: {
            id: ssrData.userId,
            wallets: ssrData.wallets,
            preferences: {},
            activity: {
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                pageViews: 0
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        },
        status: 'succeeded',
        error: null,
        initialized: true,
        // Show primary wallet with its actual verification status
        connectedAddress: primaryWallet?.address ?? null,
        connectionStatus: primaryWallet ? 'connected' : 'idle',
        providerDetected: false, // Will be updated client-side
        connectionError: null,
        walletVerified: primaryWallet?.verified ?? false
    };
}
