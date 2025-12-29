import type { ComponentType } from 'react';
import type { WidgetData } from './types';
import { getWidgetComponent } from './widgets.generated';
import { WidgetWithContext } from './WidgetWithContext';

/**
 * Render a single widget with its registered component or fallback.
 *
 * Looks up the component from the statically-generated widget registry.
 * If a component is registered, renders it with the SSR data and plugin context.
 * In development, shows a debug view for unregistered widgets.
 * In production, unregistered widgets render nothing.
 */
function WidgetRenderer({ widget }: { widget: WidgetData }) {
    const Component = getWidgetComponent(widget.id);

    if (Component) {
        return (
            <WidgetWithContext
                Component={Component}
                data={widget.data}
                pluginId={widget.pluginId}
            />
        );
    }

    // Development fallback: show debug info for unregistered widgets
    if (process.env.NODE_ENV === 'development') {
        return (
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

    // Production: render nothing for unregistered widgets
    return null;
}

/**
 * Widget zone component for rendering plugin widgets with SSR support.
 *
 * This is a server component that renders plugin widgets during SSR.
 * Widget components are statically imported at build time via the generated
 * registry, enabling full server-side rendering without loading flash.
 *
 * After hydration, individual widget components can subscribe to WebSocket
 * events for live data updates while maintaining the SSR-rendered initial state.
 *
 * SSR Flow:
 * 1. Build time: Generator creates static imports in widgets.generated.ts
 * 2. Request time: Layout fetches widget data from backend API
 * 3. SSR: WidgetZone renders components with fresh data
 * 4. Hydration: Widget components become interactive, can subscribe to WebSocket
 *
 * @param name - Zone identifier (e.g., 'main-after', 'sidebar-top')
 * @param widgets - Array of widget data from SSR fetch
 *
 * @example
 * ```tsx
 * // In layout.tsx (Server Component)
 * const widgets = await fetchWidgetsForRoute(pathname);
 *
 * <WidgetZone name="main-after" widgets={widgets} />
 * ```
 */
export function WidgetZone({
    name,
    widgets
}: {
    name: string;
    widgets: WidgetData[];
}) {
    // Filter widgets for this zone and sort by order
    const zoneWidgets = widgets
        .filter(w => w.zone === name)
        .sort((a, b) => a.order - b.order);

    // Don't render empty zones
    if (zoneWidgets.length === 0) {
        return null;
    }

    return (
        <div className="widget-zone" data-zone={name}>
            {zoneWidgets.map(widget => (
                <div
                    key={widget.id}
                    className="widget-container mb-6"
                    data-widget-id={widget.id}
                    data-plugin-id={widget.pluginId}
                >
                    {widget.title && (
                        <h2 className="text-xl font-semibold mb-4">{widget.title}</h2>
                    )}
                    <WidgetRenderer widget={widget} />
                </div>
            ))}
        </div>
    );
}
