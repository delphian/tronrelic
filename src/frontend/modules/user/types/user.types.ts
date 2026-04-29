/**
 * User module type definitions.
 *
 * Shared interfaces for user identity, wallet linking,
 * preferences, and activity tracking.
 */

import type { UserIdentityState, IAuthStatus } from '@/types';

/**
 * User data returned from the API.
 */
export interface IUserData {
    id: string;
    /**
     * UI/feature gate controlling what is surfaced to the user.
     * When false, frontend shows "Connect" button and hides logged-in features.
     * UUID tracking continues regardless of this flag.
     */
    isLoggedIn: boolean;
    /**
     * Canonical anonymous / registered / verified state. Stored on the
     * backend document and surfaced as-is by the API. Read this field
     * directly; do not derive from `wallets`.
     */
    identityState: UserIdentityState;
    wallets: IWalletLink[];
    preferences: IUserPreferences;
    activity: IUserActivity;
    /** Admin-defined group memberships. Read-only on the client. */
    groups: string[];
    /**
     * Server-computed authorization snapshot. Populated on every payload
     * shipped from the user controller's response helper. Consumers
     * gating UI on admin status (most notably `SystemAuthContext`) read
     * these booleans rather than re-deriving from `identityState`,
     * `groups`, or wallet freshness — see `IAuthStatus` for why each
     * field exists. Optional because legacy snapshots persisted before
     * the field was added (Redux serialization, SSR cache) may lack it;
     * absent means "treat as not admin", which matches the safe default.
     */
    authStatus?: IAuthStatus;
    createdAt: string;
    updatedAt: string;
}

/**
 * Linked wallet information.
 *
 * Wallets are added in two stages (see the User Module README for the
 * canonical anonymous / registered / verified taxonomy):
 *
 * 1. **Register** — `connectWallet` stores the address with `verified=false`
 *    (no signature required). The user transitions from *anonymous* to
 *    *registered*.
 * 2. **Verify** — `linkWallet` upgrades the address to `verified=true` after
 *    signature verification. The user becomes *verified*.
 *
 * The `isPrimary` field is automatically maintained by the backend:
 * 1. Primary = most recent `lastUsed` among verified wallets.
 * 2. Fallback = most recent `lastUsed` among registered (unverified) wallets,
 *    used only when the user has no verified wallets.
 */
export interface IWalletLink {
    address: string;
    /** Timestamp when wallet was first registered (ISO string) */
    linkedAt: string;
    isPrimary: boolean;
    /**
     * True iff wallet ownership has been cryptographically proven via signature.
     * `false` = registered claim only; `true` = verified.
     */
    verified: boolean;
    /**
     * ISO timestamp of the most recent successful signature on this wallet.
     * `null` for wallets in the registered (unsigned) state. Refreshed on
     * link, set-primary, and the dedicated refresh-verification endpoint.
     * Feeds `deriveIdentityState` from `@/types`: a user whose every
     * wallet's `verifiedAt` has aged past `VERIFICATION_FRESHNESS_MS`
     * collapses from `Verified` to `Registered`, so this field is the
     * load-bearing input for the user-level identity state.
     */
    verifiedAt: string | null;
    /** Timestamp of last connection/use (ISO string) */
    lastUsed: string;
    label?: string;
}

/**
 * User preferences.
 */
export interface IUserPreferences {
    theme?: 'light' | 'dark' | 'system';
    notifications?: boolean;
    timezone?: string;
    language?: string;
}

/**
 * User activity tracking.
 */
export interface IUserActivity {
    lastSeen: string;
    pageViews: number;
    firstSeen: string;
}

/**
 * User statistics for admin UI.
 */
export interface IUserStats {
    totalUsers: number;
    usersWithWallets: number;
    totalWalletLinks: number;
    activeToday: number;
    activeThisWeek: number;
    averageWalletsPerUser: number;
}
