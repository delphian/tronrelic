/**
 * @fileoverview Shared plugin-page path matching for wildcard routes.
 *
 * Plugin pages historically resolved by exact path string. Wildcard pages
 * (a registered path ending in '/*', e.g. '/blog/*') let one page config own
 * every strictly deeper path — the mechanism behind per-resource plugin URLs
 * like '/blog/my-post'.
 *
 * This module is deliberately pure and free of 'server-only' so BOTH the
 * server registry (serverPluginRegistry.ts) and the client registry
 * (pluginRegistry.ts) run the identical matching algorithm. If the two sides
 * ever diverged, the server could resolve a slug to one plugin page while the
 * client resolved it to another, producing React hydration mismatches.
 *
 * Matching rules:
 * - An exact registration always beats a wildcard.
 * - A wildcard '/prefix/*' matches paths strictly deeper than '/prefix'
 *   ('/prefix/a', '/prefix/a/b') and never '/prefix' itself — the index page
 *   registers its exact path separately, keeping semantics unambiguous.
 * - Among overlapping wildcards, the longest prefix wins.
 */

/**
 * A wildcard page entry prepared for prefix matching.
 *
 * Callers pre-strip the '/*' suffix once at registration time so per-request
 * matching does no string surgery beyond a startsWith check.
 */
export interface IWildcardPageEntry<T> {
    /** The wildcard's prefix with the trailing '/*' removed (e.g. '/blog'). */
    prefix: string;

    /** The resolved value (page config or registry record) for this wildcard. */
    value: T;
}

/**
 * Reports whether a registered page path uses the wildcard convention.
 *
 * Registries use this at index-build time to divert wildcard entries into the
 * prefix list instead of the exact-path map.
 *
 * @param path - The page path as declared in the plugin's IPageConfig
 * @returns True when the path ends with '/*' and has a non-empty prefix
 */
export function isWildcardPath(path: string): boolean {
    return path.length > 2 && path.endsWith('/*');
}

/**
 * Extracts the matchable prefix from a wildcard page path.
 *
 * Callers store this once per wildcard so request-time matching avoids
 * repeated slicing.
 *
 * @param path - A wildcard page path (e.g. '/blog/*'); caller must have
 *   verified it with isWildcardPath first
 * @returns The prefix without the trailing '/*' (e.g. '/blog')
 */
export function wildcardPrefix(path: string): string {
    return path.slice(0, -2);
}

/**
 * Resolves a requested slug against exact and wildcard page registrations.
 *
 * Exact matches take absolute precedence so a plugin owning '/blog' exactly
 * is never shadowed by another plugin's '/blog/*'. Wildcards match only
 * strictly deeper paths, and the boundary check requires a '/' after the
 * prefix so '/blogx' can never match '/blog/*'.
 *
 * @param exactMap - Exact-path registrations keyed by their literal path
 * @param wildcardEntries - Wildcard registrations, pre-sorted by prefix
 *   length descending so the first hit is the longest (most specific) prefix
 * @param slug - The requested URL path to resolve (e.g. '/blog/my-post')
 * @returns The matched value, or null when no registration covers the slug
 */
export function matchPluginPagePath<T>(
    exactMap: Map<string, T>,
    wildcardEntries: ReadonlyArray<IWildcardPageEntry<T>>,
    slug: string
): T | null {
    let result: T | null = exactMap.get(slug) ?? null;
    if (result === null) {
        for (const entry of wildcardEntries) {
            if (slug.startsWith(entry.prefix + '/') && slug.length > entry.prefix.length + 1) {
                result = entry.value;
                break;
            }
        }
    }
    return result;
}

/**
 * Sorts wildcard entries so the longest (most specific) prefix matches first.
 *
 * Registries call this once after collecting wildcard registrations; sorting
 * at build time keeps matchPluginPagePath a simple first-hit scan.
 *
 * @param entries - Wildcard entries in registration order
 * @returns A new array sorted by prefix length descending
 */
export function sortWildcardEntries<T>(
    entries: ReadonlyArray<IWildcardPageEntry<T>>
): Array<IWildcardPageEntry<T>> {
    return [...entries].sort((a, b) => b.prefix.length - a.prefix.length);
}
