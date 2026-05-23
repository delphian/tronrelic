/**
 * @fileoverview Widget zone subsystem barrel — internal to the widgets module.
 *
 * Exports the `defineZone` descriptor mint, the `ZoneRegistry` runtime
 * class, and the plain-data `CORE_ZONE_DESCRIPTORS` catalog. Consumers
 * outside the widgets module reach zones through `IWidgetsService` on
 * the service registry, not these symbols.
 *
 * @module backend/modules/widgets/zones
 */

export {
    defineZone,
    forgetZone,
    isKnownZone,
    listKnownZones,
    __resetKnownZonesForTests
} from './define-zone.js';
export { CORE_ZONE_DESCRIPTORS } from './descriptors.js';
export { ZoneRegistry, RESERVED_PLUGIN_ID } from './zone-registry.js';
