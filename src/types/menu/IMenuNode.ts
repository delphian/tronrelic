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
     * Optional navigation URL or route path.
     * If omitted, the node acts as a non-clickable container/category.
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
     * Optional access control role or permission requirement.
     * Frontend can check this before rendering or enabling navigation.
     * Examples: 'admin', 'user', 'premium'
     */
    requiredRole?: string;

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
