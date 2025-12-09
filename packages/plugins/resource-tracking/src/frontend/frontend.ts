import dynamic from 'next/dynamic';
import { definePlugin } from '@tronrelic/types';
import { resourceTrackingManifest } from '../manifest';
import './styles.css';

/**
 * Lazily loaded page components.
 *
 * Using next/dynamic ensures CSS modules are code-split and only load when
 * the page is actually visited. Without this, static imports cause plugin CSS
 * to be bundled in shared chunks that load on every page (including homepage).
 */
const ResourceTrackingPage = dynamic(() =>
    import('./ResourceTrackingPage').then(m => m.ResourceTrackingPage)
);

const ResourceTrackingSettingsPage = dynamic(() =>
    import('./ResourceTrackingSettingsPage').then(m => m.ResourceTrackingSettingsPage)
);

const PoolsPage = dynamic(() =>
    import('./PoolsPage').then(m => m.PoolsPage)
);

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

    // Register navigation menu items
    menuItems: [
        {
            label: 'Resources',
            href: '/tron-resource-explorer',
            icon: 'Activity',
            category: 'analytics',
            order: 40
        },
        {
            label: 'Energy Pools',
            href: '/energy-pools',
            icon: 'Users',
            category: 'analytics',
            order: 41
        }
    ],

    // Register main resource tracking pages
    pages: [
        {
            path: '/tron-resource-explorer',
            component: ResourceTrackingPage,
            title: 'Resource Explorer - TronRelic',
            description: 'Monitor TRON energy and bandwidth delegation trends'
        },
        {
            path: '/energy-pools',
            component: PoolsPage,
            title: 'Energy Pools - TronRelic',
            description: 'Track TRON energy rental pool activity and delegation patterns'
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
