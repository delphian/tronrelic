/**
 * @fileoverview Serializes a value as JSON that is safe to write inside an
 * inline `<script>` element.
 *
 * Why this exists: `JSON.stringify` output is valid JSON but not safe HTML. A
 * string value containing `</script>` ends the script element early, and the
 * browser then parses whatever follows as markup, which lets stored text such
 * as a page title run as script. Every inline JSON block on the site, such as a
 * JSON-LD block or the runtime configuration, must be written through this
 * function instead of calling `JSON.stringify` directly.
 *
 * It lives in the types package so core and plugins share one implementation
 * rather than each copying the escape by hand.
 */

/**
 * Serialize a value as JSON for use as the content of an inline `<script>`.
 *
 * Three characters are replaced with their JSON unicode escapes, which a JSON
 * parser and a JavaScript engine both read back as the original character, so
 * the data is unchanged:
 *
 * - `<` cannot start `</script>` or `<!--` once escaped, so no string value can
 *   close the element or open an HTML comment.
 * - U+2028 and U+2029 are line terminators in older JavaScript engines, where a
 *   raw one inside a string literal is a syntax error that stops the script.
 *
 * @param value - The data to embed. Supplied by the caller that renders the
 *   script element; it may hold text written by users or administrators.
 * @returns The JSON text to use as the script's content. A value JSON cannot
 *   represent, such as `undefined`, becomes `null` so the script stays valid.
 */
export function serializeInlineJson(value: unknown): string {
    const json = JSON.stringify(value) ?? 'null';
    return json
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
