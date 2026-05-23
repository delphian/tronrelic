/**
 * @fileoverview Global widget zone registry interface.
 *
 * The zone registry stores every declared zone — core declarations made
 * via `defineZone` at module load and plugin declarations made through
 * the per-plugin facade — and serves the introspection snapshot consumed
 * by the `/api/admin/system/zones` endpoint. There is one instance per
 * process, constructed during bootstrap and threaded into plugin
 * contexts the same way the hook registry is.
 *
 * Plugins do not call the registry directly. They receive an
 * `IPluginZones` facade scoped to their plugin id which tags every
 * registration and tracks disposers for lifecycle cleanup.
 *
 * @module types/widget-zones/IZoneRegistry
 */

import type { IZoneDescriptor, IDefineZoneOptions, ZoneRegisterDisposer, ZoneHost } from './IZoneDescriptor.js';

/**
 * Introspection record for a single registered zone. Surfaced through
 * the admin endpoint so the placement editor can render the available
 * zones alongside their owner and registration time.
 */
export interface IZoneSnapshotRecord {
    /** Dotted id from the descriptor. */
    readonly id: string;
    /** Short label. */
    readonly label: string;
    /** Sentence-length description. */
    readonly description: string;
    /** Layout context. */
    readonly host: ZoneHost;
    /** Visual layout hint. */
    readonly layout: 'vertical' | 'horizontal' | 'grid';
    /** Plugin id that declared the zone, or `'core'`. */
    readonly pluginId: string;
    /** ISO-8601 timestamp the zone was registered with the runtime. */
    readonly registeredAt: string;
    /**
     * Best-effort source location captured at registration time. May be
     * `null` when the runtime cannot resolve a callsite — for example
     * when the zone is declared via `defineZone` at module load and the
     * registry auto-populates it on construction.
     */
    readonly source: string | null;
}

/**
 * Top-level introspection payload returned from `snapshot()` and served
 * by the admin endpoint. Zones are grouped by host so the placement
 * editor can render the catalog organised by rendering context.
 */
export interface IZoneSnapshot {
    /** Tracks in display order, one per zone host. */
    readonly tracks: ReadonlyArray<{
        readonly id: ZoneHost;
        readonly label: string;
        readonly zones: ReadonlyArray<IZoneSnapshotRecord>;
    }>;
}

/**
 * Process-wide zone registry. Implementations are responsible for
 * storing declared zones, enforcing the descriptor-identity check,
 * detecting cross-plugin conflicts, and producing the snapshot consumed
 * by introspection.
 */
export interface IZoneRegistry {
    /**
     * Register a declared zone.
     *
     * Core declarations are typically auto-populated by the registry
     * constructor from the descriptors `defineZone` has tracked at
     * module load. Plugin declarations flow through the per-plugin
     * facade, which calls `register` with the plugin's id.
     *
     * The descriptor must have been produced by `defineZone`; the
     * runtime tracks every minted descriptor and refuses forged
     * objects. If a zone with the same id is already registered to a
     * different plugin, the call throws — zones are owned exclusively
     * by their declaring component.
     *
     * @param pluginId - Plugin (or `'core'`) declaring the zone.
     * @param descriptor - Zone descriptor produced by `defineZone`.
     * @returns Disposer that removes the zone from the registry.
     */
    register(pluginId: string, descriptor: IZoneDescriptor): ZoneRegisterDisposer;

    /**
     * Drop every zone declared by the given plugin.
     *
     * Called when a plugin is disabled or uninstalled. Core zones are
     * never affected — `'core'` ownership is not subject to bulk
     * disposal.
     *
     * @param pluginId - Plugin whose zones should be removed.
     * @returns Count of zones removed.
     */
    disposeForPlugin(pluginId: string): number;

    /**
     * Check whether a zone id is currently registered.
     *
     * Used by the placement service to validate widget placements at
     * creation time. A placement targeting an unknown zone is rejected
     * by the API; at SSR resolution time, an unknown zone causes the
     * placement to be skipped silently so a plugin disable does not
     * crash the page.
     *
     * @param zoneId - Zone id to check.
     * @returns True if the zone is registered.
     */
    has(zoneId: string): boolean;

    /**
     * Retrieve the registered descriptor for a zone, with ownership
     * metadata. Returns `undefined` when no zone with that id is
     * registered.
     *
     * @param zoneId - Zone id to look up.
     * @returns Snapshot record or `undefined`.
     */
    get(zoneId: string): IZoneSnapshotRecord | undefined;

    /**
     * Produce the introspection snapshot consumed by the admin endpoint.
     *
     * The snapshot enumerates every registered zone grouped by host so
     * the placement editor can render the catalog without re-grouping.
     *
     * @returns Structured payload ready for JSON serialization.
     */
    snapshot(): IZoneSnapshot;
}

// Re-export the options type so consumers importing IZoneRegistry can
// reach IDefineZoneOptions without a separate import.
export type { IDefineZoneOptions };
