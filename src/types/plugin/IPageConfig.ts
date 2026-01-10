import type { ComponentType } from 'react';
import type { IFrontendPluginContext } from './IFrontendPluginContext.js';

/**
 * Page configuration for plugin routes.
 *
 * Defines routable pages provided by a plugin. Each page config maps a URL path
 * to a React component, enabling plugins to own their full-stack features including
 * UI presentation without modifying core routing infrastructure.
 *
 * Plugin page components receive an IFrontendPluginContext prop containing UI
 * components, API client, WebSocket access, and other utilities needed to build
 * features without importing from the frontend app.
 */
export interface IPageConfig {
    /** Plugin identifier (set automatically by the registry) */
    pluginId?: string;
    /** URL path (e.g., '/whales', '/my-plugin/settings') */
    path: string;
    /**
     * React component to render for this route.
     *
     * The component receives IFrontendPluginContext as a prop, providing access
     * to UI components, charts, API client, and WebSocket for real-time updates.
     *
     * @example
     * ```typescript
     * function MyPage({ context }: { context: IFrontendPluginContext }) {
     *     const { ui, api, websocket } = context;
     *     return <ui.Card>...</ui.Card>;
     * }
     * ```
     */
    component: ComponentType<{ context: IFrontendPluginContext }>;
    /** Optional page title for metadata */
    title?: string;
    /** Optional page description for metadata */
    description?: string;
    /** Whether this page requires authentication */
    requiresAuth?: boolean;
    /** Whether this page requires admin privileges */
    requiresAdmin?: boolean;
}
