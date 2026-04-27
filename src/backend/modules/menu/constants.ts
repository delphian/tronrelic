/**
 * Shared constants for the menu module.
 *
 * The admin surface lives as a subtree of the `main` namespace rooted at
 * the System container, gated per-user via `requiresAdmin`. There is no
 * separate admin namespace — read protection is per-node, applied by
 * `MenuService.getTreeForUser` against the cookie-resolved user.
 */

/**
 * Stable id of the System container in the `main` namespace.
 *
 * The System container is the top-level menu node under which every admin
 * surface lives — module admin entries, the dynamic Plugins dropdown, the
 * Logout link. Its id is a hard-coded string (rather than a generated
 * ObjectId) so the seed in `MenuModule.run()` and the auto-`requiresAdmin`
 * walk-up in `MenuService.create`/`update` can reference the same
 * identifier without a lookup. Modules and plugins that want to register
 * an admin item set `parent: 'main:system'` directly.
 */
export const MAIN_SYSTEM_CONTAINER_ID = 'main:system';

/**
 * Reserved admin namespaces — currently empty.
 *
 * Retained as a typed extension point. The HTTP controller and the
 * WebSocket broadcaster both reference this set, so any future namespace
 * added here is gated by both surfaces in lock-step. The `system`
 * namespace used to live here; its contents now live under the System
 * container in `main`, gated per-node via `requiresAdmin`.
 */
export const ADMIN_NAMESPACES: ReadonlySet<string> = new Set();
