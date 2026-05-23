/**
 * @fileoverview Public type surface for the widget zone system.
 *
 * Re-exports the descriptor, registry, and per-plugin facade types so
 * consumers can import them from a single barrel.
 *
 * Zones are physical injection points where widgets render. Core zones
 * (e.g. `main-after`) are declared at module load in the backend's
 * widget module; plugins declare additional zones through the
 * per-plugin facade exposed on `context.zones`.
 *
 * @module types/widget-zones
 */

export type {
    IZoneDescriptor,
    IDefineZoneOptions,
    ZoneHost,
    ZoneLayout,
    ZoneRegisterDisposer
} from './IZoneDescriptor.js';

export type {
    IZoneRegistry,
    IZoneSnapshot,
    IZoneSnapshotRecord
} from './IZoneRegistry.js';

export type { IPluginZones } from './IPluginZones.js';
