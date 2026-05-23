/**
 * @fileoverview defineWidgetType factory for producing typed widget-type
 * descriptors.
 *
 * `defineWidgetType` is the only sanctioned way to construct an
 * `IWidgetType`. Every descriptor it produces is tracked in a
 * module-local set so the runtime registry can reject registration
 * of any descriptor that was not minted here. Plugins do not import
 * this function directly; they call
 * `context.widgetTypes.register(options)` and the facade invokes
 * `defineWidgetType` on their behalf.
 *
 * Mirrors the shape of `define-zone.ts` so the two registry pairs
 * read consistently.
 *
 * @module backend/modules/widgets/widget-types/define-widget-type
 */

import type { IWidgetType, IDefineWidgetTypeOptions } from '@/types';

/**
 * Tracked set of every descriptor minted by `defineWidgetType` in
 * this process.
 */
const KNOWN_WIDGET_TYPES: Map<string, IWidgetType> = new Map();

/**
 * Construct a frozen, runtime-tracked widget-type descriptor.
 *
 * Plugin code never invokes this function directly — the
 * `PluginWidgetTypes` facade constructs descriptors on the plugin's
 * behalf so the plugin id is tagged transparently and the lifecycle
 * window is enforced.
 *
 * @param options - Descriptor configuration.
 * @returns Frozen descriptor tracked in the known-type set.
 * @throws Error if a descriptor with the same id was already defined.
 */
export function defineWidgetType(options: IDefineWidgetTypeOptions): IWidgetType {
    if (KNOWN_WIDGET_TYPES.has(options.id)) {
        throw new Error(
            `Duplicate widget-type descriptor id: '${options.id}'. ` +
            `Widget-type ids must be unique across the process.`
        );
    }

    const descriptor: IWidgetType = Object.freeze({
        id: options.id,
        label: options.label,
        description: options.description,
        category: options.category,
        defaultDataFetcher: options.defaultDataFetcher,
        configSchema: options.configSchema
    });

    KNOWN_WIDGET_TYPES.set(options.id, descriptor);

    return descriptor;
}

/**
 * Test whether a descriptor was produced by `defineWidgetType` in
 * this process. The runtime registry calls this to refuse forged
 * descriptors that bypass the central constructor.
 *
 * @param descriptor - Candidate descriptor.
 * @returns True if the descriptor is tracked.
 */
export function isKnownWidgetType(descriptor: IWidgetType): boolean {
    const tracked = KNOWN_WIDGET_TYPES.get(descriptor.id);
    const result = tracked === descriptor;

    return result;
}

/**
 * Snapshot every descriptor known to the process, in stable id order.
 *
 * @returns Array of descriptors, sorted by id.
 */
export function listKnownWidgetTypes(): ReadonlyArray<IWidgetType> {
    const list = Array.from(KNOWN_WIDGET_TYPES.values()).sort((a, b) => a.id.localeCompare(b.id));

    return list;
}

/**
 * Forget a tracked descriptor.
 *
 * Called by the runtime registry when a type is disposed — either
 * through a single registration's disposer or through bulk
 * `disposeForPlugin` cleanup — so a future `defineWidgetType` call
 * with the same id mints a fresh descriptor rather than returning a
 * stale cached entry. Without this, a disable → re-enable cycle
 * would trip the duplicate-id guard the next time the plugin
 * declares its types. Same contract as `forgetZone` in the zone
 * subsystem.
 *
 * @param id - Widget-type id to forget.
 * @returns True if the descriptor was tracked and removed.
 */
export function forgetWidgetType(id: string): boolean {
    return KNOWN_WIDGET_TYPES.delete(id);
}

/**
 * Drop every tracked descriptor.
 *
 * Test-only utility. Production code never invokes this.
 */
export function __resetKnownWidgetTypesForTests(): void {
    KNOWN_WIDGET_TYPES.clear();

    return;
}
