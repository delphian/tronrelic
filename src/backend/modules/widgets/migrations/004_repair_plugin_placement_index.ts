/**
 * @fileoverview Repair the plugin-placement uniqueness index so operators
 * can place the same widget type more than once.
 *
 * Migration 001 created `plugin_placement_identity` on `(typeId, pluginId)`
 * as a `unique` + `sparse` index, intending to constrain only plugin-source
 * rows (which carry a `pluginId`) while leaving operator-source rows (which
 * omit it) unconstrained. That intent is wrong for a *compound* sparse
 * index: MongoDB indexes a document when it contains *at least one* of the
 * keyed fields, and operator rows always carry `typeId`. So every operator
 * row is indexed with `pluginId` recorded as null, and a second operator
 * placement of the same widget type — anywhere, in any zone — collides on
 * `(typeId, null)` and is rejected with a duplicate-key error (E11000).
 *
 * The fix swaps the sparse index for a `partialFilterExpression` that only
 * indexes rows where `pluginId` actually exists. Plugin-row atomicity (the
 * `ensurePluginPlacement` upsert that relies on a single row per
 * `(typeId, pluginId)`) is preserved, while operator rows fall entirely
 * outside the index and may repeat a `typeId` freely. The index keeps the
 * same name and key, so it must be dropped and recreated — index options
 * cannot be altered in place.
 *
 * Idempotent: it drops `plugin_placement_identity` only when present (so a
 * retry after a mid-migration failure does not throw `IndexNotFound`) and
 * recreates it from scratch, leaving the collection with exactly one
 * correctly-scoped uniqueness index regardless of which state the previous
 * attempt left behind.
 *
 * @module backend/modules/widgets/migrations/004_repair_plugin_placement_index
 */

import type { IMigration, IMigrationContext } from '@/types';

/** Physical collection name, matching migration 001 and the placement service. */
const COLLECTION = 'module_widgets_placements';

/** Name of the uniqueness index being repaired; reused so no stale index survives. */
const INDEX_NAME = 'plugin_placement_identity';

export const migration: IMigration = {
    id: '004_repair_plugin_placement_index',
    description:
        'Replace the sparse unique (typeId, pluginId) index on ' +
        'module_widgets_placements with a partial index scoped to ' +
        'pluginId-bearing rows, so operators can place a widget type more ' +
        'than once.',
    dependencies: ['module:widgets:001_create_widget_placements'],

    /**
     * Drop the mis-scoped sparse index and recreate it as a partial unique
     * index. The drop is guarded on presence so a retry after a partial
     * failure is safe; the create uses `partialFilterExpression` (absent
     * from the `IDatabaseService.createIndex` option surface), so the
     * migration reaches the native driver collection directly.
     *
     * @param context - Migration context exposing the database service.
     */
    async up(context: IMigrationContext): Promise<void> {
        const collection = context.database.getCollection(COLLECTION);

        // Drop only when present: a retry that already dropped (but had not
        // yet recreated) the index must not throw IndexNotFound.
        const existing = await collection.listIndexes().toArray();
        const hasIndex = existing.some(index => index.name === INDEX_NAME);
        if (hasIndex) {
            await collection.dropIndex(INDEX_NAME);
        }

        // Partial filter indexes only plugin-source rows (those with a
        // pluginId), so the unique constraint guards the ensurePluginPlacement
        // upsert without ever touching operator rows.
        await collection.createIndex(
            { typeId: 1, pluginId: 1 },
            {
                name: INDEX_NAME,
                unique: true,
                partialFilterExpression: { pluginId: { $exists: true } }
            }
        );

        return;
    }
};
