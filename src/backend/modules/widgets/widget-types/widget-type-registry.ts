/**
 * @fileoverview Runtime widget-type registry implementation.
 *
 * Concrete `IWidgetTypeRegistry` backed by a Map of widget-type id →
 * registered entry. Accepts plugin-declared types through `register`,
 * validates the descriptor-identity check that proves a descriptor
 * was minted via `defineWidgetType`, and produces the snapshot
 * consumed by the `/api/admin/system/widget-types` endpoint.
 *
 * Mirrors `ZoneRegistry` in shape and semantics — see
 * `src/backend/modules/widgets/zones/zone-registry.ts` for the
 * pattern reference.
 *
 * @module backend/modules/widgets/widget-types/widget-type-registry
 */

import type {
    IWidgetType,
    IWidgetTypeRegistry,
    IWidgetTypeSnapshot,
    IWidgetTypeSnapshotRecord,
    WidgetTypeRegisterDisposer,
    ISystemLogService
} from '@/types';
import { forgetWidgetType, isKnownWidgetType } from './define-widget-type.js';

const RESERVED_PLUGIN_ID = 'core';

interface IRegisteredWidgetType {
    readonly descriptor: IWidgetType;
    readonly pluginId: string;
    readonly registeredAt: number;
    readonly source: string | null;
}

/**
 * Map-backed widget-type registry. One instance per process,
 * constructed during bootstrap and threaded into the plugin context
 * via the per-plugin facade as well as into `WidgetsModule` so the
 * placement resolver can look up types at SSR time.
 */
export class WidgetTypeRegistry implements IWidgetTypeRegistry {
    private readonly types: Map<string, IRegisteredWidgetType> = new Map();

    constructor(private readonly logger: ISystemLogService) {}

    /**
     * Register a declared widget type.
     *
     * Validates that the descriptor was minted by `defineWidgetType`
     * and that no other plugin has already claimed the id.
     *
     * @param pluginId - Plugin id (or `'core'`) registering the type.
     * @param descriptor - Descriptor minted by `defineWidgetType`.
     * @returns Disposer that removes the registration.
     */
    register(pluginId: string, descriptor: IWidgetType): WidgetTypeRegisterDisposer {
        if (!pluginId || typeof pluginId !== 'string') {
            throw new Error('Widget-type registration requires a non-empty pluginId.');
        }
        if (!descriptor || typeof descriptor.id !== 'string') {
            throw new Error('Widget-type registration requires a valid descriptor.');
        }
        if (!isKnownWidgetType(descriptor)) {
            throw new Error(
                `Widget-type descriptor '${descriptor.id}' was not produced by defineWidgetType. ` +
                `Construct it through the central factory before registering.`
            );
        }

        const existing = this.types.get(descriptor.id);
        if (existing && existing.pluginId !== pluginId) {
            throw new Error(
                `Widget type '${descriptor.id}' is already declared by '${existing.pluginId}'. ` +
                `Type ids are exclusive to their declaring component.`
            );
        }

        const record: IRegisteredWidgetType = {
            descriptor,
            pluginId,
            registeredAt: Date.now(),
            source: captureRegistrationSource()
        };

        this.types.set(descriptor.id, record);

        this.logger.debug(
            { widgetTypeId: descriptor.id, pluginId },
            'Widget type registered'
        );

        return () => {
            const cur = this.types.get(descriptor.id);
            if (!cur || cur !== record) return;
            this.types.delete(descriptor.id);
            forgetWidgetType(descriptor.id);
            this.logger.debug(
                { widgetTypeId: descriptor.id, pluginId },
                'Widget type unregistered'
            );
        };
    }

    /**
     * Remove every widget type declared by the given plugin.
     *
     * Core-owned types (`pluginId === 'core'`) are never affected.
     *
     * @param pluginId - Plugin whose types should be removed.
     * @returns Count of types removed.
     */
    disposeForPlugin(pluginId: string): number {
        if (pluginId === RESERVED_PLUGIN_ID) {
            return 0;
        }
        let removed = 0;
        for (const [id, entry] of this.types) {
            if (entry.pluginId === pluginId) {
                this.types.delete(id);
                forgetWidgetType(id);
                removed++;
            }
        }
        if (removed > 0) {
            this.logger.info({ pluginId, removed }, 'Widget types disposed for plugin');
        }

        return removed;
    }

    /**
     * Check whether a widget-type id is registered.
     */
    has(typeId: string): boolean {
        return this.types.has(typeId);
    }

    /**
     * Retrieve the live descriptor for a widget type. Returns
     * `undefined` when no type with that id is registered. Used by
     * the placement resolver to look up the data fetcher at SSR
     * time.
     */
    get(typeId: string): IWidgetType | undefined {
        const entry = this.types.get(typeId);
        return entry?.descriptor;
    }

    /**
     * Return the plugin id that currently owns the given widget-type
     * id, or `undefined` when unregistered. See `IWidgetTypeRegistry`
     * JSDoc for the three-way decision the compat shim uses this for.
     */
    getOwnerPluginId(typeId: string): string | undefined {
        const entry = this.types.get(typeId);
        return entry?.pluginId;
    }

    /**
     * Produce the introspection snapshot consumed by the admin
     * endpoint. Groups every registered type by declaring plugin.
     */
    snapshot(): IWidgetTypeSnapshot {
        const byPlugin: Map<string, IWidgetTypeSnapshotRecord[]> = new Map();

        for (const entry of this.types.values()) {
            const bucket = byPlugin.get(entry.pluginId) ?? [];
            bucket.push({
                id: entry.descriptor.id,
                label: entry.descriptor.label,
                description: entry.descriptor.description,
                category: entry.descriptor.category ?? null,
                pluginId: entry.pluginId,
                registeredAt: new Date(entry.registeredAt).toISOString(),
                source: entry.source
            });
            byPlugin.set(entry.pluginId, bucket);
        }

        const groups = Array.from(byPlugin.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([pluginId, types]) => ({
                pluginId,
                types: types.sort((a, b) => a.id.localeCompare(b.id))
            }));

        return { groups };
    }
}

/**
 * Best-effort source-file capture, skipping frames inside the
 * registry itself.
 */
function captureRegistrationSource(): string | null {
    const stack = new Error().stack;
    if (!stack) return null;
    const lines = stack.split('\n');
    for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.includes('/widgets/widget-types/') || line.includes('node_modules')) continue;
        const match = line.match(/\((.+:\d+:\d+)\)/) || line.match(/at (.+:\d+:\d+)$/);
        if (match) {
            return match[1];
        }
    }

    return null;
}

export { RESERVED_PLUGIN_ID };
