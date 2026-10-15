/**
 * @fileoverview The outcome of reading a language prefix off a request path.
 */

/**
 * The language a request resolves to and its path without the prefix, as
 * `resolveLocalizedPath` returns it.
 */
export interface IResolvedLocalizedPath {
    /** Language to render the page in. */
    language: string;

    /** The path with any language prefix removed, e.g. `/markets`. */
    path: string;
}
