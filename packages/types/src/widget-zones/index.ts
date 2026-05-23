/**
 * @fileoverview Public type surface for the widget zone system.
 *
 * Zones are physical injection points where widgets render. Core
 * zones are declared at module load in `backend/modules/widgets`;
 * plugins declare additional zones through
 * `IWidgetsService.registerZone(...)` on the `'widgets'` service.
 * The `IZoneRegistry` interface is internal to the widgets module —
 * the public surface is `IWidgetsService`.
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
