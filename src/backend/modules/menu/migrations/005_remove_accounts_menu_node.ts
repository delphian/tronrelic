import type { IMigration, IMigrationContext } from '@/types';

/**
 * Remove the persisted `Accounts` (`/accounts`) main-namespace menu node and
 * any admin override keyed to it.
 *
 * **Why this migration exists:**
 * The public accounts feature — the `/accounts` landing page, the
 * `/accounts/[address]` explorer, and their backing module — was deleted, so
 * the route now 404s. The node itself was never registered in code; its only
 * producer was `scripts/seed-main-menu.js`, which inserted an enabled
 * `{ namespace: 'main', url: '/accounts' }` row straight into `menu_nodes`.
 * `MenuService.initialize()` loads every `menu_nodes` row into the in-memory
 * nav tree on each boot and never prunes them, so any environment that ran that
 * seed keeps rendering a main-nav link to the now-missing route. Removing the
 * seed entry stops future seeding but cannot clear a row already persisted in a
 * deployed database — only this migration can.
 *
 * **Idempotency:**
 * Both passes are `deleteMany` filtered on `(namespace: 'main', url: '/accounts')`,
 * so a second run after a successful pass deletes nothing and is a no-op — no
 * lookups, no races. Environments that never seeded the node simply match zero
 * rows, which is the expected outcome there, not an error.
 *
 * **Orphan safety:**
 * The seed created the node with `parent: null` and `children: []`, and no code
 * references its (seed-generated) id as a parent, so deleting it cannot orphan a
 * subtree. Menu deletes do not cascade by design, but there is nothing beneath
 * this leaf to cascade to.
 *
 * **Rollback:**
 * Not provided. The route and its pages no longer exist, so recreating the node
 * would only restore the broken link.
 */
export const migration: IMigration = {
    id: '005_remove_accounts_menu_node',
    description: 'Delete the persisted Accounts (/accounts) main-namespace menu node and its override after the public accounts feature was removed.',
    dependencies: ['module:menu:004_merge_system_namespace_into_main'],

    async up(context: IMigrationContext): Promise<void> {
        const nodes = context.database.getCollection('menu_nodes');
        const overrides = context.database.getCollection('menu_node_overrides');

        const nodeResult = await nodes.deleteMany({ namespace: 'main', url: '/accounts' });
        console.log(`[Migration] Removed ${nodeResult.deletedCount} persisted /accounts menu node(s)`);

        const overrideResult = await overrides.deleteMany({ namespace: 'main', url: '/accounts' });
        console.log(`[Migration] Removed ${overrideResult.deletedCount} /accounts menu node override(s)`);

        console.log('[Migration] Accounts menu node removal complete');
    }
};
