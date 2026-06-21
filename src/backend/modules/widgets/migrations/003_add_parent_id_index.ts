/**
 * @fileoverview Add the `parentId` index to the widget-placement
 * collection.
 *
 * Single-level widget grouping lets an operator nest placements inside a
 * `core:layout-group` container by pointing each child's `parentId` at
 * the container row. Two hot paths query that field: the SSR resolver
 * groups children by `parentId` to assemble the render tree, and the
 * admin "delete container" path detaches every child of a parent at
 * once. A sparse index keeps both selective without scanning the (far
 * more numerous) directly-zoned rows that omit `parentId` entirely.
 *
 * The collection already exists in production (migration 001), so the
 * new index ships as its own forward migration rather than schema
 * creation. `createIndex` is idempotent — re-running finds the index
 * present and short-circuits.
 *
 * @module backend/modules/widgets/migrations/003_add_parent_id_index
 */

import type { IMigration, IMigrationContext } from '@/types';

export const migration: IMigration = {
    id: '003_add_parent_id_index',
    description:
        'Add a sparse index on module_widgets_placements.parentId for ' +
        'SSR child grouping and container-delete detachment.',
    dependencies: ['module:widgets:001_create_widget_placements'],

    /**
     * Create the sparse `parentId` index. Sparse so only the rows that
     * actually nest (children of a layout group) are indexed; the bulk
     * of placements carry no `parentId` and stay out of the index.
     *
     * @param context - Migration context exposing the database service.
     */
    async up(context: IMigrationContext): Promise<void> {
        await context.database.createIndex(
            'module_widgets_placements',
            { parentId: 1 },
            { name: 'placement_parent', sparse: true }
        );

        return;
    }
};
