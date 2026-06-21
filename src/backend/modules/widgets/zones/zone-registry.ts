/**
 * @fileoverview Runtime widget zone registry implementation.
 *
 * Concrete `IZoneRegistry` backed by a Map of zone id → registered
 * entry. Auto-populates from descriptors `defineZone` has tracked at
 * module load (core zones), accepts plugin-declared zones through
 * `register(...)`, validates the descriptor-identity check that proves
 * a descriptor was minted via `defineZone`, and produces the snapshot
 * consumed by the `/api/admin/system/zones` endpoint.
 *
 * Mirrors `HookRegistry` in shape and semantics — see
 * `src/backend/hooks/hook-registry.ts` for the pattern.
 *
 * @see {@link ../../../../docs/plugins/plugins-widget-zones.md} for the
 *   conceptual contract.
 * @module backend/modules/widgets/zones/zone-registry
 */

import type {
    IZoneDescriptor,
    IZoneRegistry,
    IZoneSnapshot,
    IZoneSnapshotRecord,
    ZoneHost,
    ZoneRegisterDisposer,
    ISystemLogService
} from '@/types';
import { forgetZone, isKnownZone, listKnownZones } from './define-zone.js';

const RESERVED_PLUGIN_ID = 'core';

/**
 * Display labels and order for each zone host, used by the admin
 * snapshot. Hosts not in this list will not appear in the snapshot —
 * adding a new host requires extending this table.
 */
const HOST_TRACKS: ReadonlyArray<{ id: ZoneHost; label: string }> = [
    { id: 'site', label: 'Site-wide' },
    { id: 'core', label: 'Core pages' },
    { id: 'plugin', label: 'Plugin pages' },
    { id: 'admin', label: 'Admin pages' }
];

interface IRegisteredZone {
    readonly descriptor: IZoneDescriptor;
    readonly pluginId: string;
    readonly registeredAt: number;
    readonly source: string | null;
}

/**
 * Map-backed zone registry. One instance per process; constructed
 * during bootstrap, threaded into the plugin context via the per-plugin
 * facade, and queried by `WidgetService` validation and the admin
 * introspection endpoint.
 */
export class ZoneRegistry implements IZoneRegistry {
    /** Registered zones keyed by zone id. */
    private readonly zones: Map<string, IRegisteredZone> = new Map();

    /**
     * Construct a registry.
     *
     * Auto-populates from every descriptor `defineZone` has tracked up
     * to this moment, tagging each with `pluginId: 'core'`. Subsequent
     * plugin-declared zones flow in via `register(pluginId, descriptor)`.
     *
     * @param logger - System logger used for registration and disposal
     *   diagnostics.
     */
    constructor(private readonly logger: ISystemLogService) {
        const now = Date.now();
        for (const descriptor of listKnownZones()) {
            this.zones.set(descriptor.id, {
                descriptor,
                pluginId: RESERVED_PLUGIN_ID,
                registeredAt: now,
                source: null
            });
        }

        this.logger.debug(
            { coreZoneCount: this.zones.size },
            'Zone registry initialised with core descriptors'
        );
    }

    /**
     * Register a declared zone owned by the given plugin (or core).
     *
     * Validates that the descriptor was minted by `defineZone` and that
     * no other component has already claimed the id. Returns a disposer
     * that removes the zone from the registry — plugin disposers are
     * collected by the per-plugin facade so `disable()` drops them in
     * bulk.
     *
     * @param pluginId - Plugin id (or `'core'`) registering the zone.
     * @param descriptor - Descriptor minted by `defineZone`.
     * @returns Disposer that removes the registration.
     * @throws Error if the descriptor is unknown or the zone is already
     *   claimed by a different plugin.
     */
    register(pluginId: string, descriptor: IZoneDescriptor): ZoneRegisterDisposer {
        if (!pluginId || typeof pluginId !== 'string') {
            throw new Error('Zone registration requires a non-empty pluginId.');
        }
        if (!descriptor || typeof descriptor.id !== 'string') {
            throw new Error('Zone registration requires a valid descriptor.');
        }
        if (!isKnownZone(descriptor)) {
            throw new Error(
                `Zone descriptor '${descriptor.id}' was not produced by defineZone. ` +
                `Construct it through the central factory before registering.`
            );
        }

        const existing = this.zones.get(descriptor.id);
        if (existing && existing.pluginId !== pluginId) {
            throw new Error(
                `Zone '${descriptor.id}' is already declared by '${existing.pluginId}'. ` +
                `Zone ids are exclusive to their declaring component.`
            );
        }

        const record: IRegisteredZone = {
            descriptor,
            pluginId,
            registeredAt: Date.now(),
            source: captureRegistrationSource()
        };

        this.zones.set(descriptor.id, record);

        this.logger.debug(
            { zoneId: descriptor.id, pluginId, host: descriptor.host },
            'Zone registered'
        );

        return () => {
            const cur = this.zones.get(descriptor.id);
            if (!cur || cur !== record) return;
            this.zones.delete(descriptor.id);
            forgetZone(descriptor.id);
            this.logger.debug({ zoneId: descriptor.id, pluginId }, 'Zone unregistered');
        };
    }

    /**
     * Remove every zone declared by the given plugin.
     *
     * Core-owned zones (`pluginId === 'core'`) are never affected;
     * bulk disposal is plugin-scoped only.
     *
     * @param pluginId - Plugin whose zones should be removed.
     * @returns Count of zones removed.
     */
    disposeForPlugin(pluginId: string): number {
        if (pluginId === RESERVED_PLUGIN_ID) {
            return 0;
        }
        let removed = 0;
        for (const [id, entry] of this.zones) {
            if (entry.pluginId === pluginId) {
                this.zones.delete(id);
                forgetZone(id);
                removed++;
            }
        }
        if (removed > 0) {
            this.logger.info({ pluginId, removed }, 'Zones disposed for plugin');
        }

        return removed;
    }

    /**
     * Check whether a zone id is registered.
     *
     * @param zoneId - Zone id to check.
     * @returns True if registered.
     */
    has(zoneId: string): boolean {
        return this.zones.has(zoneId);
    }

    /**
     * Retrieve the snapshot record for a single zone.
     *
     * @param zoneId - Zone id to look up.
     * @returns Snapshot record or `undefined`.
     */
    get(zoneId: string): IZoneSnapshotRecord | undefined {
        const entry = this.zones.get(zoneId);
        if (!entry) return undefined;

        return toSnapshotRecord(entry);
    }

    /**
     * Produce the introspection snapshot consumed by the admin endpoint.
     *
     * Groups every registered zone by host so the placement editor
     * renders the catalog without re-grouping. Within a host track zones
     * sort by their descriptor `order` (lower first) so the editor lists
     * them in page top-to-bottom order — e.g. the site footer, declared
     * with a higher order, follows the block-ticker zone rather than
     * leading the track alphabetically. Zones omitting `order` sort after
     * explicitly-ordered ones, with id as the stable tie-breaker so the
     * timeline shape stays deterministic across deployments. Empty hosts
     * still appear to keep the track shape stable.
     *
     * @returns Structured payload ready for JSON serialization.
     */
    snapshot(): IZoneSnapshot {
        const byHost: Map<ZoneHost, IRegisteredZone[]> = new Map();
        for (const track of HOST_TRACKS) {
            byHost.set(track.id, []);
        }

        for (const entry of this.zones.values()) {
            const bucket = byHost.get(entry.descriptor.host);
            if (!bucket) continue;
            bucket.push(entry);
        }

        const tracks = HOST_TRACKS.map(track => ({
            id: track.id,
            label: track.label,
            zones: (byHost.get(track.id) ?? [])
                .sort((a, b) => zoneOrder(a) - zoneOrder(b) || a.descriptor.id.localeCompare(b.descriptor.id))
                .map(toSnapshotRecord)
        }));

        return { tracks };
    }
}

/**
 * Resolve a registered zone's sort weight for the admin snapshot.
 *
 * Zones declare an optional `order` to control where they sit within
 * their host track; the snapshot sorts ascending so lower renders first.
 * Zones that omit it fall to the end of the track (a large sentinel)
 * rather than the front, so an unordered plugin zone never jumps ahead
 * of a deliberately-placed core zone — id breaks the remaining ties.
 *
 * @param entry - Internal registered-zone record.
 * @returns Numeric sort weight; `Number.MAX_SAFE_INTEGER` when unset.
 */
function zoneOrder(entry: IRegisteredZone): number {
    return typeof entry.descriptor.order === 'number' ? entry.descriptor.order : Number.MAX_SAFE_INTEGER;
}

/**
 * Render a registered entry as a snapshot record. Pure mapping with no
 * registry dependency so callers can reuse it inside tests.
 *
 * @param entry - Internal registered-zone record.
 * @returns Public snapshot shape.
 */
function toSnapshotRecord(entry: IRegisteredZone): IZoneSnapshotRecord {
    return {
        id: entry.descriptor.id,
        label: entry.descriptor.label,
        description: entry.descriptor.description,
        host: entry.descriptor.host,
        layout: entry.descriptor.layout,
        pluginId: entry.pluginId,
        registeredAt: new Date(entry.registeredAt).toISOString(),
        source: entry.source
    };
}

/**
 * Best-effort source-file capture from a stack trace, skipping frames
 * inside the registry itself and node_modules. Returns `null` when the
 * trace is missing or unparseable — the admin UI tolerates `null` and
 * renders the registration without a deep link.
 *
 * @returns A `file:line:col` string or `null`.
 */
function captureRegistrationSource(): string | null {
    const stack = new Error().stack;
    if (!stack) return null;
    const lines = stack.split('\n');
    for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.includes('/widgets/zones/') || line.includes('node_modules')) continue;
        const match = line.match(/\((.+:\d+:\d+)\)/) || line.match(/at (.+:\d+:\d+)$/);
        if (match) {
            return match[1];
        }
    }

    return null;
}

export { RESERVED_PLUGIN_ID };
