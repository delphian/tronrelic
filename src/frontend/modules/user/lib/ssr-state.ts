/**
 * SSR state building utilities for user module.
 *
 * Constructs the Redux user slice from the full backend `IUserData`
 * payload fetched during SSR. The payload travels intact from
 * `getServerUser` through the layout into `buildSSRUserState`, so the
 * client hydrates with the same `identityState`, `groups`, and
 * `authStatus` the backend computed — no parallel client-side
 * derivation that could drift from the freshness-aware backend rule
 * and no `authStatus`-shaped hole that would force `SystemAuthGate`
 * into its safe-default "not admin" branch on first paint.
 */

import type { UserState } from '../slice';
import type { IUserData } from '../types';

/**
 * SSR user data passed from server layout to client providers.
 *
 * This is the full `IUserData` payload returned by the backend
 * (decorated with `authStatus` via `withAuthStatus`), not a
 * trimmed-down shape. Keeping it whole means every Redux selector
 * — `selectIsVerified`, `selectIdentityState`, the `SystemAuthGate`
 * read of `authStatus.isVerified` — sees the same server-computed
 * truth from the first render.
 */
export type SSRUserData = IUserData;

/**
 * Build Redux UserState from SSR-fetched data.
 *
 * Uses server-computed `identityState`, `groups`, and `authStatus`
 * directly. The primary wallet (auto-maintained by the backend)
 * seeds the connection slice so the wallet button paints with its
 * actual verification status on first frame.
 */
export function buildSSRUserState(ssrData: SSRUserData): UserState {
    const primaryWallet = ssrData.wallets.find(w => w.isPrimary);

    return {
        userId: ssrData.id,
        userData: ssrData,
        status: 'succeeded',
        error: null,
        initialized: true,
        connectedAddress: primaryWallet?.address ?? null,
        connectionStatus: primaryWallet ? 'connected' : 'idle',
        providerDetected: false,
        connectionError: null,
        walletVerified: primaryWallet?.verified ?? false,
        walletLoginRequired: false,
        existingWalletOwner: null
    };
}
