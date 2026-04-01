/**
 * User service interface for plugin consumption.
 *
 * Provides read-only access to user data that plugins can use for:
 * - Checking if a user has verified wallets (registered user)
 * - Looking up users by ID or wallet address
 * - Accessing user preferences for plugin-specific settings
 * - Querying aggregate user statistics for health monitoring
 *
 * The concrete UserService implementation handles caching, wallet verification,
 * and activity tracking internally. Plugins receive this interface via
 * IPluginContext.userService dependency injection, or discover it on the
 * service registry via `context.services.get<IUserService>('user')`.
 *
 * @module @tronrelic/types/user
 */
import type { IUser } from './IUser.js';
/**
 * Aggregate user activity metrics for health monitoring.
 *
 * Combines user counts, engagement metrics, and daily visitor trends
 * into a single snapshot useful for admin dashboards and AI assistants.
 */
export interface IUserActivitySummary {
    /** Total registered users in the system. */
    totalUsers: number;
    /** Users with activity.lastSeen within the last 24 hours. */
    activeToday: number;
    /** Users with activity.lastSeen within the last 7 days. */
    activeThisWeek: number;
    /** Users with activity.firstSeen within the last 24 hours. */
    newUsersToday: number;
    /** Users with activity.firstSeen within the last 7 days. */
    newUsersThisWeek: number;
    /** Average session duration in seconds across recent sessions. */
    avgSessionDuration: number;
    /** Average pages viewed per session. */
    avgPagesPerSession: number;
    /** Percentage of sessions with one or fewer page views. */
    bounceRate: number;
    /** Daily unique visitor counts for the last 7 days. */
    dailyTrend: Array<{
        date: string;
        count: number;
    }>;
}
/**
 * Wallet linking statistics for health monitoring.
 *
 * Tracks wallet adoption, verification rates, and conversion funnel
 * from anonymous visitor to verified wallet holder.
 */
export interface IUserWalletSummary {
    /** Total wallet links across all users. */
    totalWalletLinks: number;
    /** Users with at least one wallet linked. */
    usersWithWallets: number;
    /** Users with no wallets linked. */
    usersWithoutWallets: number;
    /** Users with two or more wallets linked. */
    usersWithMultipleWallets: number;
    /** Average number of wallets per user (total links / total users). */
    averageWalletsPerUser: number;
    /** Wallets with cryptographic signature verification. */
    verifiedWallets: number;
    /** Wallets connected but not yet verified. */
    unverifiedWallets: number;
    /** Wallets linked within the last 24 hours. */
    walletsLinkedToday: number;
    /** Wallets linked within the last 7 days. */
    walletsLinkedThisWeek: number;
    /** Conversion funnel: visitor → return visitor → wallet connected → wallet verified. */
    conversionFunnel: Array<{
        stage: string;
        count: number;
        percentage: number;
    }>;
}
/**
 * User retention metrics for health monitoring.
 *
 * Provides new vs returning visitor breakdown, dormant user counts,
 * and daily retention trends.
 */
export interface IUserRetentionSummary {
    /** Users whose first visit was today. */
    newUsersToday: number;
    /** Users active today who first visited before today. */
    returningUsersToday: number;
    /** Users with lastSeen > 30 days ago but lifetime pageViews > 10. */
    dormantUsers: number;
    /** Daily new vs returning visitor breakdown for the last 7 days. */
    dailyRetention: Array<{
        date: string;
        newVisitors: number;
        returningVisitors: number;
    }>;
}
/**
 * User preference distribution for health monitoring.
 *
 * Aggregates theme choices and notification opt-in rates
 * across the user base.
 */
export interface IUserPreferencesSummary {
    /** Count of users per theme UUID (or 'unset' for no preference). */
    themeDistribution: Record<string, number>;
    /** Percentage of users who opted into notifications. */
    notificationOptInRate: number;
    /** Number of users who have set at least one preference. */
    totalWithPreferences: number;
}
/**
 * User service interface exposed to plugins.
 *
 * Provides read-only methods for accessing user identity data and
 * aggregate statistics. Plugins should not modify user data directly —
 * use plugin-specific storage or coordinate with the user module for updates.
 *
 * Note: For HTTP route handlers, user context is automatically available
 * via `req.userId` and `req.user` (populated by middleware). Use IUserService
 * for non-request contexts like observers or scheduled jobs.
 *
 * @example
 * ```typescript
 * // In plugin observer - look up user by wallet address
 * async init(context: IPluginContext) {
 *     const { userService, logger } = context;
 *
 *     class TransferObserver extends context.BaseObserver {
 *         protected readonly name = 'TransferObserver';
 *
 *         protected async process(transaction: ITransaction): Promise<void> {
 *             const fromAddress = transaction.payload.from.address;
 *             const user = await userService.getByWallet(fromAddress);
 *
 *             if (user) {
 *                 const hasVerifiedWallet = user.wallets?.some(w => w.verified);
 *                 logger.info({ userId: user.id, hasVerifiedWallet },
 *                     'Transaction from known user');
 *             }
 *         }
 *     }
 *
 *     context.observerRegistry.subscribeTransactionType(
 *         'TransferContract',
 *         new TransferObserver()
 *     );
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Discover via service registry for aggregate stats
 * const userService = context.services.get<IUserService>('user');
 * if (userService) {
 *     const activity = await userService.getActivitySummary();
 *     logger.info({ activeToday: activity.activeToday }, 'User activity snapshot');
 * }
 * ```
 */
export interface IUserService {
    /**
     * Get a user by UUID.
     *
     * Returns cached user if available, otherwise fetches from database.
     * Returns null if UUID is invalid or user not found.
     *
     * @param id - UUID v4 identifier
     * @returns User data or null if not found
     */
    getById(id: string): Promise<IUser | null>;
    /**
     * Get a user by linked wallet address.
     *
     * Useful for reverse lookups when you know the wallet but not the UUID.
     * Handles TRON address normalization internally.
     *
     * @param address - Base58 TRON address
     * @returns User data or null if no user has this wallet linked
     */
    getByWallet(address: string): Promise<IUser | null>;
    /**
     * Get aggregate user activity metrics.
     *
     * Combines user counts, engagement stats, and a 7-day daily visitor
     * trend into a single snapshot for health monitoring.
     *
     * @returns Activity summary with counts, engagement, and trends
     */
    getActivitySummary(): Promise<IUserActivitySummary>;
    /**
     * Get wallet linking statistics.
     *
     * Tracks adoption rates, verification progress, and the conversion
     * funnel from anonymous visitor to verified wallet holder.
     *
     * @returns Wallet summary with counts, rates, and funnel stages
     */
    getWalletSummary(): Promise<IUserWalletSummary>;
    /**
     * Get user retention metrics.
     *
     * Provides new vs returning visitor breakdown, dormant user detection,
     * and a 7-day daily retention trend.
     *
     * @returns Retention summary with daily breakdown and dormant count
     */
    getRetentionSummary(): Promise<IUserRetentionSummary>;
    /**
     * Get user preference distribution.
     *
     * Aggregates theme choices and notification opt-in rates across
     * the user base for health monitoring and audience understanding.
     *
     * @returns Preference summary with theme distribution and opt-in rates
     */
    getPreferencesSummary(): Promise<IUserPreferencesSummary>;
}
//# sourceMappingURL=IUserService.d.ts.map