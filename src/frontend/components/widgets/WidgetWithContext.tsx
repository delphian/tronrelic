'use client';

import type { ComponentType } from 'react';
import { useMemo } from 'react';
import type { IWidgetComponentProps } from '@/types';
import { createPluginContext } from '../../lib/frontendPluginContext';

/**
 * Stable empty-config reference used as the `instanceConfig` fallback.
 *
 * Defined at module scope so the defaulted value keeps a constant
 * identity across renders. Inlining `{}` would mint a fresh object each
 * render, breaking `React.memo` and any `useEffect(..., [instanceConfig])`
 * in widget components that rely on referential equality.
 */
const EMPTY_CONFIG: Record<string, unknown> = {};

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
     * Operator-editable per-placement instance configuration, forwarded
     * to the widget component so it can branch on the same config its
     * backend data fetcher received. Defaults to `{}` when the placement
     * carries no overrides.
     */
    instanceConfig?: Record<string, unknown>;

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
 * a widget on `/[...slug]` can access `params.slug` to display page-specific
 * content.
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
    instanceConfig,
    pluginId,
    route,
    params
}: WidgetWithContextProps) {
    // Memoize context creation to avoid recreating on every render
    const context = useMemo(() => createPluginContext(pluginId), [pluginId]);

    return (
        <Component
            data={data}
            context={context}
            route={route}
            params={params}
            instanceConfig={instanceConfig ?? EMPTY_CONFIG}
        />
    );
}
