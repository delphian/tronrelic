/**
 * Menu item configuration for plugin navigation.
 *
 * Defines navigation menu items provided by a plugin. Each plugin can register
 * one or more menu items that appear in the main navigation, complete with
 * routing, icons, ordering, and optional categorization for menu organization.
 */
export interface IMenuItemConfig {
    /** Display label for the menu item */
    label: string;
    /** URL path (e.g., '/whales', '/my-plugin/dashboard') */
    href: string;
    /** Icon name from Lucide React */
    icon?: string;
    /** Optional category for grouping in menu (e.g., 'admin', 'analytics') */
    category?: string;
    /** Sort order within category (lower numbers appear first) */
    order?: number;
    /** Whether this item requires admin privileges */
    adminOnly?: boolean;
    /** Whether this item should be highlighted/featured */
    featured?: boolean;
}
