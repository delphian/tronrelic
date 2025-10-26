/**
 * Database service exports.
 *
 * Provides:
 * - DatabaseService: Core database service with unified database access
 * - PluginDatabaseService: Plugin-scoped database access with automatic collection prefixing
 */

export { DatabaseService } from './database.service.js';
export { PluginDatabaseService } from './plugin-database.service.js';
