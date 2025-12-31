'use client';

import type { ComponentType } from 'react';
import { useMemo } from 'react';
import type { IWidgetComponentProps } from '@tronrelic/types';
import { createPluginContext } from '../../lib/frontendPluginContext';

/**
 * Props for the WidgetWithContext wrapper component.
 */
interface WidgetWithContextProps {
    /**
     * The widget component to render.
     */
    Component: ComponentType<IWidgetComponentProps>;

    /**
     * Pre-fetched widget data from SSR.
     */
    data: unknown;

    /**
     * Plugin ID for creating namespaced context.
     */
    pluginId: string;

    /**
     * Current URL path where the widget is rendering.
     */
    route: string;

    /**
     * Route parameters extracted from the URL path.
     */
    params: Record<string, string>;
}

/**
 * Client component wrapper that provides plugin context to widgets.
 *
 * Creates a plugin-specific context with proper WebSocket namespacing and
 * passes it to the widget component along with the SSR data. This enables
 * widgets to use dependency-injected layout components, UI primitives,
 * and real-time updates without importing directly from the frontend app.
 *
 * Also passes route and params to enable context-aware rendering. For example,
 * a widget on `/u/[address]` can access `params.address` to display profile-
 * specific content.
 *
 * This wrapper is a client component to ensure the context is created
 * in the browser where WebSocket connections are available.
 *
 * @param props - Component, data, pluginId, route, and params
 * @returns The widget component rendered with context
 */
export function WidgetWithContext({
    Component,
    data,
    pluginId,
    route,
    params
}: WidgetWithContextProps) {
    // Memoize context creation to avoid recreating on every render
    const context = useMemo(() => createPluginContext(pluginId), [pluginId]);

    return <Component data={data} context={context} route={route} params={params} />;
}
