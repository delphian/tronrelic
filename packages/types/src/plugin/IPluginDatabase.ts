import type { IDatabaseService } from '../database/IDatabaseService.js';

/**
 * @deprecated Use IDatabaseService instead.
 *
 * This type alias exists for backward compatibility with existing plugin code.
 * New code should import and use IDatabaseService directly.
 *
 * Migration guide:
 * ```typescript
 * // Old (still works)
 * import type { IPluginDatabase } from '@tronrelic/types';
 * const db: IPluginDatabase = context.database;
 *
 * // New (preferred)
 * import type { IDatabaseService } from '@tronrelic/types';
 * const db: IDatabaseService = context.database;
 * ```
 *
 * Why this changed:
 * The database abstraction is no longer plugin-specific. Core services and plugins
 * now share the same interface, with plugins receiving automatic collection name
 * prefixing through the PluginDatabaseService implementation.
 */
export type IPluginDatabase = IDatabaseService;

// Re-export for convenience (allows continued use of old import path)
export type { IDatabaseService } from '../database/IDatabaseService.js';
