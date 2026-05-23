/**
 * @fileoverview Widget zone subsystem barrel.
 *
 * Public exports for the zone subsystem — the `defineZone` constructor,
 * the core `ZONES` catalog, the runtime `ZoneRegistry`, and the
 * per-plugin `PluginZones` facade. Consumed by `WidgetsModule`, the
 * plugin loader, and core layout files that need to reference zones by
 * typed identifier.
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
export { ZONES } from './descriptors.js';
export type { Zones } from './descriptors.js';
export { ZoneRegistry, RESERVED_PLUGIN_ID } from './zone-registry.js';
export { PluginZones } from './plugin-zones.js';
