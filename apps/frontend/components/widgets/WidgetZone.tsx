import type { ComponentType } from 'react';
import type { WidgetData } from './types';

/**
 * Widget component registry.
 *
 * Plugins register their widget components here during frontend initialization.
 * Components receive pre-fetched data from SSR and render the widget UI.
 */
const widgetComponents: Map<string, ComponentType<{ data: unknown }>> = new Map();

/**
 * Register a widget component for rendering.
 *
 * Plugins call this during frontend initialization to associate their
 * React component with a widget ID. When the widget zone renders,
 * it looks up the component by ID and passes the pre-fetched data.
 *
 * @param widgetId - Unique widget identifier (matches backend registration)
 * @param component - React component that renders the widget
 *
 * @example
 * ```typescript
 * // In plugin frontend initialization
 * registerWidgetComponent('whale-alerts:recent', RecentWhalesWidget);
 * ```
 */
export function registerWidgetComponent(
    widgetId: string,
    component: ComponentType<{ data: unknown }>
): void {
    widgetComponents.set(widgetId, component);
}

/**
 * Get a registered widget component by ID.
 *
 * @param widgetId - Widget identifier to look up
 * @returns Component if registered, undefined otherwise
 */
export function getWidgetComponent(widgetId: string): ComponentType<{ data: unknown }> | undefined {
    return widgetComponents.get(widgetId);
}

/**
 * Render a single widget with its registered component or fallback.
 *
 * If a component is registered for the widget, renders it with the data.
 * In development, shows a debug view for unregistered widgets.
 * In production, unregistered widgets render nothing.
 */
function WidgetRenderer({ widget }: { widget: WidgetData }) {
    const Component = widgetComponents.get(widget.id);

    if (Component) {
        return <Component data={widget.data} />;
    }

    // Development fallback: show debug info for unregistered widgets
    if (process.env.NODE_ENV === 'development') {
        return (
            <div className="surface surface--padding-md border border-dashed border-border">
                <p className="text-sm text-muted mb-2">
                    Widget: <code>{widget.id}</code> (no component registered)
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
 * Widget zone component for rendering plugin widgets.
 *
 * Filters widgets by zone name and renders them in order. This component
 * is used in layout files to define widget injection points.
 *
 * @param name - Zone identifier (e.g., 'main-after', 'sidebar-top')
 * @param widgets - Array of widget data from SSR fetch
 *
 * @example
 * ```tsx
 * // In layout.tsx
 * const widgets = await fetchWidgetsForRoute('/');
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
