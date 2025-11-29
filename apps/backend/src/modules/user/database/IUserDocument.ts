import { ObjectId } from 'mongodb';

/**
 * Represents a linked TRON wallet address associated with a user identity.
 *
 * Users can link multiple wallets to their anonymous UUID, enabling
 * cross-wallet preferences and unified activity tracking.
 *
 * Wallet connection follows a two-step flow:
 * 1. Connect: Store address with verified=false (no signature required)
 * 2. Verify: Update to verified=true after signature verification
 *
 * The `isPrimary` field is automatically maintained by UserService:
 * 1. Primary = most recent lastUsed among verified wallets
 * 2. Fallback = most recent lastUsed among unverified wallets (if no verified)
 *
 * External code should simply query for isPrimary=true.
 */
export interface IWalletLink {
    /** Base58 TRON address (e.g., TRX7NJa...) */
    address: string;
    /** Timestamp when wallet was first connected */
    linkedAt: Date;
    /** Whether this is the default wallet for display (auto-maintained by UserService) */
    isPrimary: boolean;
    /** Whether wallet ownership has been cryptographically verified via signature */
    verified: boolean;
    /** Timestamp of last connection/use (for primary wallet selection) */
    lastUsed: Date;
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
    /** Device category for this session */
    device: DeviceCategory;
    /** Referrer domain (e.g., 'twitter.com', 'google.com', null if direct) */
    referrerDomain: string | null;
    /** ISO 3166-1 alpha-2 country code (e.g., 'US', 'DE', 'JP') */
    country: string | null;
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
     * UI/feature gate controlling what is surfaced to the user.
     * When false, frontend shows "Connect" button and hides logged-in features.
     * UUID tracking continues regardless of this flag.
     */
    isLoggedIn: boolean;
    /** Linked TRON wallet addresses */
    wallets: IWalletLink[];
    /** User preferences (theme, notifications, plugin-specific) */
    preferences: IUserPreferences;
    /** Activity tracking metrics */
    activity: IUserActivity;
    /** Document creation timestamp */
    createdAt: Date;
    /** Document last update timestamp */
    updatedAt: Date;
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
 */
export interface ILinkWalletInput {
    /** Base58 TRON address to link */
    address: string;
    /** Signature message for verification */
    message: string;
    /** TronLink signature proving wallet ownership */
    signature: string;
    /** Timestamp when signature was created (for replay protection) */
    timestamp: number;
}

/**
 * Input for starting a new session.
 * Device category and country are derived server-side from request headers.
 */
export interface IStartSessionInput {
    /** Referrer URL (server extracts domain only) */
    referrer?: string;
    /** User-agent string (server derives device category, never stored raw) */
    userAgent?: string;
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
 * to `@tronrelic/types` as `IUser` to enable cross-package consumption.
 * The `IUserDocument` (MongoDB-specific) stays in this module.
 */
export interface IUser {
    /** UUID v4 identifier */
    id: string;
    /**
     * UI/feature gate controlling what is surfaced to the user.
     * When false, frontend shows "Connect" button and hides logged-in features.
     * UUID tracking continues regardless of this flag.
     */
    isLoggedIn: boolean;
    /** Linked wallet addresses */
    wallets: IWalletLink[];
    /** User preferences */
    preferences: IUserPreferences;
    /** Activity metrics */
    activity: IUserActivity;
    /** Document creation timestamp */
    createdAt: Date;
    /** Document last update timestamp */
    updatedAt: Date;
}
