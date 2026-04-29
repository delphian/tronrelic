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
 * The `verified` flag and `verifiedAt` timestamp are **historical audit
 * data** — they record that ownership was proven by signature at some
 * point in the past. They no longer drive `identityState`. The platform
 * decides "is this user currently authenticated?" by reading the
 * stored `identityState` and `identityVerifiedAt` on the user document
 * (see `IUser.identityVerifiedAt` and `SESSION_TTL_MS`). The per-wallet
 * fields survive because (a) they are still useful audit history, and
 * (b) the re-verify-after-logout flow in `linkWallet` needs to know
 * which wallets the user has previously proven ownership of.
 */
export interface IWalletLink {
    /** Base58 TRON address (e.g., TRX7NJa...) */
    address: string;
    /** Timestamp when wallet was first registered */
    linkedAt: Date;
    /** Whether this is the default wallet for display */
    isPrimary: boolean;
    /**
     * True iff wallet ownership has been cryptographically proven via
     * signature at any point. Historical audit flag — does not drive
     * authentication decisions. The re-verify flow in `linkWallet`
     * reads this to enforce the policy that a user re-establishing a
     * session must sign with a wallet they have previously proven.
     */
    verified: boolean;
    /**
     * Timestamp of the most recent successful signature on this wallet.
     * `null` for wallets that have never been signed (i.e. registered-only).
     * Refreshed on `linkWallet`, `setPrimaryWallet`, and the dedicated
     * refresh-verification endpoint. Historical audit data — the user-level
     * session clock lives on `IUser.identityVerifiedAt`.
     */
    verifiedAt: Date | null;
    /** Timestamp of last connection/use */
    lastUsed: Date;
    /** Optional user-assigned label for the wallet */
    label?: string;
}

/**
 * How long a verified session is valid before the user is forced to
 * re-authenticate by signing with a wallet they have previously proven.
 * 14 days.
 *
 * The session clock anchors on `IUser.identityVerifiedAt`, stamped by
 * any successful `linkWallet` (or `refreshWalletVerification` /
 * `setPrimaryWallet`). When `identityVerifiedAt + SESSION_TTL_MS < now`,
 * the next read of the user document via `UserService.getById` (or the
 * sibling lookup paths) lazily downgrades the user from `Verified` to
 * `Registered` and persists the change. There is no separate per-wallet
 * freshness predicate — the user-level clock is the single source of
 * truth for "is this session still alive?".
 *
 * Tuning: short enough that an abandoned-account or stolen-cookie
 * scenario decays in days, not months; long enough that an active
 * operator who signs roughly monthly never sees the prompt. If 14 days
 * proves too aggressive in practice, tune the number here — never
 * carve out per-gate thresholds.
 */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Minimal structural shape consumed by `isSessionFresh`. Accepts both
 * canonical backend `IUser` (Date instances) and the frontend's wire
 * form (ISO strings) without forcing either side to convert before
 * calling.
 */
export interface ISessionFreshnessInput {
    identityState: UserIdentityState;
    identityVerifiedAt: Date | string | null;
}

/**
 * True iff this user's session timestamp is within `SESSION_TTL_MS`.
 *
 * Returns `false` when the user is not in `Verified` state, when the
 * `identityVerifiedAt` is null (defensive: a Verified user without a
 * timestamp cannot be considered fresh), or when the timestamp has
 * aged past the TTL. Defensive against wire-form timestamps —
 * `identityVerifiedAt` may arrive as a `Date` instance (server-side)
 * or an ISO string (after JSON round-trip on the wire).
 *
 * The lazy-downgrade in `UserService.getById` calls this and persists
 * the demotion when it returns false. Other callers use it for
 * read-only checks (e.g. UI gates that want to know "would this user
 * pass auth right now?" without forcing a write).
 */
export function isSessionFresh(
    user: ISessionFreshnessInput,
    now: number = Date.now()
): boolean {
    if (user.identityState !== UserIdentityState.Verified) {
        return false;
    }
    if (user.identityVerifiedAt === null) {
        return false;
    }
    const verifiedAtMs = user.identityVerifiedAt instanceof Date
        ? user.identityVerifiedAt.getTime()
        : new Date(user.identityVerifiedAt).getTime();
    if (Number.isNaN(verifiedAtMs)) {
        return false;
    }
    return now - verifiedAtMs < SESSION_TTL_MS;
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
 * Authentication is described by two fields together:
 *
 *   - `identityState` — anonymous / registered / verified. Stored as the
 *     authoritative scalar; written exactly once per state transition by
 *     `UserService` mutation handlers (connectWallet, linkWallet,
 *     unlinkWallet, logout, identity reconciliation, lazy session
 *     expiry). Never derived at read time.
 *   - `identityVerifiedAt` — when the current Verified session was
 *     established. `null` for non-verified users. The session is alive
 *     for `SESSION_TTL_MS` from this timestamp; past that, the next
 *     `getById` lazily downgrades the user to Registered and nulls
 *     this field.
 *
 * Consumers gating UI or actions read `identityState` and `authStatus`
 * directly — there is no derivation step.
 */
export interface IUser {
    /** UUID v4 identifier */
    id: string;
    /**
     * Canonical anonymous / registered / verified state. Authoritative
     * stored field — read this directly. Written by `UserService` on
     * each transition; never derived from `wallets` at read time.
     */
    identityState: UserIdentityState;
    /**
     * When the user's current Verified session was established. Anchor
     * for the `SESSION_TTL_MS` clock. `null` for users not in Verified
     * state (and reset to `null` on logout or lazy expiry).
     */
    identityVerifiedAt: Date | null;
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
