import { ObjectId } from 'mongodb';
import type { IMigration, IMigrationContext } from '@/types';
import { MAIN_SYSTEM_CONTAINER_ID } from '../constants.js';

/**
 * Collapse the legacy `system` namespace into the `main` namespace under
 * the System container.
 *
 * **Why this migration exists:**
 * The admin surface used to live in a separate `system` namespace
 * registered top-level by every admin-bearing module. That namespace was
 * publicly readable (the `ADMIN_NAMESPACES` set was empty) and protected
 * only by the `/system/*` route convention. Admin items now live as a
 * subtree of `main` rooted at `MAIN_SYSTEM_CONTAINER_ID` and gated
 * per-user via `requiresAdmin`. Module and plugin code on every boot
 * recreates the memory-only nodes against the new shape, but two things
 * survive across boots and need rewriting:
 *   1. `menu_nodes` — admin-created persisted nodes (rare in practice
 *      but possible if an operator added entries through the menu admin
 *      UI). Their namespace must change from `system` to `main` and they
 *      need a `parent` pointing at the System container.
 *   2. `menu_node_overrides` — admin customizations (rename, re-icon,
 *      reorder, disable) of memory-only nodes. Keyed by
 *      `(namespace, url)`. URLs don't change, so flipping the namespace
 *      field re-aligns the overrides with the now-`main`-namespace
 *      registrations and customizations carry through the move.
 *
 * **Idempotency:**
 * Both passes filter on `namespace: 'system'`, so re-running after a
 * successful pass is a no-op. The container parent assignment uses the
 * fixed sentinel ObjectId `MAIN_SYSTEM_CONTAINER_ID` directly — no
 * lookup, no race.
 *
 * **Rollback:**
 * Not provided. The reverse mapping is unambiguous (flip namespace back,
 * clear parent) but the application code has already moved on, so a
 * rollback would orphan the data against running services.
 */
export const migration: IMigration = {
    id: '004_merge_system_namespace_into_main',
    description: 'Move legacy system-namespace menu nodes and their overrides into main, parented under the System container.',
    dependencies: ['module:menu:003_replace_required_role_with_gating_fields'],

    async up(context: IMigrationContext): Promise<void> {
        const nodes = context.database.getCollection('menu_nodes');
        const overrides = context.database.getCollection('menu_node_overrides');

        // Pass 1: persisted admin entries. Set parent to the System
        // container's sentinel ObjectId and flip namespace. Top-level
        // entries (parent: null) become children of the container;
        // nested entries keep their existing parent reference because
        // that parent moves in the same pass. We wrap the sentinel in
        // `new ObjectId(...)` so the on-disk shape matches the
        // `IMenuNodeDocument.parent: ObjectId | null` contract that the
        // service's persistence path expects on subsequent reads/writes.
        const systemContainerOid = new ObjectId(MAIN_SYSTEM_CONTAINER_ID);
        const nodeResult = await nodes.updateMany(
            { namespace: 'system', parent: null },
            { $set: { namespace: 'main', parent: systemContainerOid } }
        );
        const nestedResult = await nodes.updateMany(
            { namespace: 'system', parent: { $ne: null } },
            { $set: { namespace: 'main' } }
        );
        console.log(`[Migration] Reparented ${nodeResult.modifiedCount} top-level system menu nodes under the System container`);
        console.log(`[Migration] Renamespaced ${nestedResult.modifiedCount} nested system menu nodes to main`);

        // Pass 2: overrides. Keyed by (namespace, url); URLs don't
        // change so just flipping namespace re-aligns customizations.
        const overrideResult = await overrides.updateMany(
            { namespace: 'system' },
            { $set: { namespace: 'main' } }
        );
        console.log(`[Migration] Migrated ${overrideResult.modifiedCount} menu node overrides from system to main`);

        console.log('[Migration] System-to-main namespace merge complete');
    }
};
