import dynamic from 'next/dynamic';
import { definePlugin } from '@tronrelic/types';
import { exampleDashboardManifest } from '../manifest';

/**
 * Lazily loaded page components.
 *
 * Using next/dynamic ensures CSS modules are code-split and only load when
 * the page is actually visited. Without this, static imports cause plugin CSS
 * to be bundled in shared chunks that load on every page (including homepage).
 */
const ExampleDashboardPage = dynamic(() =>
    import('./ExampleDashboardPage').then(m => m.ExampleDashboardPage)
);

/**
 * Example Dashboard frontend plugin definition.
 *
 * This plugin demonstrates the centralized menu/page system by registering:
 * - A menu item that appears in the main navigation
 * - A page component that renders at /example-dashboard
 *
 * The menu item and page are automatically discovered and integrated without
 * requiring changes to core routing or navigation infrastructure.
 */
export const exampleDashboardFrontendPlugin = definePlugin({
    manifest: exampleDashboardManifest,
    menuItems: [
        {
            label: 'Example',
            href: '/example-dashboard',
            icon: 'Sparkles',
            order: 50,
            category: 'plugins'
        }
    ],
    pages: [
        {
            path: '/example-dashboard',
            component: ExampleDashboardPage,
            title: 'Example Dashboard',
            description: 'Demonstration of the plugin menu and page system'
        }
    ]
});
