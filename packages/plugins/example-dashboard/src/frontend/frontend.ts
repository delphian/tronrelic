import { definePlugin } from '@tronrelic/types';
import { exampleDashboardManifest } from '../manifest';
import { ExampleDashboardPage } from './ExampleDashboardPage';

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
