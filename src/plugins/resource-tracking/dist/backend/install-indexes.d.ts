import type { IPluginContext } from '@/types';
/**
 * Create MongoDB indexes for resource tracking collections during plugin installation.
 *
 * Indexes are created once when the plugin is first installed to optimize query
 * performance for delegation transaction lookups and summation data retrieval.
 * The install hook ensures these indexes exist before any data is written.
 *
 * @param context - Plugin context with database service for index creation
 */
export declare function createResourceTrackingIndexes(context: IPluginContext): Promise<void>;
//# sourceMappingURL=install-indexes.d.ts.map