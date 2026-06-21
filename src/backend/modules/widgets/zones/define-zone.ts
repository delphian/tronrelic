/**
 * @fileoverview defineZone factory for producing typed zone descriptors.
 *
 * `defineZone` is the only sanctioned way to construct an `IZoneDescriptor`.
 * Every descriptor it produces is tracked in a module-local set so the
 * runtime registry can reject registration of any descriptor that was
 * not minted here — preventing plugins from forging zones the runtime
 * does not recognise. Plugins do not import this function directly;
 * they call `context.zones.register(options)` and the facade invokes
 * `defineZone` on their behalf.
 *
 * @module backend/modules/widgets/zones/define-zone
 */

import type { IZoneDescriptor, IDefineZoneOptions } from '@/types';

/**
 * Tracked set of every descriptor minted by `defineZone` in this process.
 *
 * Keyed by id so the runtime can reject duplicate ids and look up the
 * descriptor for snapshot generation without coupling to the shape of
 * the central `ZONES` const.
 */
const KNOWN_ZONES: Map<string, IZoneDescriptor> = new Map();

/**
 * Construct a frozen, runtime-tracked zone descriptor.
 *
 * Layouts reference core zones by typed identifier — e.g.
 * `<WidgetZone descriptor={ZONES.mainAfter} />`. Plugin zones are
 * constructed transparently by the per-plugin facade, so plugin code
 * never invokes this function directly.
 *
 * @param options - Descriptor configuration. Defaults to
 *   `layout: 'vertical'` when omitted.
 * @returns Frozen descriptor tracked in the known-zone set.
 * @throws Error if a descriptor with the same id was already defined.
 */
export function defineZone(options: IDefineZoneOptions): IZoneDescriptor {
    if (KNOWN_ZONES.has(options.id)) {
        throw new Error(`Duplicate zone descriptor id: '${options.id}'. Zone ids must be unique across the process.`);
    }

    const descriptor: IZoneDescriptor = Object.freeze({
        id: options.id,
        label: options.label,
        description: options.description,
        host: options.host,
        layout: options.layout ?? 'vertical',
        order: options.order
    });

    KNOWN_ZONES.set(options.id, descriptor);

    return descriptor;
}

/**
 * Test whether a descriptor was produced by `defineZone` in this process.
 *
 * The runtime registry calls this to refuse registration of fabricated
 * descriptors that bypass the central constructor.
 *
 * @param descriptor - Candidate descriptor.
 * @returns True if the descriptor is tracked.
 */
export function isKnownZone(descriptor: IZoneDescriptor): boolean {
    const tracked = KNOWN_ZONES.get(descriptor.id);
    const result = tracked === descriptor;

    return result;
}

/**
 * Forget a tracked descriptor.
 *
 * Called by the runtime registry when a zone is disposed — either
 * through a single registration's disposer or through bulk
 * `disposeForPlugin` cleanup — so a future `defineZone` call with the
 * same id mints a fresh descriptor with fresh metadata rather than
 * returning a stale cached entry. Without this, a disable → re-enable
 * cycle would trip the duplicate-id guard the next time the plugin
 * declares its zones.
 *
 * No caller currently holds descriptor references across a
 * `disposeForPlugin` boundary, so dropping the cache entry does not
 * invalidate any live identity check. Core zones are not subject to
 * this path — `ZoneRegistry.disposeForPlugin` short-circuits on the
 * reserved `'core'` plugin id.
 *
 * @param id - Zone id to forget.
 * @returns True if the descriptor was tracked and removed.
 */
export function forgetZone(id: string): boolean {
    return KNOWN_ZONES.delete(id);
}

/**
 * Snapshot every descriptor known to the process, in stable id order.
 *
 * Used by the runtime registry's constructor to auto-populate core
 * declarations made via `defineZone` at module load — descriptors are
 * registered as `'core'`-owned without needing an explicit register
 * call site.
 *
 * @returns Array of descriptors, sorted by id.
 */
export function listKnownZones(): ReadonlyArray<IZoneDescriptor> {
    const list = Array.from(KNOWN_ZONES.values()).sort((a, b) => a.id.localeCompare(b.id));

    return list;
}

/**
 * Drop every tracked descriptor.
 *
 * Test-only utility. Production code never invokes this — descriptors
 * are defined once at module load and persist for the process lifetime.
 */
export function __resetKnownZonesForTests(): void {
    KNOWN_ZONES.clear();

    return;
}
