/**
 * User service interface for plugin consumption.
 *
 * Provides read-only access to user data that plugins can use for:
 * - Checking if a user has verified wallets (registered user)
 * - Looking up users by ID or wallet address
 * - Accessing user preferences for plugin-specific settings
 *
 * The concrete UserService implementation handles caching, wallet verification,
 * and activity tracking internally. Plugins receive this interface via
 * IPluginContext.userService dependency injection.
 *
 * @module @tronrelic/types/user
 */

import type { IUser } from './IUser.js';

/**
 * User service interface exposed to plugins.
 *
 * Provides read-only methods for accessing user identity data.
 * Plugins should not modify user data directly - use plugin-specific
 * storage or coordinate with the user module for updates.
 *
 * @example
 * ```typescript
 * // In plugin backend init()
 * async init(context: IPluginContext) {
 *     const { userService, database, logger } = context;
 *
 *     // Check if user has linked wallets
 *     context.http.router.get('/my-plugin/data', async (req, res) => {
 *         const userId = parseCookieUserId(req.headers['cookie']);
 *         if (!userId) {
 *             return res.status(401).json({ error: 'Unauthorized' });
 *         }
 *
 *         const user = await userService.getById(userId);
 *         const isRegistered = (user?.wallets?.length ?? 0) > 0;
 *
 *         if (!isRegistered) {
 *             return res.status(403).json({ error: 'Wallet required' });
 *         }
 *
 *         // Proceed with registered user
 *     });
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
}
