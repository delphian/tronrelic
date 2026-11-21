/**
 * @fileoverview Checks the redirect a plugin page's serverMetadataFetcher asks
 * for before the catch-all route sends a visitor there.
 *
 * The target often comes from stored data, such as a blog post's previous
 * slugs, so the route must never follow it off-site or back to the page being
 * rendered. Kept pure, with no Next.js imports, so the rule can be unit tested
 * without a request.
 */

/**
 * Remove trailing slashes so `/blog/a` and `/blog/a/` compare as one path,
 * while the root path `/` stays as it is.
 */
function withoutTrailingSlash(path: string): string {
    const trimmed = path.replace(/\/+$/, '');
    return trimmed || '/';
}

/**
 * Reduce a path to the address a browser would actually request from it, so
 * two spellings of one page compare as equal.
 *
 * A browser resolves `..` segments and leaves the fragment behind before it
 * sends the request, and the catch-all route builds the fetcher's context from
 * the path alone, so `/blog/a`, `/blog/a#top`, `/blog/a?from=old`, and
 * `/blog/../blog/a` all reach the fetcher as `/blog/a`. The host is a
 * placeholder that never appears in the result, and a path the URL parser
 * rejects yields null so the caller refuses it instead of guessing.
 */
function requestPathname(path: string): string | null {
    let pathname: string | null;
    try {
        pathname = withoutTrailingSlash(new URL(path, 'http://placeholder.invalid').pathname);
    } catch {
        pathname = null;
    }
    return pathname;
}

/**
 * Accept a plugin's redirect target only when it is a path on this site that
 * differs from the one being rendered.
 *
 * A browser reads `//host` and `/\host` as a link to another host, so both are
 * refused along with anything that does not start with `/`. Whitespace and
 * control characters are refused because a browser strips some of them and
 * could then read a different address than the one checked here. A target
 * that requests the current path is refused because following it would loop.
 * That comparison runs on the resolved pathnames rather than the raw strings,
 * because a query string, a fragment, or `..` segments never reach the
 * fetcher. A target whose own pathname differs keeps its query and fragment.
 *
 * @param target - The `redirect` value the plugin returned; anything but a
 *   string is refused.
 * @param currentPath - The unprefixed path being rendered, such as
 *   `/blog/old-slug`, used to refuse a redirect to itself.
 * @returns The target to redirect to, trimmed, or null when the redirect must
 *   be ignored.
 */
export function resolvePluginRedirectPath(target: unknown, currentPath: string): string | null {
    const path = typeof target === 'string' ? target.trim() : '';
    const onSite = path.startsWith('/')
        && !path.startsWith('//')
        && !path.includes('\\')
        && !/[\s\u0000-\u001f\u007f]/.test(path);
    const targetPathname = onSite ? requestPathname(path) : null;
    const isSelf = targetPathname !== null && targetPathname === requestPathname(currentPath);
    return targetPathname !== null && !isSelf ? path : null;
}
