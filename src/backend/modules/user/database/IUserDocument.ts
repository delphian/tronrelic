import { ObjectId } from 'mongodb';
import type { UserIdentityState } from '@/types';

/**
 * Represents a linked TRON wallet address associated with a user identity.
 *
 * Users can link multiple wallets to their UUID, enabling cross-wallet
 * preferences and unified activity tracking.
 *
 * Wallets are added in two stages (see the User Module README for the canonical
 * anonymous / registered / verified taxonomy):
 *
 * 1. **Register** — `connectWallet` stores the address with `verified=false`
 *    (no signature required). The user transitions from *anonymous* to
 *    *registered*.
 * 2. **Verify** — `linkWallet` upgrades the address to `verified=true` after
 *    signature verification. The user becomes *verified* (any single
 *    `verified: true` wallet is sufficient).
 *
 * The `isPrimary` field is automatically maintained by UserService:
 * 1. Primary = most recent `lastUsed` among verified wallets.
 * 2. Fallback = most recent `lastUsed` among registered (unverified) wallets,
 *    used only when the user has no verified wallets.
 *
 * External code should simply query for `isPrimary=true`.
 */
export interface IWalletLink {
    /** Base58 TRON address (e.g., TRX7NJa...) */
    address: string;
    /** Timestamp when wallet was first registered */
    linkedAt: Date;
    /** Whether this is the default wallet for display (auto-maintained by UserService) */
    isPrimary: boolean;
    /**
     * True iff wallet ownership has been cryptographically proven via
     * signature at any point. Historical audit flag — does not drive
     * authentication decisions. Read by the re-verify policy in
     * `linkWallet` to enforce that a Registered user re-establishing a
     * session must sign with a wallet they have previously proven.
     */
    verified: boolean;
    /**
     * Timestamp of the most recent successful signature on this wallet.
     * `null` for wallets in the registered (unsigned) state. Set by
     * `linkWallet`, `setPrimaryWallet`, and the dedicated
     * refresh-verification endpoint. Backfilled from `linkedAt` for
     * legacy verified rows by migration 008. Historical audit data —
     * the user-level session clock lives on
     * `IUserDocument.identityVerifiedAt`.
     */
    verifiedAt: Date | null;
    /** Timestamp of last connection/use (for primary wallet selection) */
    lastUsed: Date;
    /** Optional user-assigned label for the wallet */
    label?: string;
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
    [key: string]: any;
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
 * Uses TronRelic's design system breakpoints (Asia-optimized).
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
 *
 * Sessions are bounded - only the last N are retained to prevent
 * unbounded document growth. Older sessions are aggregated into
 * lifetime totals before removal.
 */
export interface IUserSession {
    /** Session start timestamp */
    startedAt: Date;
    /** Session end timestamp (null if active) */
    endedAt: Date | null;
    /** Duration in seconds (calculated on session end or heartbeat) */
    durationSeconds: number;
    /** Pages visited during this session (capped at 100 per session) */
    pages: IPageVisit[];
    /** Device category for this session (derived from user-agent) */
    device: DeviceCategory;
    /** Viewport width in pixels at session start (null if not provided) */
    screenWidth: number | null;
    /** Screen size category based on viewport width breakpoints */
    screenSize: ScreenSizeCategory;
    /** Referrer domain (e.g., 'twitter.com', 'google.com', null if direct) */
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
 * Traffic origin data captured during a visitor's first-ever session.
 *
 * Persisted once at the user level so origin data survives session pruning.
 * Fields are set during the first call to startSession() and never overwritten.
 */
export interface ITrafficOrigin {
    /** Referrer domain from the first session (e.g., 'twitter.com', null if direct) */
    referrerDomain: string | null;
    /** URL path the visitor first landed on (e.g., '/resource-markets') */
    landingPage: string | null;
    /** ISO 3166-1 alpha-2 country code at first visit (e.g., 'US', 'JP') */
    country: string | null;
    /** Device category during first visit (null when backfilled with no session history) */
    device: DeviceCategory | null;
    /** UTM campaign parameters from the first landing page URL */
    utm: IUtmParams | null;
    /** Search keyword from referrer URL at first visit */
    searchKeyword: string | null;
}

/**
 * Activity tracking metrics for visitor analytics.
 *
 * Tracks engagement patterns without storing sensitive browsing details.
 * Sessions array is bounded to last 20 sessions; older data is aggregated
 * into lifetime totals.
 */
export interface IUserActivity {
    /** Timestamp of first visit */
    firstSeen: Date;
    /** Timestamp of most recent activity */
    lastSeen: Date;
    /** Total page views across all sessions (lifetime aggregate) */
    pageViews: number;
    /** Number of distinct sessions (lifetime count) */
    sessionsCount: number;
    /** Total engagement time in seconds (lifetime aggregate) */
    totalDurationSeconds: number;
    /** Recent sessions with detailed tracking (last 20, newest first) */
    sessions: IUserSession[];
    /** Aggregated page visit counts by path (lifetime, top 50 paths) */
    pageViewsByPath: Record<string, number>;
    /** Country distribution (lifetime, ISO codes to visit counts) */
    countryCounts: Record<string, number>;
    /** Traffic origin from the visitor's first-ever session (set once, never overwritten) */
    origin: ITrafficOrigin | null;
}

/**
 * MongoDB document interface for user identity records.
 *
 * Represents the database schema for visitor identity with MongoDB-specific fields.
 * The _id field is stored as ObjectId in the database. The primary identifier
 * for external use is the `id` field (UUID v4), not the MongoDB _id.
 *
 * This interface is used with the native MongoDB driver (not Mongoose) to provide
 * direct collection access through the IDatabaseService dependency injection pattern.
 *
 * ## Collection: `users`
 *
 * ## Indexes:
 * - `{ id: 1 }` - unique, primary lookup by UUID
 * - `{ 'wallets.address': 1 }` - reverse lookup by wallet address
 * - `{ 'activity.lastSeen': 1 }` - cleanup and analytics queries
 *
 * @example
 * ```typescript
 * const collection = database.getCollection<IUserDocument>('users');
 * const user = await collection.findOne({ id: 'uuid-v4-string' });
 * ```
 */
export interface IUserDocument {
    /** MongoDB internal document ID */
    _id: ObjectId;
    /** UUID v4 primary identifier (client-generated, validated on server) */
    id: string;
    /**
     * When set, this UUID has been merged into another user via wallet-based
     * identity reconciliation. All lookups follow this pointer to the canonical
     * UUID. Pointer chains are flattened during merge (always single-hop).
     * The document retains its `id` but wallets are transferred to the target.
     */
    mergedInto?: string | null;
    /**
     * Canonical identity state (anonymous / registered / verified).
     *
     * Authoritative stored field — written exactly once per state
     * transition by `UserService` mutation handlers (`connectWallet`,
     * `linkWallet`, `unlinkWallet`, `logout`, identity reconciliation,
     * lazy session expiry on read). Never derived from `wallets` at
     * read time. All consumers read this field directly.
     *
     * Indexed for fast filter queries (see migration 006).
     */
    identityState: UserIdentityState;
    /**
     * Timestamp the current Verified session was established.
     * Anchor for the `SESSION_TTL_MS` clock. `null` when
     * `identityState !== Verified`, and reset to `null` on logout or
     * lazy expiry. Backfilled from `max(wallets[*].verifiedAt)` for
     * legacy verified users by migration 009.
     */
    identityVerifiedAt: Date | null;
    /** Linked TRON wallet addresses */
    wallets: IWalletLink[];
    /** User preferences (theme, notifications, plugin-specific) */
    preferences: IUserPreferences;
    /** Activity tracking metrics */
    activity: IUserActivity;
    /**
     * Admin-defined group memberships. Each entry is a group id from the
     * `module_user_groups` collection. Mutated via `IUserGroupService`;
     * indexed for fast membership queries.
     *
     * Backfilled to `[]` on legacy documents by migration 007.
     */
    groups: string[];
    /** Referral tracking (null until first wallet verification or referral attribution) */
    referral: IReferral | null;
    /** Document creation timestamp */
    createdAt: Date;
    /** Document last update timestamp */
    updatedAt: Date;
}

/**
 * Referral tracking data for user-driven growth.
 *
 * `code` is generated once when the user first transitions into the *verified*
 * state (i.e. signs a message for any wallet). `referredBy` is set once during
 * the first session if the visitor arrived via a referral link
 * (`utm_source=referral`, `utm_content=CODE`).
 */
export interface IReferral {
    /** Short unique referral code for sharing (e.g., 'a1b2c3d4'). Null until the user becomes *verified*. */
    code: string | null;
    /** Referral code of the user who referred this visitor (null if organic). Set once, never overwritten. */
    referredBy: string | null;
    /** Timestamp when referral attribution was recorded (null if not referred). */
    referredAt: Date | null;
}

/**
 * Input for creating or updating a user.
 *
 * Only the UUID is required; other fields have sensible defaults.
 */
export interface ICreateUserInput {
    /** UUID v4 identifier (required, validated) */
    id: string;
    /** Initial preferences (optional) */
    preferences?: Partial<IUserPreferences>;
}

/**
 * Input for linking a wallet to a user identity.
 *
 * Replay protection is anchored on `nonce` rather than a client-supplied
 * timestamp: the server mints a single-use nonce via
 * `POST /api/user/:id/wallet/challenge`, the client signs the canonical
 * message returned alongside it, and the server consumes the nonce
 * atomically before applying the mutation.
 */
export interface ILinkWalletInput {
    /** Base58 TRON address to link */
    address: string;
    /** Canonical message returned by the matching wallet challenge */
    message: string;
    /** TronLink signature proving wallet ownership */
    signature: string;
    /** Single-use nonce minted by `POST /api/user/:id/wallet/challenge` */
    nonce: string;
}

/**
 * Canonical input for `UserService.startSession`.
 *
 * The controller forwards raw request fields here (cookie-validated user id,
 * client IP, user-agent, body/header referrer, raw UTM object, etc.) and the
 * service applies all domain rules: UTM truncation, empty-UTM detection,
 * body-referrer-vs-header-referrer priority, internal-domain filtering,
 * device/country/screen-size derivation.
 *
 * The raw shape (`bodyReferrer`/`headerReferrer`/`rawUtm: unknown`) keeps
 * HTTP parsing concerns in the controller while leaving the *interpretation*
 * of those fields in one auditable place.
 */
export interface IStartSessionInput {
    /** UUID of the user starting the session. */
    userId: string;
    /** Client IP for country lookup. Never persisted raw. */
    clientIP?: string;
    /** User-agent header for device-category derivation. Never persisted raw. */
    userAgent?: string;
    /** Viewport width in pixels (client-provided). */
    screenWidth?: number;
    /**
     * Sanitized landing-page path (no query string, no hash).
     * Provided by the controller's URL-shape sanitizer.
     */
    landingPage?: string;
    /**
     * Raw UTM object (e.g. parsed from request body). The service applies
     * per-field truncation rules and discards if all fields end up empty.
     */
    rawUtm?: unknown;
    /**
     * Frontend-supplied referrer (e.g. captured from `document.referrer` at
     * landing). Takes priority over `headerReferrer` because the frontend has
     * already filtered out internal navigation.
     */
    bodyReferrer?: string;
    /**
     * Browser-supplied `Referer` header for the API request. Used only when
     * `bodyReferrer` is absent and the value is not internal to the site —
     * the header is otherwise just the current page URL making the call.
     */
    headerReferrer?: string;
}

/**
 * Input for recording a page visit.
 */
export interface IRecordPageInput {
    /** Route path (e.g., '/accounts/TXyz...') */
    path: string;
}

/**
 * Public user representation (framework-independent).
 *
 * Used in API responses and frontend state. Converts MongoDB ObjectId
 * to string and omits internal fields.
 *
 * ## Future Extensibility
 *
 * If plugins need access to user data, this interface should be moved
 * to `@/types` as `IUser` to enable cross-package consumption.
 * The `IUserDocument` (MongoDB-specific) stays in this module.
 */
export interface IUser {
    /** UUID v4 identifier */
    id: string;
    /**
     * Canonical identity state. Authoritative stored field — see
     * `IUserDocument.identityState`.
     */
    identityState: UserIdentityState;
    /**
     * Timestamp the current Verified session was established. `null`
     * when `identityState !== Verified`. See
     * `IUserDocument.identityVerifiedAt`.
     */
    identityVerifiedAt: Date | null;
    /** Linked wallet addresses */
    wallets: IWalletLink[];
    /** User preferences */
    preferences: IUserPreferences;
    /** Activity metrics */
    activity: IUserActivity;
    /** Admin-defined group memberships. Group ids resolve via `IUserGroupService`. */
    groups: string[];
    /** Referral tracking (null until first wallet verification or referral attribution) */
    referral: IReferral | null;
    /** Document creation timestamp */
    createdAt: Date;
    /** Document last update timestamp */
    updatedAt: Date;
}
