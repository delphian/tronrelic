/**
 * Menu module type definitions.
 *
 * Frontend-specific types for menu configuration and Priority+ navigation.
 * These types mirror the backend IMenuNamespaceConfig but are duplicated here
 * to avoid build-time dependencies between frontend and backend packages.
 */

/**
 * Menu namespace configuration structure.
 *
 * Matches IMenuNamespaceConfig from @tronrelic/types. Contains UI rendering
 * preferences that control how a menu namespace is displayed.
 */
export interface IMenuNamespaceConfig {
    /**
     * Database-assigned unique identifier (undefined when using defaults).
     */
    _id?: string;

    /**
     * Menu namespace this configuration applies to (e.g., 'main', 'system').
     */
    namespace: string;

    /**
     * Priority+ overflow navigation settings.
     */
    overflow?: {
        /**
         * Whether overflow handling is enabled for this namespace.
         * When true, items that don't fit are moved to a "More" dropdown.
         */
        enabled: boolean;

        /**
         * Minimum visible items before collapsing all to overflow.
         * Prevents orphan navigation items (e.g., 1 item + "More" button).
         */
        collapseAtCount?: number;
    };

    /**
     * Icon display settings for menu items.
     */
    icons?: {
        /**
         * Whether icons are displayed.
         */
        enabled: boolean;

        /**
         * Position of icon relative to label text.
         */
        position?: 'left' | 'right' | 'top';
    };

    /**
     * Layout and structural settings.
     */
    layout?: {
        /**
         * Direction menu items flow.
         */
        orientation: 'horizontal' | 'vertical';

        /**
         * Maximum number of items before overflow.
         */
        maxItems?: number;
    };

    /**
     * Visual styling hints (optional).
     */
    styling?: {
        /**
         * Use compact spacing and smaller text.
         */
        compact?: boolean;

        /**
         * Whether to show text labels (icon-only mode when false).
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

/**
 * Hook return value with configuration and loading state.
 */
export interface IUseMenuConfigResult extends IMenuNamespaceConfig {
    /**
     * Whether the configuration is currently being fetched.
     * True during initial load, false once data arrives or fails.
     */
    loading: boolean;
}
