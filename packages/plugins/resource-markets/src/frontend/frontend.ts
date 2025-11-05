import { definePlugin } from '@tronrelic/types';
import { resourceMarketsManifest } from '../manifest';
import { MarketsPage } from './pages/MarketsPage';

/**
 * Resource Markets frontend plugin.
 *
 * This plugin provides UI components for comparing TRON energy market pricing
 * across multiple platforms. It includes:
 *
 * - Energy Markets dashboard page with real-time comparison table
 * - Market statistics and trend visualization
 * - Expandable row details with historical pricing data
 * - Navigation menu integration
 *
 * Phase 4: Complete implementation with pages, components, and API integration
 */
export const resourceMarketsFrontendPlugin = definePlugin({
    manifest: resourceMarketsManifest,

    menuItems: [
        {
            label: 'Energy Markets',
            href: '/plugins/resource-markets/markets',
            icon: 'TrendingUp',
            order: 15
        }
    ],

    pages: [
        {
            path: '/plugins/resource-markets/markets',
            component: MarketsPage,
            title: 'Energy Markets - TronRelic'
        }
    ]
});
