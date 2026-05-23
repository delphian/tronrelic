/**
 * @fileoverview Route-matcher for widget placement resolution.
 *
 * Pure function evaluating whether a placement's `routes` filter
 * matches a request path. The legacy `WidgetService` used strict
 * equality on the array; PR 2 preserves that semantic exactly — empty
 * array matches every route, otherwise the route must appear by
 * string equality. Glob and prefix matching are deferred until an
 * operator UI surfaces the need.
 *
 * The matcher is extracted so the placement service's Mongo query
 * and the resolver's in-memory filter share one source of truth, and
 * so the matching rule can evolve in a single file when a more
 * expressive grammar becomes necessary.
 *
 * @module backend/modules/widgets/placements/route-matcher
 */

/**
 * Test whether a placement's route filter matches the given request
 * path. Empty `routes` matches every path. Otherwise the path must
 * appear in the array (exact match).
 *
 * @param routes - Placement's route filter.
 * @param route - Request path resolved by the host.
 * @returns True when the placement should render on the given route.
 */
export function routeMatches(routes: ReadonlyArray<string>, route: string): boolean {
    if (routes.length === 0) return true;
    return routes.indexOf(route) !== -1;
}
