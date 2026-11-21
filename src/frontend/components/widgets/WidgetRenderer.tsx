/**
 * @fileoverview Renders one widget's registered component with its data.
 *
 * A widget can appear in a zone, drawn by `WidgetZone`, or embedded in a page
 * or post body, drawn by `EmbeddedWidgetContent`. Both look the component up
 * the same way and wrap it in the same plugin context, so this is the one
 * place that does it.
 *
 * The file carries no `'use client'` directive and uses no hooks, so it
 * renders in a server tree (a zone, a CMS page) and in a client tree (a plugin
 * page that renders an embedded body through its context) alike.
 */

import type { WidgetData } from './types';
import { getWidgetComponent } from './getWidgetComponent';
import { WidgetWithContext } from './WidgetWithContext';

/**
 * Props for the widget renderer.
 */
export interface IWidgetRendererProps {
    /** Widget data including the SSR-fetched content. */
    widget: WidgetData;
    /** Current URL path where the widget is rendering. */
    route: string;
    /** Route parameters extracted from the URL path. */
    params: Record<string, string>;
}

/**
 * Render a single widget with its registered component, or a fallback.
 *
 * Looks the component up in the core and generated widget registries. With
 * no component registered, development shows the widget's data so the
 * missing export is easy to spot, and production renders nothing.
 *
 * @param props - See {@link IWidgetRendererProps}.
 * @returns The widget, the development fallback, or null.
 */
export function WidgetRenderer({ widget, route, params }: IWidgetRendererProps) {
    const Component = getWidgetComponent(widget.id);
    let result: JSX.Element | null = null;

    if (Component) {
        result = (
            <WidgetWithContext
                Component={Component}
                data={widget.data}
                instanceConfig={widget.instanceConfig}
                pluginId={widget.pluginId}
                route={route}
                params={params}
            />
        );
    } else if (process.env.NODE_ENV === 'development') {
        result = (
            <div className="surface surface--padding-md border border-dashed border-border">
                <p className="text-sm text-muted mb-2">
                    Widget: <code>{widget.id}</code> (no component registered)
                </p>
                <p className="text-xs text-muted mb-2">
                    Export this widget from <code>src/frontend/widgets/index.ts</code>
                </p>
                <pre className="text-xs overflow-auto max-h-48 bg-surface-elevated p-2 rounded">
                    {JSON.stringify(widget.data, null, 2)}
                </pre>
            </div>
        );
    }

    return result;
}
