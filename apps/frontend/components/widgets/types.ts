/**
 * Widget data structure for SSR rendering.
 *
 * Mirrors the IWidgetData interface from @tronrelic/types but without
 * the fetchData function (which only exists on the backend).
 */
export interface WidgetData {
    /**
     * Unique widget identifier.
     */
    id: string;

    /**
     * Target zone where the widget should render.
     */
    zone: string;

    /**
     * Plugin that registered this widget.
     */
    pluginId: string;

    /**
     * Sort order within the zone.
     */
    order: number;

    /**
     * Optional display title.
     */
    title?: string;

    /**
     * Pre-fetched data for SSR rendering.
     *
     * The structure is defined by the individual plugin and can be any
     * JSON-serializable object.
     */
    data: unknown;
}
