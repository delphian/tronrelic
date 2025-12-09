import dynamic from 'next/dynamic';
import { definePlugin } from '@tronrelic/types';
import { whaleAlertsManifest } from '../manifest';
import { WhaleAlertsToastHandler } from './WhaleAlertsToastHandler';
import './styles.css';
import './system/system-styles.css';

/**
 * Lazily loaded page components.
 *
 * Using next/dynamic ensures CSS modules are code-split and only load when
 * the page is actually visited. Without this, static imports cause plugin CSS
 * to be bundled in shared chunks that load on every page (including homepage).
 */
const WhaleIntelligencePage = dynamic(() =>
    import('./WhaleIntelligencePage').then(m => m.WhaleIntelligencePage)
);

const WhaleAdminPage = dynamic(() =>
    import('./system/pages/WhaleAdminPage').then(m => m.WhaleAdminPage)
);

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
