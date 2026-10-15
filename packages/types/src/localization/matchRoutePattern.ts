/**
 * @fileoverview Decide whether a path belongs to a localized route pattern.
 *
 * The Next.js middleware, the root layout, the language switcher, and the
 * backend all need the same answer to "is `/blog/my-post` covered by the
 * pattern `/blog/*`?". Keeping one implementation here means a route the admin
 * page reports as published is exactly the route the middleware serves.
 */

/**
 * Split a path into its non-empty segments, ignoring a trailing slash.
 *
 * @param path - Path such as `/blog/post/`.
 * @returns Segments such as `['blog', 'post']`; an empty array for `/`.
 */
function splitPath(path: string): string[] {
    return path.split('/').filter(segment => segment !== '');
}

/**
 * Test a path against a route pattern.
 *
 * Literal segments must match exactly. A `:name` segment matches any single
 * segment. A `*` in the last position matches one or more remaining segments,
 * so `/blog/*` covers `/blog/a` and `/blog/a/b` but not `/blog` itself, which
 * is usually a different page with different text and is published separately.
 *
 * @param pattern - Route pattern, e.g. `/blog/*` or `/address/:address`.
 * @param path - Unprefixed request path, e.g. `/blog/my-post`.
 * @returns True when the pattern covers the path.
 */
export function matchRoutePattern(pattern: string, path: string): boolean {
    const patternSegments = splitPath(pattern);
    const pathSegments = splitPath(path);
    let matched = true;
    let wildcard = false;

    for (let index = 0; index < patternSegments.length && matched && !wildcard; index++) {
        const segment = patternSegments[index];
        const isLast = index === patternSegments.length - 1;
        if (segment === '*' && isLast) {
            wildcard = true;
            matched = pathSegments.length > index;
        } else if (segment.startsWith(':')) {
            matched = pathSegments[index] !== undefined;
        } else {
            matched = pathSegments[index] === segment;
        }
    }

    if (matched && !wildcard) {
        matched = pathSegments.length === patternSegments.length;
    }

    return matched;
}
