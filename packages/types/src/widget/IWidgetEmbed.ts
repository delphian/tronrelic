/**
 * @fileoverview One widget embedded in a page or post body.
 *
 * This is the JSON an author writes inside a ` ```widget ` fenced block, and
 * the value the placeholder element carries from the markdown renderer to
 * the backend and the frontend. See `WIDGET_EMBED_MARKUP` for the markup.
 */

/**
 * A widget embedded in markdown content.
 */
export interface IWidgetEmbed {
    /** Widget type id, such as `core:world-clocks`. */
    type: string;

    /**
     * The widget's settings, the same object a placement stores as its
     * `instanceConfig`. Checked against the type's settings schema each time
     * the embed is resolved. An embed written without settings carries `{}`.
     */
    config: Record<string, unknown>;

    /**
     * When true, the page holding the embed is not served while the widget
     * type is unregistered, which is usually because the plugin that owns
     * it is disabled. A page built around one widget, such as a dashboard
     * page, would otherwise keep serving its text with an empty space where
     * the widget belongs. Present only when the author set it; an embed
     * without it is optional, and a missing type renders as nothing.
     */
    required?: true;
}
