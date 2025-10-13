import { definePlugin } from '@tronrelic/types';
import { whaleAlertsManifest } from '../manifest';
import { WhaleAlertsToastHandler } from './WhaleAlertsToastHandler';
import { WhaleIntelligencePage } from './WhaleIntelligencePage';
import { WhaleAdminPage } from './system/pages/WhaleAdminPage';
import './styles.css';
import './system/system-styles.css';

/**
 * Expose the whale alerts frontend plugin definition.
 *
 * This plugin provides:
 * - Real-time whale transaction toast notifications
 * - Whale Intelligence dashboard page with analytics
 * - Navigation menu item for whale tracking
 * - Scoped CSS styles for whale-specific components
 */
export const whaleAlertsFrontendPlugin = definePlugin({
    manifest: whaleAlertsManifest,
    component: WhaleAlertsToastHandler,

    // Register navigation menu item
    menuItems: [
        {
            label: 'Whales',
            href: '/whales',
            icon: 'Fish',
            category: 'intelligence',
            order: 30
        }
    ],

    // Register whale dashboard page
    pages: [
        {
            path: '/whales',
            component: WhaleIntelligencePage,
            title: 'Whale Intelligence - TronRelic',
            description: 'Monitor high-value TRX transfers and whale activity'
        }
    ],

    // Register admin pages
    adminPages: [
        {
            path: '/system/plugins/whale-alerts/settings',
            component: WhaleAdminPage,
            title: 'Whale Alerts Settings - TronRelic',
            description: 'Configure whale detection thresholds and notification preferences'
        }
    ]
});
