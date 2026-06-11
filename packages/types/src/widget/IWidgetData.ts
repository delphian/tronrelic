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
     * Optional root-relative URL that turns the rendered title into a
     * link. Carried verbatim from the resolved placement; only takes
     * effect when `title` is also present, since the host chrome links
     * the title text.
     */
    titleUrl?: string;

    /**
     * Pre-fetched data for SSR rendering.
     *
     * This is the result of calling the widget's fetchData() function.
     * The structure is defined by the individual plugin and can be any
     * JSON-serializable object.
     */
    data: unknown;

    /**
     * Operator-editable per-placement instance configuration, forwarded
     * verbatim from the resolved placement so the frontend component can
     * branch on the same config the backend data fetcher received.
     *
     * Optional on the wire for backward compatibility; the resolver always
     * populates it (substituting `{}` when the placement carries no
     * overrides) and the frontend renderer defaults it to `{}` on read.
     */
    instanceConfig?: Record<string, unknown>;
}
