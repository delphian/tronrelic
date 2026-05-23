/**
 * @fileoverview Widgets module public API.
 *
 * Exposes the module class, its dependency interface, and the zone
 * subsystem barrel so consumers (bootstrap, plugin loader, layouts,
 * tests) can import everything they need from one path.
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

export { ZonesController } from './api/zones.controller.js';
export { createZonesAdminRouter } from './api/zones.routes.js';
