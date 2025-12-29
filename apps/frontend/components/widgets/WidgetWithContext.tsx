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
}

/**
 * Client component wrapper that provides plugin context to widgets.
 *
 * Creates a plugin-specific context with proper WebSocket namespacing and
 * passes it to the widget component along with the SSR data. This enables
 * widgets to use dependency-injected layout components, UI primitives,
 * and real-time updates without importing directly from the frontend app.
 *
 * This wrapper is a client component to ensure the context is created
 * in the browser where WebSocket connections are available.
 *
 * @param props - Component, data, and pluginId for context creation
 * @returns The widget component rendered with context
 */
export function WidgetWithContext({ Component, data, pluginId }: WidgetWithContextProps) {
    // Memoize context creation to avoid recreating on every render
    const context = useMemo(() => createPluginContext(pluginId), [pluginId]);

    return <Component data={data} context={context} />;
}
