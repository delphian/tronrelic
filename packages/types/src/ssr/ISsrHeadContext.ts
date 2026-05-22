/**
 * @fileoverview Input shape passed to ssr.headFragments handlers.
 *
 * Carries the minimum request context a head-fragment contributor needs
 * to decide what — if anything — to inject. Kept deliberately small
 * because every field added becomes part of the public contract; new
 * fields require a contract amendment and are easier to add later than
 * to remove.
 *
 * @module types/ssr/ISsrHeadContext
 */

/**
 * Context supplied to handlers of the ssr.headFragments waterfall.
 *
 * Read-only by convention — handlers must not mutate the context object
 * itself; their contribution flows through the returned head-fragment
 * list, not through side effects on the input.
 */
export interface ISsrHeadContext {
    /** Request path being rendered, e.g. `/` or `/markets/energy`. */
    readonly path: string;
    /**
     * Parsed cookie map. Values are URI-decoded by the SSR endpoint
     * before being passed to handlers; the rare case where a handler
     * needs the raw header should fetch it from the original request
     * elsewhere.
     */
    readonly cookies: Readonly<Record<string, string>>;
    /** Parsed query-string map for the request being rendered. */
    readonly query: Readonly<Record<string, string>>;
}
