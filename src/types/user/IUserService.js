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
export {};
//# sourceMappingURL=IUserService.js.map