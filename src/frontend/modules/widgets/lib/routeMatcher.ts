/**
 * @fileoverview Client-side mirror of the backend route matcher.
 *
 * The editor scopes each zone to a page by asking, for every placement,
 * whether SSR resolution would render it on that page. Answering that on
 * the client means re-implementing the grammar from
 * `backend/modules/widgets/placements/route-matcher.ts`. The two must stay
 * in lockstep: empty `routes` matches every path, and otherwise an entry
 * matches as an exact path, a single-segment glob (`/tools/*`), or a deep
 * glob (`/system/**`).
 *
 * @module modules/widgets/lib/routeMatcher
 */

/**
 * Whether a placement's route filter admits the given page.
 *
 * @param routes - The placement's route filter; empty means every page.
 * @param route - The page path the editor is scoped to.
 * @returns True when the placement would render on that page.
 */
export function placementMatchesRoute(routes: ReadonlyArray<string>, route: string): boolean {
    let matched = routes.length === 0;
    for (const pattern of routes) {
        if (matched) break;
        if (pattern === route) {
            matched = true;
        } else if (pattern.endsWith('/**')) {
            const prefix = pattern.slice(0, -3);
            matched = prefix.length === 0 ? route.startsWith('/') : route.startsWith(`${prefix}/`);
        } else if (pattern.endsWith('/*')) {
            const prefix = pattern.slice(0, -2);
            if (route.startsWith(`${prefix}/`)) {
                const remainder = route.slice(prefix.length + 1);
                matched = remainder.length > 0 && remainder.indexOf('/') === -1;
            }
        }
    }
    return matched;
}

/**
 * Light validation for a typed path, mirroring the server's
 * `normaliseRoutePattern` rules the admin API enforces: non-empty,
 * whitespace-free, starting with `/`, and using `*` only as a trailing
 * `/*` or `/**` marker. Rejecting a bad path here means the operator sees
 * the problem in the field instead of in a failed save.
 *
 * @param value - Raw text from a path input.
 * @returns The trimmed path, or null when it is not a valid route.
 */
export function normaliseRouteInput(value: string): string | null {
    const trimmed = value.trim();
    let result: string | null = trimmed;
    if (trimmed.length === 0 || !trimmed.startsWith('/') || /\s/.test(trimmed)) {
        result = null;
    } else {
        // Strip one trailing glob marker, then reject any `*` left behind.
        // The server does exactly this, so `/tools/*/extra` and `/tools*`
        // have to fail in the field rather than on save.
        const withoutTrailingGlob = trimmed.endsWith('/**')
            ? trimmed.slice(0, -3)
            : trimmed.endsWith('/*')
                ? trimmed.slice(0, -2)
                : trimmed;
        if (withoutTrailingGlob.includes('*')) {
            result = null;
        }
    }
    return result;
}
