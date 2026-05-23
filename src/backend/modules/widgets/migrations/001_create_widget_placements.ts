/**
 * @fileoverview Create the widget-placement collection and its
 * supporting indexes.
 *
 * The new collection persists every widget placement — both
 * plugin-source (created by the legacy widget-service compatibility
 * shim) and operator-source (created by the admin API). Indexes back
 * the three hot read paths: SSR resolution by route, bulk
 * soft-disable by plugin id, and listing within a zone for the admin
 * editor.
 *
 * Idempotent — re-running the migration finds the indexes already
 * present and short-circuits to a no-op.
 *
 * @module backend/modules/widgets/migrations/001_create_widget_placements
 */

import type { IMigration, IMigrationContext } from '@/types';

export const migration: IMigration = {
    id: '001_create_widget_placements',
    description:
        'Create module_widgets_placements collection with indexes for route resolution, ' +
        'plugin-scoped soft-disable, and zone-ordered admin listing.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const collection = 'module_widgets_placements';

        // Read path: SSR resolver queries `{ enabled: true }` and
        // sorts by `(zoneId, order)`. The compound index covers both.
        await context.database.createIndex(
            collection,
            { enabled: 1, zoneId: 1, order: 1 },
            { name: 'enabled_zone_order' }
        );

        // Bulk write path: `softDisableForPlugin` filters
        // `{ pluginId, source, enabled }` to flip enabled flags. The
        // compound index makes the filter selective without scanning
        // operator placements.
        await context.database.createIndex(
            collection,
            { pluginId: 1, source: 1, enabled: 1 },
            { name: 'plugin_source_enabled' }
        );

        // Upsert filter for `ensurePluginPlacement`: unique on
        // (typeId, pluginId) so the disable→enable cycle finds the
        // existing row instead of creating a duplicate. Sparse so
        // operator placements (which omit `pluginId`) are excluded
        // from the unique constraint and can share a `typeId` freely.
        await context.database.createIndex(
            collection,
            { typeId: 1, pluginId: 1 },
            {
                name: 'plugin_placement_identity',
                unique: true,
                sparse: true
            }
        );

        // Listing index: admin UI lists placements by zone.
        await context.database.createIndex(
            collection,
            { zoneId: 1, order: 1 },
            { name: 'zone_order' }
        );
    }
};
