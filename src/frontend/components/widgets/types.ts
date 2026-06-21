/**
 * Widget data structure for SSR rendering.
 *
 * Mirrors the IWidgetData interface from @/types but without
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
     * Optional root-relative URL that turns the rendered title into a
     * link. Only takes effect when `title` is also present.
     */
    titleUrl?: string;

    /**
     * Pre-fetched data for SSR rendering.
     *
     * The structure is defined by the individual plugin and can be any
     * JSON-serializable object.
     */
    data: unknown;

    /**
     * Operator-editable per-placement instance configuration, forwarded
     * from the resolved placement so the widget component can branch on
     * the same config its backend data fetcher received.
     *
     * Optional on the wire; the renderer defaults it to `{}` on read.
     */
    instanceConfig?: Record<string, unknown>;

    /**
     * Child widgets nested inside this item, present only when `id` is the
     * `core:layout-group` container type. The resolver fills it from
     * placements pointing at this container; `WidgetZone` draws them inside
     * a nested flex container. One level deep — children carry no children
     * of their own.
     */
    children?: WidgetData[];
}
