import { definePlugin } from '@tronrelic/types';
import { resourceMarketsManifest } from '../manifest';
import { MarketsPage } from './pages/MarketsPage';
import { ResourceMarketsAdminPage } from './system/pages/ResourceMarketsAdminPage';

/**
 * Resource Markets frontend plugin.
 *
 * This plugin provides UI components for comparing TRON energy market pricing
 * across multiple platforms. It includes:
 *
 * - Energy Markets dashboard page with real-time comparison table
 * - Market statistics and trend visualization
 * - Expandable row details with historical pricing data
 * - Admin settings page for configuring public page URL and menu settings
 * - Market platform monitoring and health tracking
 *
 * **Note:** Navigation menu items are registered by the backend during init()
 * using the configurable settings from the admin page. The frontend no longer
 * statically defines menu items to ensure consistency with backend configuration.
 */
export const resourceMarketsFrontendPlugin = definePlugin({
    manifest: resourceMarketsManifest,

    // Menu items registered by backend based on configuration
    // (no menuItems array - backend controls this via IMenuService)

    pages: [
        {
            path: '/plugins/resource-markets/markets',
            component: MarketsPage,
            title: 'Energy Markets - TronRelic'
        }
    ],

    adminPages: [
        {
            path: '/system/plugins/resource-markets/settings',
            component: ResourceMarketsAdminPage,
            title: 'Resource Markets Settings - TronRelic',
            description: 'Configure public page URL, menu settings, and monitor market platform health'
        }
    ]
});
