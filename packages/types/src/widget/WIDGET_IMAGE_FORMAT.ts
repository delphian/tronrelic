/**
 * @fileoverview JSON Schema `format` that marks a widget setting as the URL
 * of an image.
 *
 * A widget type declares its settings as JSON Schema, and the placement
 * form on `/system/widgets` builds its controls from that schema. A plain
 * string property renders as a text input, which leaves the operator
 * pasting upload URLs by hand. Declaring `format: WIDGET_IMAGE_FORMAT.name`
 * on the property tells the form to render the file picker with a preview
 * instead, and tells the placements API to reject a value that is not a
 * safe image URL. Both sides import the name and pattern from here so they
 * cannot drift.
 */

/**
 * Name and shape of the image-URL format.
 *
 * `name` is the value a schema puts in `format`. `pattern` is the source of
 * the regular expression the placements API registers under that name. It
 * accepts the two shapes a files provider hands back: a root-relative path
 * on this site, such as `/uploads/...`, or an absolute http(s) URL.
 *
 * The value ends up in an `<img src>` on public pages, so the pattern also
 * refuses what could load from a host nobody chose or run script. A
 * protocol-relative `//host` path is refused because it leaves the site
 * while reading like an internal path, and `/\host` because browsers read
 * the backslash as a slash. Every scheme other than http and https is
 * refused, which covers `javascript:` and `data:`. Whitespace and control
 * characters are refused because browsers strip some of them while parsing,
 * so a value could resolve somewhere other than it reads.
 */
export const WIDGET_IMAGE_FORMAT: {
    readonly name: string;
    readonly pattern: string;
} = {
    name: 'image-url',
    pattern: '^(/(?![/\\\\])[^\\s\\u0000-\\u001f\\u007f]*|https?://[^\\s\\u0000-\\u001f\\u007f]+)$'
};
