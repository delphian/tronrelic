/**
 * @fileoverview Route-matcher for widget placement resolution.
 *
 * Pure function evaluating whether a placement's `routes` filter
 * matches a request path. Three pattern grammars share one matcher:
 *
 * - **Exact** — `'/markets'` matches the path `/markets` and nothing
 *   else.
 * - **Prefix** — `'/u/*'` matches anything under `/u/` with one
 *   additional segment (`/u/TXyz` matches, `/u/TXyz/holdings` does
 *   not).
 * - **Deep prefix** — `'/u/**'` matches anything under `/u/` at any
 *   depth, including `/u/TXyz/holdings/2024`.
 *
 * Empty `routes` array still matches every path, preserving the
 * original "no filter" semantic.
 *
 * The matcher is extracted so the placement service's Mongo query and
 * the resolver's in-memory filter share one source of truth, and so
 * the matching rule can evolve in a single file when a more expressive
 * grammar becomes necessary.
 *
 * @module backend/modules/widgets/placements/route-matcher
 */

/**
 * Marker suffix for a single-segment glob.
 */
const SINGLE_GLOB_SUFFIX = '/*';

/**
 * Marker suffix for a deep glob — matches one or more trailing
 * segments.
 */
const DEEP_GLOB_SUFFIX = '/**';

/**
 * Test whether a single pattern matches the given request path.
 *
 * @param pattern - One entry from a placement's `routes` array.
 * @param route - Request path the host resolved.
 * @returns True when the pattern accepts the path.
 */
function patternMatches(pattern: string, route: string): boolean {
    if (pattern === route) {
        return true;
    }

    if (pattern.endsWith(DEEP_GLOB_SUFFIX)) {
        const prefix = pattern.slice(0, -DEEP_GLOB_SUFFIX.length);
        if (prefix.length === 0) {
            return route.startsWith('/');
        }
        // Match `/<prefix>/<anything>` but not the bare prefix —
        // a deep glob is "anything under here", not the parent page.
        return route.startsWith(`${prefix}/`);
    }

    if (pattern.endsWith(SINGLE_GLOB_SUFFIX)) {
        const prefix = pattern.slice(0, -SINGLE_GLOB_SUFFIX.length);
        if (!route.startsWith(`${prefix}/`)) {
            return false;
        }
        // Single-segment glob — the remainder after the prefix must be
        // exactly one path segment with no further slashes.
        const remainder = route.slice(prefix.length + 1);
        return remainder.length > 0 && remainder.indexOf('/') === -1;
    }

    return false;
}

/**
 * Test whether a placement's route filter matches the given request
 * path. Empty `routes` matches every path. Otherwise, any matching
 * entry — exact, single-glob (`/u/*`), or deep-glob (`/u/**`) —
 * accepts the path.
 *
 * @param routes - Placement's route filter.
 * @param route - Request path resolved by the host.
 * @returns True when the placement should render on the given route.
 */
export function routeMatches(routes: ReadonlyArray<string>, route: string): boolean {
    if (routes.length === 0) return true;
    for (const pattern of routes) {
        if (patternMatches(pattern, route)) {
            return true;
        }
    }
    return false;
}

/**
 * Validate and normalise a route pattern.
 *
 * Used by the admin API to reject malformed entries before they reach
 * the database. Valid forms:
 *
 * - `'/'` — root only.
 * - `'/seg1/seg2/...'` — exact path, must start with `/`.
 * - `'/seg/*'` — single-segment glob.
 * - `'/seg/**'` — deep glob.
 *
 * Empty strings, patterns without a leading slash, patterns
 * containing whitespace, and glob markers in non-trailing positions
 * are all rejected.
 *
 * @param pattern - Candidate pattern.
 * @returns Normalised pattern, or null when invalid.
 */
export function normaliseRoutePattern(pattern: string): string | null {
    if (typeof pattern !== 'string') {
        return null;
    }
    const trimmed = pattern.trim();
    if (trimmed.length === 0) {
        return null;
    }
    if (!trimmed.startsWith('/')) {
        return null;
    }
    if (/\s/.test(trimmed)) {
        return null;
    }

    const withoutTrailingGlob = trimmed.endsWith(DEEP_GLOB_SUFFIX)
        ? trimmed.slice(0, -DEEP_GLOB_SUFFIX.length)
        : trimmed.endsWith(SINGLE_GLOB_SUFFIX)
            ? trimmed.slice(0, -SINGLE_GLOB_SUFFIX.length)
            : trimmed;
    if (withoutTrailingGlob.includes('*')) {
        return null;
    }

    return trimmed;
}

/**
 * Split a placement's route filter into the components needed for the
 * Mongo query: exact paths (cheap equality) and pattern entries that
 * must be filtered in memory after the query returns.
 *
 * The placement service uses this to push exact-match filtering down
 * into Mongo and apply the glob predicate as a second pass on the
 * smaller result set. Empty input means "match all routes" — no
 * predicate work needed.
 *
 * @param routes - Placement's route filter.
 * @returns Buckets keyed by `exact` and `patterns`.
 */
export function partitionRoutePatterns(routes: ReadonlyArray<string>): {
    exact: string[];
    patterns: string[];
} {
    const exact: string[] = [];
    const patterns: string[] = [];
    for (const entry of routes) {
        if (entry.endsWith(SINGLE_GLOB_SUFFIX) || entry.endsWith(DEEP_GLOB_SUFFIX)) {
            patterns.push(entry);
        } else {
            exact.push(entry);
        }
    }
    return { exact, patterns };
}
