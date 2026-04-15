/**
 * Configuration options for a menu namespace.
 *
 * Stores UI rendering preferences that control how a menu namespace is displayed,
 * including overflow behavior (Priority+ navigation), icon display settings, layout
 * orientation, and styling hints. Each namespace can have independent configuration,
 * allowing different menus (main, footer, admin-sidebar) to have unique behaviors.
 *
 * When no configuration is stored for a namespace, the menu service provides sensible
 * defaults (see MenuService.getNamespaceConfig).
 */
export interface IMenuNamespaceConfig {
    /**
     * Database-assigned unique identifier.
     *
     * String representation of MongoDB ObjectId. Undefined when creating new configs.
     */
    _id?: string;

    /**
     * Menu namespace this configuration applies to.
     *
     * Must match the namespace of menu nodes (e.g., 'main', 'footer', 'admin-sidebar').
     * Each namespace can have at most one configuration document.
     */
    namespace: string;

    /**
     * Priority+ overflow navigation settings.
     *
     * Controls how the menu handles overflow when items don't fit in available space.
     * Uses IntersectionObserver to automatically detect which items overflow and moves
     * them behind a "More" button. This is more intelligent than fixed breakpoints
     * because it adapts to actual content width rather than arbitrary pixel values.
     */
    overflow?: {
        /**
         * Whether overflow handling is enabled for this namespace.
         *
         * When true, items that don't fit are moved to a "More" dropdown.
         * When false, all items are always visible (may cause horizontal scroll).
         * Defaults to true.
         */
        enabled: boolean;

        /**
         * Minimum visible items before collapsing all to overflow.
         *
         * When the number of visible items falls below this threshold, all items
         * collapse into the overflow menu to avoid "orphan" navigation items.
         * This prevents awkward states like showing only 1-2 items with a "More" button.
         *
         * Common values:
         * - 2 - Collapse when only 1 item would be visible
         * - 3 - Collapse when only 1-2 items would be visible
         * - undefined - Never collapse all (always show as many as fit)
         */
        collapseAtCount?: number;
    };

    /**
     * Icon display settings for menu items.
     *
     * Controls whether icons are shown and where they appear relative to labels.
     * Icons use lucide-react icon names from IMenuNode.icon property.
     */
    icons?: {
        /**
         * Whether icons are displayed for menu items that have them.
         *
         * When false, only text labels are shown even if menu nodes specify icons.
         */
        enabled: boolean;

        /**
         * Position of icon relative to label text.
         *
         * - 'left' - Icon before label (most common, e.g., [icon] Label)
         * - 'right' - Icon after label (e.g., Label [icon])
         * - 'top' - Icon above label in vertical stack (useful for compact layouts)
         */
        position?: 'left' | 'right' | 'top';
    };

    /**
     * Layout and structural settings.
     *
     * Controls menu orientation, item limits, and overflow behavior.
     */
    layout?: {
        /**
         * Direction menu items flow.
         *
         * - 'horizontal' - Items arranged left-to-right (typical top navigation)
         * - 'vertical' - Items stacked top-to-bottom (typical sidebar navigation)
         */
        orientation: 'horizontal' | 'vertical';

        /**
         * Maximum number of items to display before triggering overflow behavior.
         *
         * When a menu has more items than this limit, additional items can be hidden
         * behind a "More" button or automatically collapsed. Undefined means no limit.
         *
         * Common values:
         * - 5-7 for horizontal top navigation
         * - 10-15 for vertical sidebars
         * - Undefined for footers or menus without overflow concerns
         */
        maxItems?: number;
    };

    /**
     * Visual styling hints (optional).
     *
     * Provides rendering hints to frontend components. These are suggestions rather
     * than strict requirements, allowing themes to interpret them differently.
     */
    styling?: {
        /**
         * Use compact spacing and smaller text.
         *
         * When true, menu items render with tighter padding and smaller font sizes,
         * fitting more content in less space. Useful for dense admin interfaces.
         */
        compact?: boolean;

        /**
         * Whether to show text labels for menu items.
         *
         * When false, only icons are shown (icon-only mode). Requires icons.enabled
         * to also be true. Useful for narrow sidebars where text would wrap awkwardly.
         */
        showLabels?: boolean;
    };

    /**
     * Timestamp when configuration was created.
     */
    createdAt?: Date;

    /**
     * Timestamp when configuration was last updated.
     */
    updatedAt?: Date;
}
