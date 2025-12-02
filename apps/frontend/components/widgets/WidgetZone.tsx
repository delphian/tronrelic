import type { WidgetData } from './types';

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
                        <h2 className="text-2xl font-bold mb-4">{widget.title}</h2>
                    )}
                    <div className="widget-content">
                        {/* TODO: Render actual widget component from plugin */}
                        <pre className="bg-surface-elevated p-4 rounded-lg overflow-auto">
                            {JSON.stringify(widget.data, null, 2)}
                        </pre>
                    </div>
                </div>
            ))}
        </div>
    );
}
