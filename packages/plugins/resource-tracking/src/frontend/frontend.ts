import { definePlugin } from '@tronrelic/types';
import { resourceTrackingManifest } from '../manifest';
import { ResourceTrackingPage } from './ResourceTrackingPage';
import { ResourceTrackingSettingsPage } from './ResourceTrackingSettingsPage';
import './styles.css';

/**
 * Resource Explorer frontend plugin definition.
 *
 * This plugin provides:
 * - Resource delegation trends dashboard with time-series charts
 * - Time period selector for data visualization (1d, 7d, 30d, 6m)
 * - Line toggles for filtering energy vs bandwidth flows
 * - Admin settings page for retention policy configuration
 * - Navigation menu item for resource explorer
 * - Scoped CSS styles for plugin-specific components
 */
export const resourceTrackingFrontendPlugin = definePlugin({
    manifest: resourceTrackingManifest,

    // No background component needed (no real-time WebSocket features yet)
    component: undefined,

    // Register navigation menu item
    menuItems: [
        {
            label: 'Resources',
            href: '/resources',
            icon: 'Activity',
            category: 'analytics',
            order: 40
        }
    ],

    // Register main resource tracking page
    pages: [
        {
            path: '/resources',
            component: ResourceTrackingPage,
            title: 'Resource Explorer - TronRelic',
            description: 'Monitor TRON energy and bandwidth delegation trends'
        }
    ],

    // Register admin settings page
    adminPages: [
        {
            path: '/system/plugins/resource-tracking/settings',
            component: ResourceTrackingSettingsPage,
            title: 'Resource Explorer Settings - TronRelic',
            description: 'Configure data retention and purge frequency for resource tracking'
        }
    ]
});
