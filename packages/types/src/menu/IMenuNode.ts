import type { UserIdentityState } from '../user/IUserIdentityState.js';

/**
 * Menu node interface representing a single item in the menu tree.
 *
 * Each node can be either a navigable menu item (with url/route) or a container
 * category (without url/route). Nodes support unlimited nesting depth through
 * the parent field, which references another node's ID.
 */
export interface IMenuNode {
    /**
     * Unique identifier for this menu node.
     * Generated automatically by MongoDB as ObjectId string.
     */
    _id?: string;

    /**
     * Menu namespace for isolating multiple independent menu trees.
     *
     * Namespaces allow the system to maintain separate menu hierarchies for different
     * contexts (e.g., 'main' for primary navigation, 'footer' for footer links,
     * 'admin-sidebar' for admin panel navigation, 'mobile' for mobile-specific menus).
     *
     * All nodes within a namespace form an independent tree structure. Parent-child
     * relationships are scoped to the namespace—a node cannot reference a parent in
     * a different namespace.
     *
     * Common namespace conventions:
     * - 'main' - Primary site navigation (default)
     * - 'footer' - Footer navigation links
     * - 'admin-sidebar' - Admin panel sidebar
     * - 'mobile' - Mobile-specific navigation
     * - 'user-profile' - User profile dropdown menu
     *
     * Defaults to 'main' for backward compatibility with existing single-tree behavior.
     *
     * @example
     * ```typescript
     * // Main navigation node
     * { namespace: 'main', label: 'Home', url: '/', parent: null }
     *
     * // Footer navigation node (separate tree)
     * { namespace: 'footer', label: 'Privacy Policy', url: '/privacy', parent: null }
     * ```
     */
    namespace?: string;

    /**
     * Display label for the menu item.
     * Shown in navigation UI and breadcrumbs.
     */
    label: string;

    /**
     * Optional short description of the menu item's purpose.
     * Used in auto-generated category landing pages as card subtitle text.
     */
    description?: string;

    /**
     * Navigation URL or route path.
     * Container nodes that omit this field receive an auto-derived URL
     * based on the slugified label (e.g., label "Tools" → url "/tools").
     * Examples: '/dashboard', '/plugins/whale-alerts', 'https://external.com'
     */
    url?: string;

    /**
     * Optional icon identifier for visual representation.
     * The frontend determines how to render this (e.g., lucide-react icon name).
     * Examples: 'Home', 'Settings', 'AlertCircle'
     */
    icon?: string;

    /**
     * Sort order within the same parent level.
     * Lower numbers appear first. Items with same order are sorted by label.
     */
    order: number;

    /**
     * Parent node ID for hierarchical organization.
     * Null or undefined indicates a root-level node.
     */
    parent?: string | null;

    /**
     * Visibility flag controlling whether the node appears in navigation.
     * Disabled nodes remain in the tree but are hidden from users.
     */
    enabled: boolean;

    /**
     * Allow-list of identity states that may see the node.
     *
     * Backend filters menu reads by checking that the cookie-resolved user's
     * `identityState` is in this set. `undefined` means the node has no
     * identity-state gate (visible to anonymous, registered, and verified
     * visitors alike). An empty array is rejected at write time — that would
     * hide the node from every visitor, which is what `enabled: false`
     * already expresses cleanly.
     *
     * Examples:
     * - `['anonymous']` — visible only to UUID-only visitors (e.g. signup CTA)
     * - `['registered', 'verified']` — visible only after a wallet is linked
     * - `['anonymous', 'verified']` — visible to UUID-only and signed visitors,
     *   hidden from the unsigned-wallet middle state
     */
    allowedIdentityStates?: UserIdentityState[];

    /**
     * Required group memberships for visibility (OR-of-membership).
     *
     * The user must be a member of at least one listed group for the node to
     * be visible. Group ids reference rows in the `module_user_groups`
     * collection managed by the user module. `undefined` or `[]` means no
     * group requirement. The set of available groups is admin-defined and
     * fetched via `GET /api/admin/users/groups`.
     */
    requiresGroups?: string[];

    /**
     * Restrict the node to admin users.
     *
     * When true, the node is only visible to users for whom
     * `IUserGroupService.isAdmin(userId)` returns true — i.e. members of any
     * system-flagged group whose id matches the reserved-admin pattern. This
     * is a separate flag from `requiresGroups` so that future seeded admin
     * tiers (e.g. `super-admin`) automatically grant access without rewriting
     * gated nodes.
     */
    requiresAdmin?: boolean;

    /**
     * Timestamp when the node was created.
     */
    createdAt?: Date;

    /**
     * Timestamp when the node was last modified.
     */
    updatedAt?: Date;
}

/**
 * Menu node with children array for tree representation.
 *
 * Extends IMenuNode with a children array, allowing recursive rendering
 * of the entire menu hierarchy.
 */
export interface IMenuNodeWithChildren extends IMenuNode {
    /**
     * Child nodes nested under this node.
     * Empty array if this is a leaf node.
     */
    children: IMenuNodeWithChildren[];
}
