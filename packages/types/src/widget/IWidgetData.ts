/**
 * Widget data structure returned by the widgets API endpoint.
 *
 * Contains pre-fetched data for a widget along with metadata needed for
 * rendering. This structure is used both internally by the widget service
 * and as the API response format for SSR widget fetching.
 */
export interface IWidgetData {
    /**
     * Unique widget identifier.
     *
     * Matches the id from IWidgetConfig.
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
     * This is the result of calling the widget's fetchData() function.
     * The structure is defined by the individual plugin and can be any
     * JSON-serializable object.
     */
    data: unknown;
}
