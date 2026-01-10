/**
 * Database module public API exports.
 *
 * This module provides unified database access and migration system for all
 * application components. Other modules and plugins should import from this
 * index file rather than accessing internal files directly.
 */

// Primary module export (implements IModule)
export { DatabaseModule } from './DatabaseModule.js';
export type { IDatabaseModuleDependencies } from './DatabaseModule.js';

// Core database service (for external consumers)
export { DatabaseService } from './services/database.service.js';
export { PluginDatabaseService } from './services/plugin-database.service.js';

// Migration service (for programmatic access if needed)
export { MigrationsService } from './services/migrations.service.js';

// Migration types (for external consumers)
export type {
    IMigrationMetadata,
    IMigrationStatus,
    IMigrationExecutionResult
} from './migration/types.js';
