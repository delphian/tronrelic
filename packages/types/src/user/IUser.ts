/**
 * User-related interfaces for plugin consumption.
 *
 * These interfaces provide a framework-independent representation of user data
 * that plugins can use without accessing internal MongoDB document structures.
 * The actual IUserDocument (with MongoDB-specific fields) remains internal to
 * the user module.
 *
 * @module @/types/user
 */

import { UserIdentityState } from './IUserIdentityState.js';
import type { IAuthStatus } from './IAuthStatus.js';

/**
 * Represents a linked TRON wallet address associated with a user identity.
 *
 * Users can link multiple wallets to their UUID, enabling cross-wallet
 * preferences and unified activity tracking.
 *
 * The `verified` flag is the wire-format indicator of which user state this
 * wallet contributes to (see the User Module README for the canonical
 * anonymous / registered / verified taxonomy):
 *
 * - `verified: false` — wallet was registered (claimed via TronLink connect)
 *   but no signature has proven ownership. Holding only such wallets makes
 *   the user *registered*.
 * - `verified: true` — wallet ownership was proven by a signed message.
 *   Any wallet with `verified: true` makes the user *verified*.
 *
 * `verifiedAt` is the freshness anchor for cookie+admin authority. The
 * dual-track admin middleware accepts a *Verified* user only when at least
 * one wallet has `verifiedAt` within `VERIFICATION_FRESHNESS_MS`. Stale
 * verifications still count toward `identityState === Verified` for display
 * and analytics, but stop conferring admin authority — the user must
 * re-sign to refresh the freshness clock.
 */
export interface IWalletLink {
    /** Base58 TRON address (e.g., TRX7NJa...) */
    address: string;
    /** Timestamp when wallet was first registered */
    linkedAt: Date;
    /** Whether this is the default wallet for display */
    isPrimary: boolean;
    /** True iff wallet ownership has been cryptographically proven via signature. */
    verified: boolean;
    /**
     * Timestamp of the most recent successful signature on this wallet.
     * `null` for wallets that have never been signed (i.e. registered-only).
     * Refreshes on `linkWallet`, `setPrimaryWallet`, and the dedicated
     * refresh-verification endpoint. Used by the freshness predicate that
     * gates cookie-path admin authority — see `VERIFICATION_FRESHNESS_MS`.
     */
    verifiedAt: Date | null;
    /** Timestamp of last connection/use */
    lastUsed: Date;
    /** Optional user-assigned label for the wallet */
    label?: string;
}

/**
 * How recently a wallet must have been signed before it counts toward the
 * `Verified` identity state. 14 days.
 *
 * Verification freshness is folded directly into `identityState` via
 * `deriveIdentityState`: a user whose every wallet's `verifiedAt` has
 * aged past this window collapses from `Verified` to `Registered`,
 * just like a never-signed user. The threshold is uniform across
 * consumers so a wallet that's "fresh enough" for one access point is
 * fresh enough for any. Picked short enough that an abandoned-account
 * or stolen-cookie scenario decays in days, not months; long enough
 * that an active operator who signs roughly monthly never sees the
 * prompt. If 14 days proves too aggressive in practice, tune the
 * number here — never carve out per-gate thresholds, and never add a
 * separate freshness predicate alongside `identityState`.
 */
export const VERIFICATION_FRESHNESS_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Minimal structural shape of the wallet fields the freshness predicate
 * reads. Accepts both the canonical backend `IWalletLink` (Date instances)
 * and the frontend's wire-form `IWalletLink` (ISO strings) without forcing
 * either side to convert before calling. The predicate normalizes
 * internally — see `isWalletVerificationFresh`.
 */
export interface IWalletVerificationFreshnessInput {
    verified: boolean;
    verifiedAt: Date | string | null;
}

/**
 * True iff this wallet's verification is fresh enough to confer cookie-path
 * admin authority right now.
 *
 * Defensive against legacy `verified: true` wallets with `verifiedAt: null`
 * (pre-migration data): such wallets count as stale, never fresh, so the
 * admin path can't accidentally grant authority on the strength of an
 * unrecorded signature timestamp. Also defensive against wire-form
 * timestamps — `verifiedAt` may arrive as a `Date` instance (server-side)
 * or an ISO string (after JSON round-trip on the wire).
 */
export function isWalletVerificationFresh(
    wallet: IWalletVerificationFreshnessInput,
    now: number = Date.now()
): boolean {
    if (!wallet.verified || wallet.verifiedAt === null) {
        return false;
    }
    const verifiedAtMs = wallet.verifiedAt instanceof Date
        ? wallet.verifiedAt.getTime()
        : new Date(wallet.verifiedAt).getTime();
    if (Number.isNaN(verifiedAtMs)) {
        return false;
    }
    return now - verifiedAtMs < VERIFICATION_FRESHNESS_MS;
}

/**
 * True iff at least one wallet in the array is verification-fresh.
 *
 * "Any-fresh-wins" is the multi-wallet rule: a user with five wallets where
 * only one is recently signed remains a fresh-Verified caller. Asking
 * operators to keep every linked wallet signed within the window would be
 * worse UX than no expiry at all — they'd click through prompts without
 * reading. Keep one wallet hot, you keep admin authority.
 */
export function hasFreshVerification(
    wallets: ReadonlyArray<IWalletVerificationFreshnessInput>,
    now: number = Date.now()
): boolean {
    return wallets.some(w => isWalletVerificationFresh(w, now));
}

/**
 * Derive the current `UserIdentityState` from a wallets array.
 *
 * Freshness is folded into the enum: `Verified` requires not only that a
 * signature happened, but that it happened recently. A user whose every
 * wallet's `verifiedAt` has aged past the freshness window collapses to
 * `Registered` until they re-sign — same behavior an unverified-claim
 * registered user gets, on the principle that an expired proof and an
 * absent proof are functionally indistinguishable for any consumer
 * gating on Verified. Re-signing produces a fresh `verifiedAt`, lifting
 * the user back to Verified through the normal verify-wallet flow.
 *
 * This is the single derivation rule. `UserService.toPublicUser`
 * computes identityState through it on every read, so the wire form
 * always reflects current truth — there is no separate "stale" gate
 * anywhere in the stack.
 *
 * Storage may hold a denormalized `identityState` for indexes and admin
 * filter queries, but storage is a cache: the API surface always returns
 * the freshly-derived value, even when storage drifted because no
 * wallet mutation happened to trigger a recompute.
 */
export function deriveIdentityState(
    wallets: ReadonlyArray<IWalletVerificationFreshnessInput>,
    now: number = Date.now()
): UserIdentityState {
    if (wallets.length === 0) {
        return UserIdentityState.Anonymous;
    }
    if (hasFreshVerification(wallets, now)) {
        return UserIdentityState.Verified;
    }
    return UserIdentityState.Registered;
}

/**
 * User preferences stored server-side.
 *
 * Extensible structure allowing plugins to store custom preferences
 * via the index signature while maintaining type safety for core fields.
 */
export interface IUserPreferences {
    /** UUID of selected theme (references theme collection) */
    theme?: string;
    /** Whether user has enabled notifications */
    notifications?: boolean;
    /** Extensible for plugin-specific preferences */
    [key: string]: unknown;
}

/**
 * A single page visit within a session.
 */
export interface IPageVisit {
    /** Route path (e.g., '/accounts/TXyz...', '/markets') */
    path: string;
    /** Timestamp when page was loaded */
    timestamp: Date;
}

/**
 * Device category derived from user-agent.
 * Coarse-grained to avoid fingerprinting.
 */
export type DeviceCategory = 'mobile' | 'tablet' | 'desktop' | 'unknown';

/**
 * Screen size category based on viewport width.
 * Uses TronRelic's design system breakpoints.
 *
 * Breakpoint thresholds:
 * - mobile-sm: < 360px (legacy devices)
 * - mobile-md: 360-479px (primary mobile)
 * - mobile-lg: 480-767px (large phones)
 * - tablet: 768-1023px (tablets)
 * - desktop: 1024-1199px (standard desktop)
 * - desktop-lg: >= 1200px (large desktop)
 */
export type ScreenSizeCategory = 'mobile-sm' | 'mobile-md' | 'mobile-lg' | 'tablet' | 'desktop' | 'desktop-lg' | 'unknown';

/**
 * UTM campaign tracking parameters captured from the landing page URL.
 *
 * All fields are optional because visitors may arrive with any subset
 * of UTM tags (e.g., only utm_source and utm_medium).
 */
export interface IUtmParams {
    /** Traffic source (e.g., 'twitter', 'google', 'newsletter') */
    source?: string;
    /** Marketing medium (e.g., 'cpc', 'email', 'social') */
    medium?: string;
    /** Campaign name (e.g., 'spring_sale', 'launch_2026') */
    campaign?: string;
    /** Paid search keyword or topic term */
    term?: string;
    /** Ad variation or content identifier */
    content?: string;
}

/**
 * A user session with engagement metrics.
 */
export interface IUserSession {
    /** Session start timestamp */
    startedAt: Date;
    /** Session end timestamp (null if active) */
    endedAt: Date | null;
    /** Duration in seconds */
    durationSeconds: number;
    /** Pages visited during this session */
    pages: IPageVisit[];
    /** Device category for this session */
    device: DeviceCategory;
    /** Viewport width in pixels at session start */
    screenWidth: number | null;
    /** Screen size category based on viewport width breakpoints */
    screenSize: ScreenSizeCategory;
    /** Referrer domain (e.g., 'twitter.com', null if direct) */
    referrerDomain: string | null;
    /** ISO 3166-1 alpha-2 country code (e.g., 'US', 'DE', 'JP') */
    country: string | null;
    /** UTM campaign parameters from landing page URL (null if none present) */
    utm: IUtmParams | null;
    /** URL path the visitor first landed on (e.g., '/resource-markets') */
    landingPage: string | null;
    /** Search query extracted from referrer URL for known search engines (null if not search traffic) */
    searchKeyword: string | null;
}

/**
 * Activity tracking metrics for visitor analytics.
 */
export interface IUserActivity {
    /** Timestamp of first visit */
    firstSeen: Date;
    /** Timestamp of most recent activity */
    lastSeen: Date;
    /** Total page views across all sessions */
    pageViews: number;
    /** Number of distinct sessions */
    sessionsCount: number;
    /** Total engagement time in seconds */
    totalDurationSeconds: number;
    /** Recent sessions with detailed tracking */
    sessions: IUserSession[];
    /** Aggregated page visit counts by path */
    pageViewsByPath: Record<string, number>;
    /** Country distribution (ISO codes to visit counts) */
    countryCounts: Record<string, number>;
}

/**
 * Public user representation (framework-independent).
 *
 * Used in API responses, frontend state, and plugin consumption.
 * This is the safe-to-expose representation without internal MongoDB fields.
 *
 * The user's identity state is the canonical `identityState` field, which is
 * **stored** (never derived at read time). `UserService` recomputes and
 * persists it on every wallet mutation. Consumers must read
 * `user.identityState` directly rather than reconstruct it from `wallets`.
 *
 * Note: `isLoggedIn` is a separate UI/feature gate, not the identity state.
 * A user can be in any `identityState` regardless of `isLoggedIn`.
 */
export interface IUser {
    /** UUID v4 identifier */
    id: string;
    /**
     * UI/feature gate controlling what is surfaced to the user.
     * When false, frontend shows "Connect" button and hides logged-in features.
     * Independent of `identityState`.
     */
    isLoggedIn: boolean;
    /**
     * Canonical anonymous / registered / verified state. Stored on the
     * document and recomputed by `UserService` on every wallet mutation.
     * Read this field directly; do not derive from `wallets`.
     */
    identityState: UserIdentityState;
    /** Linked wallet addresses */
    wallets: IWalletLink[];
    /** User preferences */
    preferences: IUserPreferences;
    /** Activity metrics */
    activity: IUserActivity;
    /**
     * Admin-defined group memberships. Each entry is a group id from the
     * `module_user_groups` collection (see `IUserGroup`). Plugins read this
     * directly or via `IUserGroupService.getUserGroups()` for permission
     * gating; the platform itself only interprets membership in the seeded
     * `admin` system group via `IUserGroupService.isAdmin`.
     */
    groups: string[];
    /**
     * Server-computed authorization snapshot. Optional on the storage
     * shape (`UserService.toPublicUser` returns the data model without
     * it) and populated by `withAuthStatus` at the response boundary
     * before payloads cross to clients. Consumers gating UI or actions
     * read this rather than re-deriving from `identityState`, `groups`,
     * and `wallets`. See `IAuthStatus`.
     */
    authStatus?: IAuthStatus;
    /** Document creation timestamp */
    createdAt: Date;
    /** Document last update timestamp */
    updatedAt: Date;
}
