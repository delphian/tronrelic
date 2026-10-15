/**
 * @fileoverview A route an administrator has published in one or more languages.
 */

/**
 * The per-route switch that puts a language on a page.
 *
 * `pattern` names a route rather than a single URL, so one entry covers every
 * URL a template serves. The syntax is the one `matchRoutePattern` reads: a
 * literal path such as `/about`, `:name` for exactly one segment, and a final
 * `*` for one or more remaining segments, as in `/blog/*`.
 *
 * A language listed here only takes effect while that language is also
 * enabled. Listing a disabled language is allowed, so an administrator can
 * prepare routes before switching the language on.
 */
export interface ILocalizedRoute {
    /** Stable identifier of the entry. */
    id: string;

    /** Route pattern, always starting with `/`. */
    pattern: string;

    /** Codes of the languages this route is published in. */
    languages: string[];

    /** ISO timestamp of the last change to the entry. */
    updatedAt: string;
}
