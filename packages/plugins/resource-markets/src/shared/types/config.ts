/**
 * Resource Markets plugin configuration.
 *
 * Stored in database and used to configure plugin behavior including
 * menu registration and public page routing.
 */
export interface IResourceMarketsConfig {
    /**
     * Public page URL path where the markets comparison page will be accessible.
     *
     * This URL is used for menu registration and frontend routing.
     * Must start with `/plugins/resource-markets/` to maintain plugin namespace isolation.
     *
     * @default '/plugins/resource-markets/markets'
     * @example '/plugins/resource-markets/markets'
     * @example '/plugins/resource-markets/energy-comparison'
     */
    publicPageUrl: string;

    /**
     * Menu item label displayed in navigation.
     *
     * @default 'Energy Markets'
     */
    menuLabel: string;

    /**
     * Menu item icon from lucide-react.
     *
     * @default 'TrendingUp'
     */
    menuIcon: string;

    /**
     * Menu item display order.
     *
     * @default 15
     */
    menuOrder: number;

    /**
     * Menu item ID (stored after creation for easy updates).
     *
     * Internal field used to track the menu item ID for updates.
     * Set automatically during plugin init().
     */
    menuItemId?: string;
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: IResourceMarketsConfig = {
    publicPageUrl: '/plugins/resource-markets/markets',
    menuLabel: 'Energy Markets',
    menuIcon: 'TrendingUp',
    menuOrder: 15
};
