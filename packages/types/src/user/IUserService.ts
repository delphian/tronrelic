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
