/**
 * User-related interfaces for plugin consumption.
 *
 * These interfaces provide a framework-independent representation of user data
 * that plugins can use without accessing internal MongoDB document structures.
 * The actual IUserDocument (with MongoDB-specific fields) remains internal to
 * the user module.
 *
 * @module @tronrelic/types/user
 */

/**
 * Represents a linked TRON wallet address associated with a user identity.
 *
 * Users can link multiple wallets to their anonymous UUID, enabling
 * cross-wallet preferences and unified activity tracking.
 */
export interface IWalletLink {
    /** Base58 TRON address (e.g., TRX7NJa...) */
    address: string;
    /** Timestamp when wallet was first connected */
    linkedAt: Date;
    /** Whether this is the default wallet for display */
    isPrimary: boolean;
    /** Whether wallet ownership has been cryptographically verified via signature */
    verified: boolean;
    /** Timestamp of last connection/use */
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
 */
export interface IUser {
    /** UUID v4 identifier */
    id: string;
    /**
     * UI/feature gate controlling what is surfaced to the user.
     * When false, frontend shows "Connect" button and hides logged-in features.
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
