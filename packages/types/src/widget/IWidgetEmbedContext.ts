/**
 * @fileoverview The page a set of embedded widgets is resolved for.
 *
 * Embedded widgets run the same data fetchers as placed widgets, and those
 * fetchers take the page's route, route params, and language. The content
 * endpoint that serves a page or post body passes this to
 * `IWidgetsService.resolveEmbeds` so each fetcher sees the page it is
 * embedded in.
 */

/**
 * Where embedded widgets are being rendered.
 */
export interface IWidgetEmbedContext {
    /** The page's unprefixed path, such as `/about` or `/blog/my-post`. */
    route: string;

    /** Route params the page's host extracted, such as `{ slug }`. */
    params?: Record<string, string>;

    /** Language of the page, such as `en` or `zh`. Defaults to English. */
    language?: string;
}
