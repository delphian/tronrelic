/**
 * @fileoverview Widgets module public API.
 *
 * Exposes the module class, its dependency interface, the zone and
 * widget-type subsystems, and the placement persistence layer so
 * consumers (bootstrap, plugin loader, layouts, the compat-shim
 * widget service, tests) can import everything from one path.
 *
 * @module backend/modules/widgets
 */

export { WidgetsModule } from './WidgetsModule.js';
export type { IWidgetsModuleDependencies } from './WidgetsModule.js';

export {
    defineZone,
    forgetZone,
    isKnownZone,
    listKnownZones,
    __resetKnownZonesForTests,
    ZONES,
    ZoneRegistry,
    PluginZones,
    RESERVED_PLUGIN_ID
} from './zones/index.js';
export type { Zones } from './zones/index.js';

export {
    defineWidgetType,
    forgetWidgetType,
    isKnownWidgetType,
    listKnownWidgetTypes,
    __resetKnownWidgetTypesForTests,
    WidgetTypeRegistry,
    PluginWidgetTypes
} from './widget-types/index.js';

export {
    PlacementService,
    PlacementResolver,
    routeMatches,
    normaliseRoutePattern,
    partitionRoutePatterns
} from './placements/index.js';
export type {
    PlacementBroadcastCallback,
    PlacementBroadcastEvent
} from './placements/placement.service.js';

export type { IWidgetPlacementDocument } from './database/index.js';
export { WIDGET_PLACEMENT_COLLECTION } from './database/index.js';

export { ZonesController } from './api/zones.controller.js';
export { createZonesAdminRouter } from './api/zones.routes.js';

export { PlacementsController } from './api/placements.controller.js';
export type {
    IPlacementsControllerDeps,
    PluginDefaultsResolver
} from './api/placements.controller.js';
export { createPlacementsAdminRouter } from './api/placements.routes.js';

export { WidgetTypesController } from './api/widget-types.controller.js';
export { createWidgetTypesAdminRouter } from './api/widget-types.routes.js';
