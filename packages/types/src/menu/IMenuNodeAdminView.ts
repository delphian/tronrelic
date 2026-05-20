import type { IMenuNode, IMenuNodeWithChildren } from './IMenuNode.js';

/**
 * Origin classification for a menu node.
 *
 * The service knows internally whether a node is database-backed (created via
 * the admin API and persisted to `menu_nodes`) or memory-only (registered by
 * a plugin at runtime), but that distinction does not appear on `IMenuNode`.
 * The admin UI needs it to know whether a delete is durable or whether the
 * row will reappear on the next plugin load.
 *
 * Three states are meaningful to an operator:
 *
 * - `manual` — Persisted in `menu_nodes`. Create/update/delete all survive
 *   restart and there is no plugin to re-register the row.
 * - `plugin` — Memory-only, no admin customization on file. Deleting the row
 *   removes it from the in-memory tree only; the plugin will re-register it
 *   on next startup. Updates can be saved as overrides (which promotes it to
 *   `plugin-overridden`).
 * - `plugin-overridden` — Memory-only AND has a row in `menu_node_overrides`
 *   keyed by `(namespace, url)`. The plugin still owns lifecycle, but the
 *   admin has customized `order` / `label` / `icon` / `description` /
 *   `enabled` and those customizations persist across restarts via the
 *   overrides collection.
 */
export type MenuNodeOrigin = 'manual' | 'plugin' | 'plugin-overridden';

/**
 * Admin-only projection of a menu node that includes the computed `origin`
 * tag. Returned from the admin read path; never sent to anonymous callers.
 *
 * `origin` is derived at read time from the service's `persistedNodeIds` set
 * and the cached set of override keys, so the field is always consistent
 * with the current state of the tree — there is no stored column to drift.
 */
export interface IMenuNodeAdminView extends IMenuNode {
    origin: MenuNodeOrigin;
}

/**
 * Admin-only projection of {@link IMenuNodeWithChildren} carrying `origin`
 * recursively through the tree.
 */
export interface IMenuNodeAdminViewWithChildren extends IMenuNodeWithChildren {
    origin: MenuNodeOrigin;
    children: IMenuNodeAdminViewWithChildren[];
}

/**
 * Admin-only projection of the menu tree.
 *
 * Mirrors `IMenuTree` but with origin-tagged nodes in both `roots` and the
 * flat `all` list. Kept as a separate shape so the public read path cannot
 * accidentally surface origin metadata to unauthenticated callers.
 */
export interface IMenuTreeAdminView {
    roots: IMenuNodeAdminViewWithChildren[];
    all: IMenuNodeAdminView[];
    generatedAt: Date;
}
