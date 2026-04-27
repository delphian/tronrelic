import type { IMigration, IMigrationContext } from '@/types';

/**
 * Replace the legacy `requiredRole` string field on menu nodes with the
 * structured gating shape (`allowedIdentityStates`, `requiresGroups`,
 * `requiresAdmin`) introduced alongside the user-groups permission system.
 *
 * **Why this migration exists:**
 * `requiredRole` was a free-form string that nothing in the codebase actually
 * enforced — the JSDoc punted the check to the frontend, and no consumer ever
 * filtered on it. The new gating shape is enforced server-side at read time
 * by `MenuService.getTreeForUser`, which uses cookie-resolved user identity
 * plus `IUserGroupService.isAdmin/isMember` to decide visibility. Keeping the
 * legacy field around alongside the new fields would invite drift and make
 * the operator UI ambiguous.
 *
 * **Mapping rules:**
 * - `requiredRole === 'admin'` → `requiresAdmin: true`. The new admin
 *   predicate routes through `IUserGroupService.isAdmin`, which evaluates any
 *   system-flagged group whose id matches the reserved-admin pattern. This
 *   keeps existing admin-gated menu items working for future seeded admin
 *   tiers (e.g. `super-admin`) without rewriting them.
 * - `requiredRole === <other-non-empty-string>` → `requiresGroups: [value]`.
 *   The string is reused as the literal group id. Operators should review
 *   the resulting groups and either create matching rows in
 *   `module_user_groups` or update the menu item to point at an existing
 *   group.
 * - `requiredRole` empty/missing → no migration needed; the field is dropped
 *   either way as a final cleanup step.
 *
 * **Idempotency:**
 * Each pass runs `$exists: true` filters and only writes to documents that
 * still carry `requiredRole`. Re-running after a successful pass is a no-op.
 *
 * **Rollback:**
 * Not provided. The mapping is lossy (group-id form is a guess for non-'admin'
 * values) and the legacy field had no enforced semantics. Operators recover
 * by editing menu items via the admin UI.
 */
export const migration: IMigration = {
    id: '003_replace_required_role_with_gating_fields',
    description: 'Migrate menu_nodes.requiredRole to allowedIdentityStates/requiresGroups/requiresAdmin gating fields and drop the legacy field.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const collection = context.database.getCollection('menu_nodes');

        // Pass 1: requiredRole === 'admin' becomes requiresAdmin: true.
        const adminResult = await collection.updateMany(
            { requiredRole: 'admin' },
            { $set: { requiresAdmin: true }, $unset: { requiredRole: '' } }
        );
        console.log(`[Migration] Mapped ${adminResult.modifiedCount} admin-gated menu nodes to requiresAdmin: true`);

        // Pass 2: any other non-empty requiredRole becomes a single-element
        // requiresGroups array. We can't pre-create the matching group rows
        // here — the user module owns that collection and operators may want
        // to consolidate ids — so the migration trusts the literal value.
        // Operators see the result in the admin UI's group multi-select and
        // can fix up entries that reference unknown group ids.
        const remaining = await collection.find({
            requiredRole: { $exists: true, $nin: [null, ''] }
        }).toArray();

        let groupMappedCount = 0;
        for (const doc of remaining) {
            const role = (doc as { requiredRole?: string }).requiredRole;
            if (typeof role !== 'string' || role.length === 0) continue;

            await collection.updateOne(
                { _id: doc._id },
                {
                    $set: { requiresGroups: [role] },
                    $unset: { requiredRole: '' }
                }
            );
            groupMappedCount++;
        }
        console.log(`[Migration] Mapped ${groupMappedCount} role-gated menu nodes to requiresGroups arrays`);

        // Pass 3: clear the legacy field on every remaining document. Catches
        // empty strings and stragglers that the typed passes above skipped.
        const cleanupResult = await collection.updateMany(
            { requiredRole: { $exists: true } },
            { $unset: { requiredRole: '' } }
        );
        if (cleanupResult.modifiedCount > 0) {
            console.log(`[Migration] Cleared legacy requiredRole field from ${cleanupResult.modifiedCount} additional documents`);
        }

        console.log('[Migration] Menu node gating migration complete');
    }
};
