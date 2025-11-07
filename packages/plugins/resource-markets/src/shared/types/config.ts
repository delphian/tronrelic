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
     *
     * @default '/resource-markets'
     * @example '/resource-markets'
     * @example '/markets'
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
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: IResourceMarketsConfig = {
    publicPageUrl: '/resource-markets',
    menuLabel: 'Energy Markets',
    menuIcon: 'TrendingUp',
    menuOrder: 15
};
