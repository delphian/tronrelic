/**
 * @fileoverview Placement subsystem barrel.
 *
 * Public exports for placement persistence and SSR resolution.
 *
 * @module backend/modules/widgets/placements
 */

export { PlacementService } from './placement.service.js';
export { PlacementResolver } from './placement-resolver.js';
export { routeMatches, normaliseRoutePattern, partitionRoutePatterns } from './route-matcher.js';
