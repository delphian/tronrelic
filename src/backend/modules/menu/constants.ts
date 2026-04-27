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
 * Logout link. The id is a fixed sentinel chosen at design time (rather
 * than a generated ObjectId) so the seed in `MenuModule.run()` and the
 * auto-`requiresAdmin` walk-up in `MenuService.create`/`update` reference
 * the same identifier without a runtime lookup.
 *
 * The sentinel is the 24-hex string `'000000000000000000000001'` because
 * the menu controller validates `parent` and `:id` path params with
 * `OBJECT_ID_REGEX` (`^[a-f0-9]{24}$`), and the persistence layer wraps
 * `parent` in `new ObjectId(...)` for `menu_nodes` writes. Using a
 * non-hex format (e.g. `'main:system'`) would force every admin CRUD
 * endpoint, the persistence path, and `IMenuNodeDocument.parent`'s type
 * to special-case the container id — that special-casing is exactly the
 * kind of cross-layer invariant that drifts and breaks silently. A real
 * generated ObjectId for the same value is astronomically unlikely
 * (would need a node clock at the Unix epoch with leading machine and
 * counter bytes also zero), so collision risk is nil.
 *
 * Modules and plugins parenting under System write
 * `parent: MAIN_SYSTEM_CONTAINER_ID`.
 */
export const MAIN_SYSTEM_CONTAINER_ID = '000000000000000000000001';

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
