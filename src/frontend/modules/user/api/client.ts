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
 * Result of wallet connection attempt.
 *
 * When a wallet is already linked to another user, returns `loginRequired: true`
 * with the existing user ID. The frontend should prompt for signature verification
 * to prove wallet ownership before swapping identity.
 */
export interface IConnectWalletResult {
    /** Whether connection succeeded (wallet now linked to this user) */
    success: boolean;
    /** Updated user data (when success=true) */
    user?: IUserData;
    /** Whether wallet is linked to another user and login is required */
    loginRequired?: boolean;
    /** The existing user ID that owns this wallet (when loginRequired=true) */
    existingUserId?: string;
}

/**
 * Result of wallet link/verification attempt.
 *
 * When identity swap occurs (wallet belonged to another user), returns
 * `identitySwapped: true` with the existing user's data.
 */
export interface ILinkWalletResult {
    /** The user data (either updated current user or swapped-to user) */
    user: IUserData;
    /** Whether identity was swapped to existing wallet owner */
    identitySwapped?: boolean;
    /** The previous user ID before swap (for cleanup on frontend) */
    previousUserId?: string;
}

// ============================================================================
// User API Functions
// ============================================================================

/**
 * Fetch or create user from backend.
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
 * Connect a wallet to user identity (without verification).
 *
 * This is the first step in the two-step wallet flow. Stores the
 * wallet address as unverified. Use linkWallet to verify ownership.
 *
 * When wallet is already linked to another user, returns loginRequired=true.
 * Frontend should then prompt for signature verification to login.
 *
 * @param userId - User UUID
 * @param address - TRON wallet address
 * @returns Connection result with success status or login requirement
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
 * Link a wallet to user identity (with signature verification).
 *
 * If wallet belongs to another user, performs identity swap and returns
 * identitySwapped=true with the existing user's data. Frontend should
 * update cookie/localStorage to the new user ID.
 *
 * @param userId - User UUID
 * @param address - TRON wallet address
 * @param message - Message that was signed
 * @param signature - TronLink signature
 * @param timestamp - Timestamp when signature was created
 * @returns Link result with user data and optional identity swap indicator
 */
export async function linkWallet(
    userId: string,
    address: string,
    message: string,
    signature: string,
    timestamp: number
): Promise<ILinkWalletResult> {
    const response = await apiClient.post(
        `/user/${userId}/wallet`,
        { address, message, signature, timestamp },
        { withCredentials: true }
    );
    return response.data as ILinkWalletResult;
}

/**
 * Unlink a wallet from user identity.
 *
 * @param userId - User UUID
 * @param address - TRON wallet address to unlink
 * @param message - Message that was signed
 * @param signature - TronLink signature
 * @returns Updated user data
 */
export async function unlinkWallet(
    userId: string,
    address: string,
    message: string,
    signature: string
): Promise<IUserData> {
    const response = await apiClient.delete(
        `/user/${userId}/wallet/${address}`,
        {
            data: { message, signature },
            withCredentials: true
        }
    );
    return response.data as IUserData;
}

/**
 * Set a wallet as primary.
 *
 * @param userId - User UUID
 * @param address - TRON wallet address to set as primary
 * @returns Updated user data
 */
export async function setPrimaryWallet(
    userId: string,
    address: string
): Promise<IUserData> {
    const response = await apiClient.patch(
        `/user/${userId}/wallet/${address}/primary`,
        {},
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
    /** Always true (only verified profiles are returned) */
    isVerified: true;
}

/**
 * Fetch public profile by wallet address.
 *
 * This endpoint is publicly accessible - no authentication required.
 * Returns null if no verified profile exists for the given address.
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
 * Returns null if the user has no referral code yet (no verified wallet).
 * Throws on auth errors or server failures so the UI can show an
 * appropriate error state instead of the misleading "verify wallet" message.
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
export type AnalyticsPeriod = '24h' | '7d' | '30d' | '90d';

/** Traffic source entry in aggregate breakdown. */
export interface ITrafficSource {
    source: string;
    category: string;
    count: number;
    percentage: number;
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
    period: AnalyticsPeriod = '30d'
): Promise<{ sources: ITrafficSource[]; total: number }> {
    const response = await apiClient.get('/admin/users/analytics/traffic-sources', {
        headers: { [adminHeaderKey]: token },
        params: { period }
    });
    return response.data as { sources: ITrafficSource[]; total: number };
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
    options?: { period?: AnalyticsPeriod; limit?: number }
): Promise<{ pages: ILandingPage[]; totalPages: number; totalVisitors: number }> {
    const response = await apiClient.get('/admin/users/analytics/top-landing-pages', {
        headers: { [adminHeaderKey]: token },
        params: options
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
    options?: { period?: AnalyticsPeriod; limit?: number }
): Promise<{ countries: IGeoEntry[]; total: number }> {
    const response = await apiClient.get('/admin/users/analytics/geo-distribution', {
        headers: { [adminHeaderKey]: token },
        params: options
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
    period: AnalyticsPeriod = '30d'
): Promise<{ devices: IDeviceEntry[]; screenSizes: IScreenSizeEntry[]; total: number }> {
    const response = await apiClient.get('/admin/users/analytics/device-breakdown', {
        headers: { [adminHeaderKey]: token },
        params: { period }
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
    options?: { period?: AnalyticsPeriod; limit?: number }
): Promise<{ campaigns: ICampaignEntry[]; total: number }> {
    const response = await apiClient.get('/admin/users/analytics/campaign-performance', {
        headers: { [adminHeaderKey]: token },
        params: options
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
    period: AnalyticsPeriod = '30d'
): Promise<IEngagementMetrics> {
    const response = await apiClient.get('/admin/users/analytics/engagement', {
        headers: { [adminHeaderKey]: token },
        params: { period }
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
    period: AnalyticsPeriod = '30d'
): Promise<{ stages: IFunnelStage[] }> {
    const response = await apiClient.get('/admin/users/analytics/conversion-funnel', {
        headers: { [adminHeaderKey]: token },
        params: { period }
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
    period: AnalyticsPeriod = '30d'
): Promise<{ data: IRetentionEntry[] }> {
    const response = await apiClient.get('/admin/users/analytics/retention', {
        headers: { [adminHeaderKey]: token },
        params: { period }
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
    options?: { period?: AnalyticsPeriod; limit?: number }
): Promise<IReferralOverview> {
    const response = await apiClient.get('/admin/users/analytics/referral-overview', {
        headers: { [adminHeaderKey]: token },
        params: options
    });
    return response.data as IReferralOverview;
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
