/**
 * @file IContentRegistry.ts
 *
 * The central registry of content types. One home where any provider publishes
 * an {@link IContentType} and any pipeline — curation, notifications, audit —
 * discovers it by id. Centralizing the registry is what lets a content type be
 * authored once and reused across pipelines, and is the single place the
 * platform's accountability and record-keeping requirements attach to a
 * content type's existence.
 *
 * Registration is code, declared at boot or on plugin enable, the same way a
 * curation type or hook descriptor is declared. The registry holds the live set
 * for the process lifetime; persisted state (decisions, audit) lives elsewhere
 * and references content types by `typeId`.
 */

import type { IContentType } from './IContentType.js';

/**
 * Disposer returned by {@link IContentRegistry.register}. A plugin calls it from
 * `disable()` so its content types vanish when the plugin is turned off; modules
 * register for the process lifetime and keep it only for symmetry.
 */
export type ContentTypeDisposer = () => void;

/**
 * Summary of a registered content type, for admin listing and cross-pipeline
 * introspection without exposing the type's callbacks.
 */
export interface IContentTypeInfo {
    /** Namespaced content type id. */
    typeId: string;

    /** Human-readable label. */
    label: string;

    /** Id of the registering plugin or module. */
    providerId: string;
}

/**
 * Registration and lookup for content types. Providers register on `init()`
 * and unregister on `disable()`; pipelines resolve a type by id to render or
 * act on its content.
 */
export interface IContentRegistry {
    /**
     * Register (or replace) a content type. A later registration for the same
     * id replaces the earlier one (a plugin hot-reload or re-enable).
     *
     * @param type - The content type contract.
     * @param providerId - Id of the registering plugin or module.
     * @returns A disposer that unregisters this exact registration.
     */
    register(type: IContentType, providerId: string): ContentTypeDisposer;

    /**
     * Resolve a registered content type.
     *
     * @param typeId - The namespaced content type id.
     * @returns The type, or undefined when no owner is registered.
     */
    get(typeId: string): IContentType | undefined;

    /**
     * Whether a content type is registered right now.
     *
     * @param typeId - The namespaced content type id.
     * @returns True when an owner is registered.
     */
    has(typeId: string): boolean;

    /** List all registered content types for admin and introspection surfaces. */
    list(): IContentTypeInfo[];
}
