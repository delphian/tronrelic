/**
 * @fileoverview The markup that carries a widget embedded in a page or post.
 *
 * An author embeds a widget in markdown with a fenced code block whose
 * language is `widget` and whose body is JSON naming the widget type and its
 * settings. The shared markdown renderer turns each such block into one empty
 * placeholder element in the HTML it stores. The backend reads the
 * placeholders to fetch each widget's data, and the frontend reads them to
 * render the widget in place. All three sides import the names from here so
 * they cannot drift.
 *
 * The placeholder uses a custom element name on purpose. The sanitizer runs
 * before placeholders are written and removes any element it does not know,
 * so a placeholder in stored HTML can only have come from a fenced block.
 */

/**
 * Names that make up the embed markup.
 *
 * `fenceLanguage` is the info string an author writes after the opening
 * fence. `tagName` is the placeholder element. `embedAttribute` holds the
 * embed as URI-encoded JSON, and `typeAttribute` repeats the widget type id
 * so an editor preview can label the placeholder without decoding it.
 */
export const WIDGET_EMBED_MARKUP: {
    readonly fenceLanguage: string;
    readonly tagName: string;
    readonly embedAttribute: string;
    readonly typeAttribute: string;
} = {
    fenceLanguage: 'widget',
    tagName: 'tr-widget',
    embedAttribute: 'data-embed',
    typeAttribute: 'data-type'
};
