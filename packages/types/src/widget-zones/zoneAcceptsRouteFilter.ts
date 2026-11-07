/**
 * @fileoverview Decide whether placements in a zone may be limited to some pages.
 */

import type { ZoneHost } from './IZoneDescriptor.js';

/**
 * Test whether a placement in a zone with this host may carry a route filter.
 *
 * Zones with the `'site'` host are drawn by the root layout, and Next.js does
 * not render the root layout again when a visitor moves between pages without
 * a full reload. A widget limited to some pages in one of those zones would
 * keep showing, or keep missing, from the page the visitor arrived on, until
 * they reloaded. Those zones therefore show the same widgets on every page.
 * Every other host is drawn by a page, or follows the visitor between pages,
 * so a route filter works there.
 *
 * The widgets service enforces this on every placement write, and the admin
 * editor uses it to explain the restriction before the write is attempted.
 *
 * @param host - The host of the zone a placement targets.
 * @returns True when the zone accepts placements limited to some pages.
 */
export function zoneAcceptsRouteFilter(host: ZoneHost): boolean {
    const result = host !== 'site';
    return result;
}
