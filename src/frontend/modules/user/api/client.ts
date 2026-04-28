/**
 * User module API client functions.
 *
 * Provides typed API calls for user identity operations including
 * fetching users, linking wallets, managing preferences, and admin operations.
 */

import { apiClient } from '../../../lib/api';
import type { IUserData, IUserPreferences, IUserStats } from '../types';

// ============================================================================
// Wallet Connection Result Types
// ============================================================================

/**
 * Result of wallet registration attempt (stage 1 of the two-stage wallet flow).
 *
 * On success, the wallet is stored on the backend with `verified: false`,
 * moving the user from *anonymous* to *registered*. When the wallet is
 * already linked to another user, returns `loginRequired: true` with the
 * existing user ID — the frontend should then prompt for signature
 * verification to swap identity into the existing (verified) owner.
 */
export interface IConnectWalletResult {
    /** Whether registration succeeded (wallet now linked to this user) */
    success: boolean;
    /** Updated user data (when success=true) */
    user?: IUserData;
    /** Whether wallet is linked to another user and login is required */
    loginRequired?: boolean;
    /** The existing user ID that owns this wallet (when loginRequired=true) */
    existingUserId?: string;
}

/**
 * Result of wallet verification attempt (stage 2 of the two-stage wallet flow).
 *
 * On success the wallet is upgraded to `verified: true` and the user
 * transitions into the *verified* state. When identity swap occurs (wallet
 * belonged to another user), returns `identitySwapped: true` with the
 * existing owner's data — the calling UUID becomes a tombstone.
 */
export interface ILinkWalletResult {
    /** The user data (either updated current user or swapped-to user) */
    user: IUserData;
    /** Whether identity was swapped to existing wallet owner */
    identitySwapped?: boolean;
    /** The previous user ID before swap (for cleanup on frontend) */
    previousUserId?: string;
}

/**
 * Wallet operations gated by a server-issued challenge.
 *
 * `'refresh-verification'` is the freshness-pump action used by the
 * dual-track admin recovery flow when a verified admin's `verifiedAt`
 * has aged past the freshness window and the cookie path returns 401
 * with `reason: 'verification_stale'`. Distinct nonce scope keeps a
 * captured signature for any other action from being replayable here.
 */
export type WalletChallengeAction = 'link' | 'unlink' | 'set-primary' | 'refresh-verification';

/**
 * Server-issued single-use wallet challenge.
 *
 * The client signs `message` verbatim with TronLink and submits the
 * signature plus `nonce` back to the matching wallet endpoint within the
 * TTL window indicated by `expiresAt`.
 */
export interface IWalletChallenge {
    /** Single-use nonce to submit alongside the signature */
    nonce: string;
    /** Canonical message to sign verbatim with TronLink */
    message: string;
    /** Unix epoch ms when the nonce expires (informational only) */
    expiresAt: number;
}

// ============================================================================
// User API Functions
// ============================================================================

/**
 * Bootstrap the visitor's identity.
 *
 * Idempotent: returning visitors get their canonical user back; first-time
 * visitors have a UUID minted server-side and an HttpOnly `tronrelic_uid`
 * cookie set on the response. The frontend never reads the UUID from
 * cookies or localStorage — every page load just calls this once and
 * receives the user data.
 *
 * @returns User data from API
 */
export async function bootstrapUser(): Promise<IUserData> {
    const response = await apiClient.post(
        `/user/bootstrap`,
        {},
        { withCredentials: true }
    );
    return response.data as IUserData;
}

/**
 * Fetch user data by UUID.
 *
 * Used after bootstrap when the client already knows its own UUID and
 * needs to refresh the data (e.g. after wallet operations). Cookie still
 * required — the backend validates `tronrelic_uid` matches `:id`.
 *
 * @param userId - User UUID
 * @returns User data from API
 */
export async function fetchUser(userId: string): Promise<IUserData> {
    const response = await apiClient.get(`/user/${userId}`, {
        withCredentials: true
    });
    return response.data as IUserData;
}

/**
 * Register a wallet to a user identity (no signature required).
 *
 * Stage 1 of the two-stage wallet flow. Stores the wallet on the backend
 * with `verified: false`, moving the user from *anonymous* to *registered*.
 * Use `linkWallet` (stage 2) to upgrade the wallet to *verified*.
 *
 * The function name `connectWallet` matches the HTTP route
 * (`POST /api/user/:id/wallet/connect`) for wire consistency; the *effect*
 * is registration.
 *
 * When the wallet is already linked to another user, returns
 * `loginRequired: true`. Frontend should then prompt for signature
 * verification to log in as that existing owner.
 *
 * @param userId - User UUID
 * @param address - TRON wallet address
 * @returns Result with success status or login requirement
 */
export async function connectWallet(
    userId: string,
    address: string
): Promise<IConnectWalletResult> {
    const response = await apiClient.post(
        `/user/${userId}/wallet/connect`,
        { address },
        { withCredentials: true }
    );
    return response.data as IConnectWalletResult;
}

/**
 * Request a server-issued single-use challenge for a wallet operation.
 *
 * Replaces the legacy client-supplied timestamp with a server-minted nonce.
 * Call this before `linkWallet`, `unlinkWallet`, or `setPrimaryWallet`,
 * sign the returned `message` with TronLink, then submit the signature
 * along with `nonce` to the matching endpoint within the TTL window
 * (~60 seconds).
 *
 * @param userId - User UUID
 * @param action - Wallet operation the challenge will gate
 * @param address - TRON wallet address (hex or base58 — server normalizes)
 * @returns Challenge with nonce, canonical message, and expiry
 */
export async function requestWalletChallenge(
    userId: string,
    action: WalletChallengeAction,
    address: string
): Promise<IWalletChallenge> {
    const response = await apiClient.post(
        `/user/${userId}/wallet/challenge`,
        { action, address },
        { withCredentials: true }
    );
    return response.data as IWalletChallenge;
}

/**
 * Verify a wallet on a user identity (cryptographic signature required).
 *
 * Stage 2 of the two-stage wallet flow. Upgrades a registered wallet to
 * `verified: true` (or adds it as already verified), moving the user into
 * the *verified* state.
 *
 * The function name `linkWallet` matches the HTTP route
 * (`POST /api/user/:id/wallet`) for wire consistency; the *effect* is
 * verification.
 *
 * If the wallet belongs to another user, performs identity swap and returns
 * `identitySwapped: true` with the existing owner's data. Frontend should
 * update cookie/localStorage to the new user ID — this is the cross-browser
 * login path for *verified* users.
 *
 * @param userId - User UUID
 * @param address - TRON wallet address
 * @param message - Canonical message returned by the matching challenge
 * @param signature - TronLink signature over `message`
 * @param nonce - Single-use nonce from `requestWalletChallenge`
 * @returns Result with user data and optional identity swap indicator
 */
export async function linkWallet(
    userId: string,
    address: string,
    message: string,
    signature: string,
    nonce: string
): Promise<ILinkWalletResult> {
    const response = await apiClient.post(
        `/user/${userId}/wallet`,
        { address, message, signature, nonce },
        { withCredentials: true }
    );
    return response.data as ILinkWalletResult;
}

/**
 * Unlink a wallet from user identity.
 *
 * @param userId - User UUID
 * @param address - TRON wallet address to unlink
 * @param message - Canonical message returned by the matching challenge
 * @param signature - TronLink signature over `message`
 * @param nonce - Single-use nonce from `requestWalletChallenge`
 * @returns Updated user data
 */
export async function unlinkWallet(
    userId: string,
    address: string,
    message: string,
    signature: string,
    nonce: string
): Promise<IUserData> {
    const response = await apiClient.delete(
        `/user/${userId}/wallet/${address}`,
        {
            data: { message, signature, nonce },
            withCredentials: true
        }
    );
    return response.data as IUserData;
}

/**
 * Set a wallet as primary.
 *
 * Step-up authentication: requires a fresh signature even though the wallet
 * was already verified at link time. Cookie alone is XSS-stealable, and
 * primary drives downstream attribution that should not be steerable from
 * a captured cookie.
 *
 * @param userId - User UUID
 * @param address - TRON wallet address to set as primary
 * @param message - Canonical message returned by the matching challenge
 * @param signature - TronLink signature over `message`
 * @param nonce - Single-use nonce from `requestWalletChallenge`
 * @returns Updated user data
 */
export async function setPrimaryWallet(
    userId: string,
    address: string,
    message: string,
    signature: string,
    nonce: string
): Promise<IUserData> {
    const response = await apiClient.patch(
        `/user/${userId}/wallet/${address}/primary`,
        { message, signature, nonce },
        { withCredentials: true }
    );
    return response.data as IUserData;
}

/**
 * Refresh the freshness clock on an already-verified wallet.
 *
 * Recovery path for stale-Verified admins: when an API call to a
 * `requireAdmin`-protected endpoint returns 401 with
 * `reason: 'verification_stale'`, the operator is already a verified
 * admin — they just need to re-prove control of any one of their
 * wallets to bring `verifiedAt` back inside the freshness window.
 *
 * Mints a `'refresh-verification'` challenge via `requestWalletChallenge`,
 * the user signs the canonical message with TronLink, and this call
 * consumes the nonce and updates `verifiedAt = now` on the wallet.
 *
 * Refuses to operate on registered (unsigned) wallets — moving a
 * wallet from registered → verified is the link flow's job. Use
 * `linkWallet` for that.
 *
 * @param userId - User UUID
 * @param address - Already-verified wallet address to refresh
 * @param message - Canonical message returned by the matching challenge
 * @param signature - TronLink signature over `message`
 * @param nonce - Single-use nonce from `requestWalletChallenge` with action='refresh-verification'
 * @returns Updated user data with the wallet's `verifiedAt` set to now
 */
export async function refreshWalletVerification(
    userId: string,
    address: string,
    message: string,
    signature: string,
    nonce: string
): Promise<IUserData> {
    const response = await apiClient.post(
        `/user/${userId}/wallet/${address}/refresh-verification`,
        { message, signature, nonce },
        { withCredentials: true }
    );
    return response.data as IUserData;
}

/**
 * Update user preferences.
 *
 * @param userId - User UUID
 * @param preferences - Partial preferences to update
 * @returns Updated user data
 */
export async function updatePreferences(
    userId: string,
    preferences: Partial<IUserPreferences>
): Promise<IUserData> {
    const response = await apiClient.patch(
        `/user/${userId}/preferences`,
        preferences,
        { withCredentials: true }
    );
    return response.data as IUserData;
}

/**
 * Record user activity (page view).
 *
 * @param userId - User UUID
 * @deprecated Use startSession and recordPage for session-aware tracking
 */
export async function recordActivity(userId: string): Promise<void> {
    await apiClient.post(
        `/user/${userId}/activity`,
        {},
        { withCredentials: true }
    );
}

// ============================================================================
// Session Tracking Functions
// ============================================================================

/** Screen size category based on viewport width breakpoints */
export type ScreenSizeCategory = 'mobile-sm' | 'mobile-md' | 'mobile-lg' | 'tablet' | 'desktop' | 'desktop-lg' | 'unknown';

/**
 * UTM campaign tracking parameters captured from the landing page URL.
 */
export interface IUtmParams {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
}

/**
 * Session data returned from session/start endpoint.
 */
export interface ISessionData {
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number;
    pages: Array<{ path: string; timestamp: string }>;
    device: 'mobile' | 'tablet' | 'desktop' | 'unknown';
    screenWidth: number | null;
    screenSize: ScreenSizeCategory;
    referrerDomain: string | null;
    country: string | null;
    utm: IUtmParams | null;
    landingPage: string | null;
    searchKeyword: string | null;
}

/**
 * Start a new session or return the active session.
 * Device, country, and referrer are derived from request headers server-side.
 * Screen size is derived from the provided screenWidth using design system breakpoints.
 * Search keywords are extracted server-side from the referrer URL for known search engines.
 *
 * @param userId - User UUID
 * @param referrer - Optional referrer URL (defaults to document.referrer)
 * @param screenWidth - Optional viewport width in pixels
 * @param utm - Optional UTM campaign parameters from landing page URL
 * @param landingPage - Optional landing page path
 * @returns Session data
 */
export async function startSession(
    userId: string,
    referrer?: string,
    screenWidth?: number,
    utm?: IUtmParams,
    landingPage?: string
): Promise<ISessionData> {
    const response = await apiClient.post(
        `/user/${userId}/session/start`,
        { referrer, screenWidth, utm, landingPage },
        { withCredentials: true }
    );
    return response.data.session as ISessionData;
}

/**
 * Record a page visit in the current session.
 *
 * @param userId - User UUID
 * @param path - Route path (e.g., '/accounts/TXyz...')
 */
export async function recordPage(userId: string, path: string): Promise<void> {
    await apiClient.post(
        `/user/${userId}/session/page`,
        { path },
        { withCredentials: true }
    );
}

/**
 * Update session heartbeat to extend duration tracking.
 * Should be called periodically (e.g., every 30 seconds).
 *
 * @param userId - User UUID
 */
export async function heartbeat(userId: string): Promise<void> {
    await apiClient.post(
        `/user/${userId}/session/heartbeat`,
        {},
        { withCredentials: true }
    );
}

/**
 * End the current session explicitly.
 * Called when user navigates away or closes the page.
 *
 * @param userId - User UUID
 */
export async function endSession(userId: string): Promise<void> {
    await apiClient.post(
        `/user/${userId}/session/end`,
        {},
        { withCredentials: true }
    );
}

// ============================================================================
// Login State Functions
// ============================================================================

/**
 * Log in a user (set isLoggedIn to true).
 *
 * This is a UI/feature gate - it controls what is surfaced to the user,
 * not their underlying identity. UUID tracking continues regardless.
 *
 * @param userId - User UUID
 * @returns Updated user data
 */
export async function loginUser(userId: string): Promise<IUserData> {
    const response = await apiClient.post(
        `/user/${userId}/login`,
        {},
        { withCredentials: true }
    );
    return response.data as IUserData;
}

/**
 * Log out a user (set isLoggedIn to false).
 *
 * This is a UI/feature gate - wallets and all other data remain intact.
 * The user is still tracked by UUID under the hood.
 *
 * @param userId - User UUID
 * @returns Updated user data
 */
export async function logoutUser(userId: string): Promise<IUserData> {
    const response = await apiClient.post(
        `/user/${userId}/logout`,
        {},
        { withCredentials: true }
    );
    return response.data as IUserData;
}

// ============================================================================
// Public Profile Functions
// ============================================================================

/**
 * Public profile data returned from the profile endpoint.
 */
export interface IPublicProfile {
    /** UUID of the user who owns this profile */
    userId: string;
    /** Verified wallet address for this profile */
    address: string;
    /** When the user account was created */
    createdAt: string;
    /** Always true — public profiles only resolve for *verified* users. */
    isVerified: true;
}

/**
 * Fetch public profile by wallet address.
 *
 * This endpoint is publicly accessible — no authentication required.
 * Returns null if no profile exists for the given address. A profile only
 * exists when the address belongs to a user in the *verified* identity
 * state (i.e. the wallet has `verified: true`); registered (unsigned)
 * wallet addresses resolve to null.
 *
 * @param address - TRON wallet address
 * @returns Profile data or null if not found
 */
export async function fetchProfile(address: string): Promise<IPublicProfile | null> {
    try {
        const response = await apiClient.get(`/profile/${address}`);
        return response.data as IPublicProfile;
    } catch (error) {
        if ((error as { response?: { status: number } }).response?.status === 404) {
            return null;
        }
        throw error;
    }
}

// ============================================================================
// Referral API Functions
// ============================================================================

/** Referral statistics response. */
export interface IReferralStats {
    /** User's referral code */
    code: string;
    /** Number of visitors who arrived via this referral code */
    referredCount: number;
    /** Number of referred visitors who verified a wallet */
    convertedCount: number;
}

/**
 * Get referral code and stats for the authenticated user.
 *
 * Returns null if the user has no referral code yet (i.e. they are still
 * *anonymous* or *registered* — codes are issued only on transition into
 * the *verified* state). Throws on auth errors or server failures so the
 * UI can show an appropriate error state instead of the misleading
 * "verify wallet" message.
 *
 * @param userId - User UUID
 * @returns Referral stats or null (no code yet)
 * @throws Error on auth/network/server failures
 */
export async function fetchReferralStats(userId: string): Promise<IReferralStats | null> {
    const response = await apiClient.get(`/user/${userId}/referral`, {
        withCredentials: true
    });
    const data = response.data as IReferralStats | { referral: null };
    if ('referral' in data && data.referral === null) {
        return null;
    }
    return data as IReferralStats;
}

// ============================================================================
// Admin API Functions
// ============================================================================

const adminHeaderKey = 'x-admin-token';

/**
 * List all users (admin endpoint).
 *
 * @param token - Admin API token
 * @param options - Pagination and search options
 * @returns Users list with stats
 */
export async function adminListUsers(
    token: string,
    options?: { limit?: number; skip?: number; search?: string }
): Promise<{ users: IUserData[]; total: number; stats: IUserStats }> {
    const response = await apiClient.get('/admin/users', {
        headers: { [adminHeaderKey]: token },
        params: options
    });
    return response.data as { users: IUserData[]; total: number; stats: IUserStats };
}

/**
 * Get user statistics (admin endpoint).
 *
 * @param token - Admin API token
 * @returns User statistics
 */
export async function adminGetUserStats(token: string): Promise<IUserStats> {
    const response = await apiClient.get('/admin/users/stats', {
        headers: { [adminHeaderKey]: token }
    });
    return response.data as IUserStats;
}

/**
 * Daily visitor count data point.
 */
export interface IDailyVisitorData {
    date: string;
    count: number;
}

/** Valid period options for visitor origin queries. */
export type VisitorPeriod = '24h' | '7d' | '30d' | '90d';

/**
 * UTM campaign parameters for traffic origin display.
 */
export interface IUtmParams {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
}

/**
 * Visitor origin summary for admin analytics.
 *
 * Represents traffic acquisition data from a visitor's first-ever session,
 * combined with lifetime engagement metrics.
 */
export interface IVisitorOrigin {
    userId: string;
    firstSeen: string;
    lastSeen: string;
    country: string | null;
    referrerDomain: string | null;
    landingPage: string | null;
    device: string;
    utm: IUtmParams | null;
    searchKeyword: string | null;
    sessionsCount: number;
    pageViews: number;
}

/**
 * Get daily unique visitor counts for charting (admin endpoint).
 *
 * @param token - Admin API token
 * @param days - Number of days to look back (default: 90)
 * @returns Array of daily visitor count data points
 */
export async function adminGetDailyVisitors(
    token: string,
    days: number = 90
): Promise<IDailyVisitorData[]> {
    const response = await apiClient.get('/admin/users/analytics/daily-visitors', {
        headers: { [adminHeaderKey]: token },
        params: { days }
    });
    return (response.data as { data: IDailyVisitorData[] }).data ?? [];
}

/**
 * Get visitor traffic origins from first-ever sessions (admin endpoint).
 *
 * @param token - Admin API token
 * @param options - Period, pagination options
 * @returns Paginated list of visitor origins
 */
export async function adminGetVisitorOrigins(
    token: string,
    options?: { period?: VisitorPeriod; limit?: number; skip?: number }
): Promise<{ visitors: IVisitorOrigin[]; total: number }> {
    const response = await apiClient.get('/admin/users/analytics/visitor-origins', {
        headers: { [adminHeaderKey]: token },
        params: options
    });
    return response.data as { visitors: IVisitorOrigin[]; total: number };
}

/**
 * Get new users first seen within the specified period (admin endpoint).
 *
 * Unlike adminGetVisitorOrigins which filters by lastSeen (recent activity),
 * this filters by firstSeen (new arrivals) and sorts most recent first.
 *
 * @param token - Admin API token
 * @param options - Period, pagination options
 * @returns Paginated list of new user origins
 */
export async function adminGetNewUsers(
    token: string,
    options?: { period?: VisitorPeriod; limit?: number; skip?: number }
): Promise<{ visitors: IVisitorOrigin[]; total: number }> {
    const response = await apiClient.get('/admin/users/analytics/new-users', {
        headers: { [adminHeaderKey]: token },
        params: options
    });
    return response.data as { visitors: IVisitorOrigin[]; total: number };
}

// ============================================================================
// Aggregate Analytics Types
// ============================================================================

/** Valid period options for aggregate analytics queries. */
export type AnalyticsPeriod = '24h' | '7d' | '30d' | '90d' | 'custom';

/** Custom date range parameters sent as ISO date strings. */
export interface ICustomDateRange {
    /** Start date ISO string (e.g. '2026-03-01T00:00:00.000Z'). */
    startDate: string;
    /** End date ISO string (e.g. '2026-03-15T23:59:59.999Z'). */
    endDate: string;
}

/** Traffic source entry in aggregate breakdown. */
export interface ITrafficSource {
    source: string;
    category: string;
    count: number;
    percentage: number;
}

/** GSC keyword data with full metrics from Google Search Console. */
export interface IGscKeyword {
    /** Search keyword */
    keyword: string;
    /** Total clicks */
    clicks: number;
    /** Total impressions */
    impressions: number;
    /** Average click-through rate (0-1) */
    ctr: number;
    /** Average position in search results */
    position: number;
}

/** Detailed breakdown for a single traffic source (drill-down). */
export interface ITrafficSourceDetails {
    source: string;
    visitors: number;
    landingPages: Array<{ path: string; count: number; percentage: number }>;
    countries: Array<{ country: string; count: number; percentage: number }>;
    devices: Array<{ device: string; count: number; percentage: number }>;
    utmCampaigns: Array<{ source: string; medium: string; campaign: string; count: number }>;
    searchKeywords: Array<{ keyword: string; count: number }>;
    gscKeywords?: IGscKeyword[];
    engagement: { avgSessions: number; avgPageViews: number; avgDuration: number };
    conversion: { walletsConnected: number; walletsVerified: number; conversionRate: number };
}

/** Landing page entry with engagement metrics. */
export interface ILandingPage {
    path: string;
    visitors: number;
    avgSessions: number;
    avgPageViews: number;
}

/** Country entry in geographic distribution. */
export interface IGeoEntry {
    country: string;
    count: number;
    percentage: number;
}

/** Device category entry. */
export interface IDeviceEntry {
    device: string;
    count: number;
    percentage: number;
}

/** Screen size category entry. */
export interface IScreenSizeEntry {
    screenSize: string;
    count: number;
    percentage: number;
}

/** UTM campaign performance entry. */
export interface ICampaignEntry {
    source: string;
    medium: string;
    campaign: string;
    visitors: number;
    walletsConnected: number;
    walletsVerified: number;
    conversionRate: number;
}

/** Engagement metrics summary. */
export interface IEngagementMetrics {
    avgSessionDuration: number;
    avgPagesPerSession: number;
    bounceRate: number;
    avgSessionsPerUser: number;
    totalUsers: number;
}

/** Conversion funnel stage. */
export interface IFunnelStage {
    stage: string;
    count: number;
    percentage: number;
    dropOff: number;
}

/** Daily new vs returning visitor entry. */
export interface IRetentionEntry {
    date: string;
    newVisitors: number;
    returningVisitors: number;
}

// ============================================================================
// Aggregate Analytics API Functions
// ============================================================================

/**
 * Get aggregate traffic source breakdown (admin endpoint).
 *
 * @param token - Admin API token
 * @param period - Lookback period (default: '30d')
 * @returns Traffic sources with counts and percentages
 */
export async function adminGetTrafficSources(
    token: string,
    period: AnalyticsPeriod = '30d',
    customRange?: ICustomDateRange
): Promise<{ sources: ITrafficSource[]; total: number }> {
    const params = customRange ? customRange : { period };
    const response = await apiClient.get('/admin/users/analytics/traffic-sources', {
        headers: { [adminHeaderKey]: token },
        params
    });
    return response.data as { sources: ITrafficSource[]; total: number };
}

/**
 * Get detailed breakdown for a specific traffic source (admin endpoint).
 *
 * Returns landing pages, countries, devices, UTM campaigns, search keywords,
 * engagement metrics, and conversion rates for visitors from the given source.
 *
 * @param token - Admin API token
 * @param source - Referrer domain (e.g. 'duckduckgo.com') or 'direct'
 * @param period - Lookback period (default: '30d')
 * @returns Detailed source breakdown
 */
export async function adminGetTrafficSourceDetails(
    token: string,
    source: string,
    period: AnalyticsPeriod = '30d',
    customRange?: ICustomDateRange
): Promise<ITrafficSourceDetails> {
    const params = customRange ? { source, ...customRange } : { source, period };
    const response = await apiClient.get('/admin/users/analytics/traffic-source-details', {
        headers: { [adminHeaderKey]: token },
        params
    });
    return response.data as ITrafficSourceDetails;
}

/**
 * Get top landing pages by visitor count (admin endpoint).
 *
 * @param token - Admin API token
 * @param options - Period and limit options
 * @returns Landing pages with engagement metrics
 */
export async function adminGetTopLandingPages(
    token: string,
    options?: { period?: AnalyticsPeriod; limit?: number; customRange?: ICustomDateRange }
): Promise<{ pages: ILandingPage[]; totalPages: number; totalVisitors: number }> {
    const { customRange, ...rest } = options ?? {};
    const params = customRange ? { ...customRange, limit: rest.limit } : rest;
    const response = await apiClient.get('/admin/users/analytics/top-landing-pages', {
        headers: { [adminHeaderKey]: token },
        params
    });
    return response.data as { pages: ILandingPage[]; totalPages: number; totalVisitors: number };
}

/**
 * Get geographic distribution of visitors (admin endpoint).
 *
 * @param token - Admin API token
 * @param options - Period and limit options
 * @returns Country distribution with counts
 */
export async function adminGetGeoDistribution(
    token: string,
    options?: { period?: AnalyticsPeriod; limit?: number; customRange?: ICustomDateRange }
): Promise<{ countries: IGeoEntry[]; total: number }> {
    const { customRange, ...rest } = options ?? {};
    const params = customRange ? { ...customRange, limit: rest.limit } : rest;
    const response = await apiClient.get('/admin/users/analytics/geo-distribution', {
        headers: { [adminHeaderKey]: token },
        params
    });
    return response.data as { countries: IGeoEntry[]; total: number };
}

/**
 * Get device and screen size breakdown (admin endpoint).
 *
 * @param token - Admin API token
 * @param period - Lookback period (default: '30d')
 * @returns Device and screen size distributions
 */
export async function adminGetDeviceBreakdown(
    token: string,
    period: AnalyticsPeriod = '30d',
    customRange?: ICustomDateRange
): Promise<{ devices: IDeviceEntry[]; screenSizes: IScreenSizeEntry[]; total: number }> {
    const params = customRange ? customRange : { period };
    const response = await apiClient.get('/admin/users/analytics/device-breakdown', {
        headers: { [adminHeaderKey]: token },
        params
    });
    return response.data as { devices: IDeviceEntry[]; screenSizes: IScreenSizeEntry[]; total: number };
}

/**
 * Get UTM campaign performance (admin endpoint).
 *
 * @param token - Admin API token
 * @param options - Period and limit options
 * @returns Campaign entries with conversion rates
 */
export async function adminGetCampaignPerformance(
    token: string,
    options?: { period?: AnalyticsPeriod; limit?: number; customRange?: ICustomDateRange }
): Promise<{ campaigns: ICampaignEntry[]; total: number }> {
    const { customRange, ...rest } = options ?? {};
    const params = customRange ? { ...customRange, limit: rest.limit } : rest;
    const response = await apiClient.get('/admin/users/analytics/campaign-performance', {
        headers: { [adminHeaderKey]: token },
        params
    });
    return response.data as { campaigns: ICampaignEntry[]; total: number };
}

/**
 * Get engagement metrics (admin endpoint).
 *
 * @param token - Admin API token
 * @param period - Lookback period (default: '30d')
 * @returns Engagement summary (avg duration, pages/session, bounce rate)
 */
export async function adminGetEngagement(
    token: string,
    period: AnalyticsPeriod = '30d',
    customRange?: ICustomDateRange
): Promise<IEngagementMetrics> {
    const params = customRange ? customRange : { period };
    const response = await apiClient.get('/admin/users/analytics/engagement', {
        headers: { [adminHeaderKey]: token },
        params
    });
    return response.data as IEngagementMetrics;
}

/**
 * Get conversion funnel (admin endpoint).
 *
 * @param token - Admin API token
 * @param period - Lookback period (default: '30d')
 * @returns Funnel stages with drop-off percentages
 */
export async function adminGetConversionFunnel(
    token: string,
    period: AnalyticsPeriod = '30d',
    customRange?: ICustomDateRange
): Promise<{ stages: IFunnelStage[] }> {
    const params = customRange ? customRange : { period };
    const response = await apiClient.get('/admin/users/analytics/conversion-funnel', {
        headers: { [adminHeaderKey]: token },
        params
    });
    return response.data as { stages: IFunnelStage[] };
}

/**
 * Get new vs returning visitor retention data (admin endpoint).
 *
 * @param token - Admin API token
 * @param period - Lookback period (default: '30d')
 * @returns Daily new vs returning visitor counts
 */
export async function adminGetRetention(
    token: string,
    period: AnalyticsPeriod = '30d',
    customRange?: ICustomDateRange
): Promise<{ data: IRetentionEntry[] }> {
    const params = customRange ? customRange : { period };
    const response = await apiClient.get('/admin/users/analytics/retention', {
        headers: { [adminHeaderKey]: token },
        params
    });
    return response.data as { data: IRetentionEntry[] };
}

// ============================================================================
// Referral Analytics Types and Functions
// ============================================================================

/** Top referrer entry in admin referral overview. */
export interface ITopReferrer {
    userId: string;
    code: string;
    referredCount: number;
    convertedCount: number;
}

/** Recent referral entry in admin referral overview. */
export interface IRecentReferral {
    userId: string;
    referredBy: string;
    referredAt: string;
    hasVerifiedWallet: boolean;
}

/** Aggregate referral program overview. */
export interface IReferralOverview {
    totalReferrals: number;
    totalConverted: number;
    conversionRate: number;
    usersWithCodes: number;
    topReferrers: ITopReferrer[];
    recentReferrals: IRecentReferral[];
}

/**
 * Get aggregate referral program overview (admin endpoint).
 *
 * @param token - Admin API token
 * @param options - Period and limit options
 * @returns Referral overview with top referrers and recent activity
 */
export async function adminGetReferralOverview(
    token: string,
    options?: { period?: AnalyticsPeriod; limit?: number; customRange?: ICustomDateRange }
): Promise<IReferralOverview> {
    const { customRange, ...rest } = options ?? {};
    const params = customRange ? { ...customRange, limit: rest.limit } : rest;
    const response = await apiClient.get('/admin/users/analytics/referral-overview', {
        headers: { [adminHeaderKey]: token },
        params
    });
    return response.data as IReferralOverview;
}

// ============================================================================
// Google Search Console API Functions
// ============================================================================

/** GSC configuration status. */
export interface IGscStatus {
    /** Whether GSC credentials are configured */
    configured: boolean;
    /** GSC property URL */
    siteUrl?: string;
    /** Timestamp of last successful data fetch */
    lastFetch?: string;
}

/**
 * Get GSC configuration status (admin endpoint).
 *
 * @param token - Admin API token
 * @returns GSC configuration status
 */
export async function adminGetGscStatus(token: string): Promise<IGscStatus> {
    const response = await apiClient.get('/admin/users/analytics/gsc/status', {
        headers: { [adminHeaderKey]: token }
    });
    return response.data as IGscStatus;
}

/**
 * Save GSC service account credentials (admin endpoint).
 *
 * Validates the JSON key and tests API access before saving.
 *
 * @param token - Admin API token
 * @param serviceAccountJson - JSON string of Google service account key
 * @param siteUrl - GSC property URL (e.g., "https://tronrelic.com")
 * @returns Updated GSC status
 */
export async function adminSaveGscCredentials(
    token: string,
    serviceAccountJson: string,
    siteUrl: string
): Promise<IGscStatus> {
    const response = await apiClient.post(
        '/admin/users/analytics/gsc/credentials',
        { serviceAccountJson, siteUrl },
        { headers: { [adminHeaderKey]: token } }
    );
    return response.data as IGscStatus;
}

/**
 * Remove stored GSC credentials (admin endpoint).
 *
 * @param token - Admin API token
 */
export async function adminRemoveGscCredentials(token: string): Promise<void> {
    await apiClient.delete('/admin/users/analytics/gsc/credentials', {
        headers: { [adminHeaderKey]: token }
    });
}

/**
 * Trigger on-demand GSC data fetch (admin endpoint).
 *
 * @param token - Admin API token
 * @returns Number of rows fetched from GSC API
 */
export async function adminRefreshGscData(token: string): Promise<{ rowsFetched: number }> {
    const response = await apiClient.post(
        '/admin/users/analytics/gsc/refresh',
        {},
        { headers: { [adminHeaderKey]: token } }
    );
    return response.data as { rowsFetched: number };
}

/**
 * Get any user by ID (admin endpoint).
 *
 * @param token - Admin API token
 * @param userId - User UUID to lookup
 * @returns User data or null if not found
 */
export async function adminGetUser(
    token: string,
    userId: string
): Promise<IUserData | null> {
    try {
        const response = await apiClient.get(`/admin/users/${userId}`, {
            headers: { [adminHeaderKey]: token }
        });
        return response.data as IUserData;
    } catch (error) {
        if ((error as { response?: { status: number } }).response?.status === 404) {
            return null;
        }
        throw error;
    }
}
