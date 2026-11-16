/**
 * @fileoverview Decide the interface density a page path renders at.
 *
 * Admin pages hold forms, tables, and settings that an operator scans, so
 * they render at the `compact` density. Public pages keep the site default.
 * The rule lives in one function so the page content, the dialogs, and the
 * slide-over panels opened from a page all reach the same answer.
 *
 * - Every admin page, core or plugin, is served under `/system`. A plugin
 *   registers its admin pages at `/system/plugins/<id>/...` or, like the blog
 *   plugin, directly at `/system/<name>`.
 * - The path must already have its language prefix removed.
 */

import type { DensityStep } from './DensityStep';

/**
 * Path prefixes whose pages render at the compact density. A path matches a
 * prefix when it equals it or continues it with a `/`, so `/system` matches
 * `/system/users` and does not match `/systematic`.
 */
const COMPACT_ROUTE_PREFIXES: readonly string[] = ['/system'];

/**
 * Return the density a page path renders at, so the caller can stamp it as
 * `data-density` on the element wrapping that page's content.
 *
 * @param route - The page path with any language prefix removed, such as
 *   `/system/users`, so a translated address resolves like its English one.
 * @returns `compact` for an admin page, or `undefined` when the page keeps
 *   the density it inherits, in which case the caller sets no attribute.
 */
export function resolveRouteDensity(route: string): DensityStep | undefined {
    const isCompact = COMPACT_ROUTE_PREFIXES.some(
        prefix => route === prefix || route.startsWith(`${prefix}/`)
    );
    return isCompact ? 'compact' : undefined;
}
