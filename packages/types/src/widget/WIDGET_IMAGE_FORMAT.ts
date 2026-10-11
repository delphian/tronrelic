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
 * safe image URL. Both sides import the name and check from here so they
 * cannot drift.
 */

/**
 * Source of the regular expression the format checks a value's shape
 * against. It accepts the two shapes a files provider hands back: a
 * root-relative path on this site, such as `/uploads/...`, or an absolute
 * http(s) URL.
 *
 * The value ends up in an `<img src>` on public pages, so the pattern
 * refuses what could load from a host nobody chose or run script. A
 * protocol-relative `//host` path is refused because it leaves the site
 * while reading like an internal path, and `/\host` because browsers read
 * the backslash as a slash. Every scheme other than http and https is
 * refused, which covers `javascript:` and `data:`. Whitespace and control
 * characters are refused because browsers strip some of them while parsing,
 * so a value could resolve somewhere other than it reads.
 */
const IMAGE_URL_PATTERN_SOURCE = '^(/(?![/\\\\])[^\\s\\u0000-\\u001f\\u007f]*|https?://[^\\s\\u0000-\\u001f\\u007f]+)$';

/** Compiled once, because every placement write and every page render checks against it. */
const IMAGE_URL_PATTERN = new RegExp(IMAGE_URL_PATTERN_SOURCE);

/**
 * Report whether a value is safe to render as a widget image's `<img src>`.
 *
 * Matching the pattern is not enough on its own. `https://?logo` and
 * `https://[x]` both match it, and neither is a URL a browser can resolve,
 * so accepting them would store a value that renders as a broken image on
 * every public page. The absolute branch is therefore parsed with `URL` and
 * its protocol checked, which is the same test the sign-in button image
 * validator applies. A root-relative path is left to the pattern, because
 * there is no base URL to parse it against here.
 *
 * @param value - The trimmed URL an operator or an API caller submitted.
 * @returns True when the value is a root-relative path on this site, or an
 *          absolute http(s) URL a browser can actually resolve.
 */
function isAllowedImageUrl(value: string): boolean {
    let allowed = IMAGE_URL_PATTERN.test(value);

    if (allowed && !value.startsWith('/')) {
        try {
            const parsed = new URL(value);
            allowed = parsed.protocol === 'https:' || parsed.protocol === 'http:';
        } catch {
            allowed = false;
        }
    }

    return allowed;
}

/**
 * Name, shape, and check for the image-URL format.
 *
 * `name` is the value a schema puts in `format`. `pattern` is the source of
 * the regular expression describing the accepted shapes. `isValid` is the
 * check the placements API and every fetcher rendering the value must use,
 * because it adds the parse step the pattern alone cannot perform.
 */
export const WIDGET_IMAGE_FORMAT: {
    readonly name: string;
    readonly pattern: string;
    readonly isValid: (value: string) => boolean;
} = {
    name: 'image-url',
    pattern: IMAGE_URL_PATTERN_SOURCE,
    isValid: isAllowedImageUrl
};
