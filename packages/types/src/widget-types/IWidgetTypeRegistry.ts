/**
 * @fileoverview Global widget-type registry interface.
 *
 * The widget-type registry stores every declared type — currently only
 * plugin-declared (no core widget types exist) — and serves the
 * introspection snapshot consumed by the `/api/admin/system/widget-types`
 * endpoint. There is one instance per process, constructed during
 * bootstrap and threaded into plugin contexts the same way the hook
 * and zone registries are.
 *
 * Plugins do not call the registry directly. They receive an
 * `IPluginWidgetTypes` facade scoped to their plugin id which tags
 * every registration and tracks disposers for lifecycle cleanup.
 *
 * @module types/widget-types/IWidgetTypeRegistry
 */

import type { JSONSchema7 } from 'json-schema';
import type { IWidgetType, WidgetTypeRegisterDisposer } from './IWidgetType.js';

/**
 * Introspection record for a single registered widget type.
 */
export interface IWidgetTypeSnapshotRecord {
    /** Dotted id from the descriptor. */
    readonly id: string;
    /** Short label. */
    readonly label: string;
    /** Sentence-length description. */
    readonly description: string;
    /** Optional category for palette grouping. */
    readonly category: string | null;
    /** Plugin id that declared the type, or `'core'`. */
    readonly pluginId: string;
    /** ISO-8601 timestamp the type was registered with the runtime. */
    readonly registeredAt: string;
    /**
     * Best-effort source location captured at registration time. May
     * be `null` when the runtime cannot resolve a callsite.
     */
    readonly source: string | null;
    /**
     * The type's declared JSON Schema Draft 7 for `instanceConfig`,
     * forwarded verbatim from the descriptor so the placement editor
     * can render schema-aware form fields and validate operator input
     * before save. Absent when the type declares no schema (the editor
     * then falls back to a free-form JSON object).
     */
    readonly configSchema?: JSONSchema7;
}

/**
 * Top-level introspection payload returned from `snapshot()` and
 * served by the admin endpoint. Types are grouped by plugin so the
 * placement editor can render the palette organised by source.
 */
export interface IWidgetTypeSnapshot {
    /** Groups in display order, one per declaring plugin. */
    readonly groups: ReadonlyArray<{
        readonly pluginId: string;
        readonly types: ReadonlyArray<IWidgetTypeSnapshotRecord>;
    }>;
}

/**
 * Process-wide widget-type registry. Implementations are responsible
 * for storing declared types, enforcing the descriptor-identity check,
 * detecting cross-plugin id conflicts, and producing the snapshot
 * consumed by introspection.
 */
export interface IWidgetTypeRegistry {
    /**
     * Register a declared widget type.
     *
     * The descriptor must have been produced by `defineWidgetType`;
     * the runtime tracks every minted descriptor and refuses forged
     * objects. If a type with the same id is already registered to a
     * different plugin, the call throws — type ids are exclusive to
     * their declaring component.
     *
     * @param pluginId - Plugin (or `'core'`) declaring the type.
     * @param descriptor - Descriptor minted by `defineWidgetType`.
     * @returns Disposer that removes the type from the registry.
     */
    register(pluginId: string, descriptor: IWidgetType): WidgetTypeRegisterDisposer;

    /**
     * Drop every widget type declared by the given plugin.
     *
     * @param pluginId - Plugin whose types should be removed.
     * @returns Count of types removed.
     */
    disposeForPlugin(pluginId: string): number;

    /**
     * Check whether a widget-type id is currently registered.
     *
     * @param typeId - Type id to check.
     * @returns True if the type is registered.
     */
    has(typeId: string): boolean;

    /**
     * Retrieve the registered descriptor for a type by id. Returns
     * `undefined` when no type with that id is registered. Used by
     * the placement resolver to look up the data fetcher.
     *
     * @param typeId - Type id to look up.
     * @returns Descriptor or `undefined`.
     */
    get(typeId: string): IWidgetType | undefined;

    /**
     * Return the plugin id that currently owns the given widget-type
     * id, or `undefined` when the id is not registered.
     *
     * Used by the legacy `WidgetService` compatibility shim to
     * distinguish three cases when a plugin registers a widget:
     *
     * - Owner equals the current plugin — same-plugin re-registration
     *   (hot reload). Skip the registry call to avoid the
     *   `defineWidgetType` duplicate-id throw; the existing
     *   descriptor stays in place.
     * - Owner is `undefined` — fresh registration. Mint a descriptor
     *   and register it.
     * - Owner is some other plugin — cross-plugin id collision.
     *   Refuse to create the placement to prevent the new plugin's
     *   placement from silently inheriting the first plugin's
     *   data fetcher.
     *
     * @param typeId - Type id to query.
     * @returns Owning plugin id, or `undefined` if unregistered.
     */
    getOwnerPluginId(typeId: string): string | undefined;

    /**
     * Produce the introspection snapshot consumed by the admin
     * endpoint. The snapshot groups every registered type by
     * declaring plugin.
     */
    snapshot(): IWidgetTypeSnapshot;
}
