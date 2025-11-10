import { DatabaseService } from './database.service.js';
import type { Connection } from 'mongoose';
import type { ISystemLogService } from '@tronrelic/types';

/**
 * Plugin-scoped database access implementation.
 *
 * Extends DatabaseService with automatic collection name prefixing for plugin isolation.
 * Each plugin gets its own namespace (e.g., "plugin_whale-alerts_subscriptions") to
 * prevent naming conflicts between plugins and ensure data isolation.
 *
 * Why this exists:
 * - **Namespace isolation** - Each plugin gets its own collection namespace
 * - **Zero configuration** - Plugins access collections by logical names
 * - **Inherits all DatabaseService features** - Model registry, convenience methods, etc.
 * - **Backward compatible** - Existing plugin code continues working unchanged
 *
 * @example
 * ```typescript
 * // In plugin init:
 * import mongoose from 'mongoose';
 * const db = new PluginDatabaseService(logger, mongoose.connection, 'whale-alerts');
 *
 * // Access collection (becomes "plugin_whale-alerts_subscriptions")
 * const subscriptions = db.getCollection('subscriptions');
 * await subscriptions.insertOne({ userId: '123', enabled: true });
 *
 * // Simple key-value storage
 * await db.set('lastSync', new Date());
 * const lastSync = await db.get<Date>('lastSync');
 * ```
 */
export class PluginDatabaseService extends DatabaseService {
    /**
     * Create a plugin-scoped database service.
     *
     * The plugin ID is used to automatically prefix all collection names, ensuring
     * isolation between plugins and preventing naming conflicts.
     *
     * @param logger - System log service for database operation logging
     * @param mongooseConnection - Mongoose connection instance
     * @param pluginId - The unique plugin identifier (from manifest)
     */
    constructor(logger: ISystemLogService, mongooseConnection: Connection, pluginId: string) {
        super(logger, mongooseConnection, { prefix: `plugin_${pluginId}_` });
    }
}
