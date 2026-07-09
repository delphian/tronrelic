/**
 * @file ICurationService.ts
 *
 * The central curation surface. It splits into two responsibilities: a
 * registry (`ICurationRegistry`) where providers publish reviewable types and
 * the governor verifies an AI tool's `curationTypeId` binding, and the queue
 * operations (`ICurationService`) that producers and the admin dashboard use to
 * hold, list, and decide items. Core publishes one `'curation'` service that
 * implements the combined contract.
 */

import type { ICurationItem } from './ICurationItem.js';
import type { ICurationType, ICurationEditPatch } from './ICurationType.js';
import type {
    ICurationDestinationSelection,
    ICurationEligibleDestination
} from './ICurationDestination.js';
import type { IContentTypeInfo } from '../content/IContentRegistry.js';

/**
 * Summary of a registered curation type, for admin listing. Curation adds no
 * fields beyond the shared {@link IContentTypeInfo}, so it is retained as an
 * alias — the curation registry and the central content registry describe a
 * registered type identically.
 */
export type ICurationTypeInfo = IContentTypeInfo;

/** What a producer passes to `hold()` to enqueue an effect for review. */
export interface ICurationHoldInput {
    /** Namespaced id of a registered curation type. */
    typeId: string;

    /** Opaque pointer the owning type resolves back to its own record. */
    ref: Record<string, unknown>;

    /** Optional attribution of what produced the effect (e.g. a tool name). */
    source?: string;
}

/**
 * Type registration and lookup. Providers register on `init()` and unregister
 * on `disable()`; the governor calls `hasType()` to verify that an AI tool's
 * declared `curationTypeId` resolves to a live type before relaxing its gates.
 */
export interface ICurationRegistry {
    /**
     * Register a reviewable content type.
     *
     * @param type - The type contract (describe / applyEdit / decisionStatus).
     * @param providerId - Id of the registering plugin or module.
     */
    registerType(type: ICurationType, providerId: string): void;

    /**
     * Unregister a type. Held items of this type remain in the queue but cannot
     * be decided until the type re-registers (the disabled-owner case).
     *
     * @param typeId - The namespaced type id.
     * @returns True if a type was removed.
     */
    unregisterType(typeId: string): boolean;

    /**
     * Resolve a registered type.
     *
     * @param typeId - The namespaced type id.
     * @returns The type, or undefined when no owner is registered.
     */
    getType(typeId: string): ICurationType | undefined;

    /**
     * Whether a type is registered right now. The governor's binding check.
     *
     * @param typeId - The namespaced type id.
     */
    hasType(typeId: string): boolean;

    /** List all registered types for the admin dashboard. */
    listTypes(): ICurationTypeInfo[];
}

/**
 * The full curation service: type registration plus the queue lifecycle. Core
 * publishes this as the `'curation'` service on the service registry.
 */
export interface ICurationService extends ICurationRegistry {
    /**
     * Hold an effect for review. Core resolves the type, caches a preview via
     * `describe()`, persists the envelope as `pending`, and returns it. The
     * envelope's `providerId` is the registered type's owner — the provider that
     * must be present to render or commit the item; record the producer's
     * identity in `input.source`. Throws when the `typeId` is not registered.
     *
     * @param input - The type id, opaque ref, and optional attribution.
     * @returns The stored pending envelope.
     */
    hold(input: ICurationHoldInput): Promise<ICurationItem>;

    /**
     * List pending items newest-first for the admin queue.
     *
     * @param limit - Maximum items to return.
     */
    listPending(limit?: number): Promise<ICurationItem[]>;

    /** Count pending items — drives the dashboard badge. */
    countPending(): Promise<number>;

    /**
     * Fetch one item by id.
     *
     * @param id - The envelope id.
     * @returns The item, or null when absent.
     */
    get(id: string): Promise<ICurationItem | null>;

    /**
     * Approve a pending item: record the decision, deliver to any selected
     * destinations, then commit the decision through the type's
     * `applyEdit({ status })` seam. Returns null when the item is missing or no
     * longer pending, or when the owning type is unregistered (decision blocked).
     *
     * `destinations` is the curator's mandated subset for a type that publishes
     * to destinations: each entry must be one of the item's eligible publish
     * sinks (see {@link listEligibleDestinations}). The selection is persisted
     * with the decision and delivered before the decision commits; per-destination
     * outcomes land on the returned item's `destinations`. Omit it for the
     * classic single-effect approval.
     *
     * @param id - The envelope id.
     * @param decidedBy - Better Auth user id of the deciding curator.
     * @param destinations - The curator-selected publish sinks to deliver to.
     */
    approve(
        id: string,
        decidedBy?: string,
        destinations?: ICurationDestinationSelection[]
    ): Promise<ICurationItem | null>;

    /**
     * The publish sinks the content router admits for a pending item's content
     * type, each flagged with whether standing policy pre-selects it. Drives the
     * curation destination picker. Returns an empty list when the item is missing
     * or not pending, its type does not publish to destinations, or no publish
     * sink is eligible — so a caller renders a picker only when there is
     * something to pick.
     *
     * @param id - The pending envelope id.
     * @returns The eligible publish destinations for the item.
     */
    listEligibleDestinations(id: string): Promise<ICurationEligibleDestination[]>;

    /**
     * Read the standing default destination sink ids for a content type — the
     * subset the picker pre-selects. Empty when no default is set.
     *
     * @param typeId - The namespaced content type id.
     * @returns The default sink ids, or an empty array.
     */
    getDestinationDefaults(typeId: string): Promise<string[]>;

    /**
     * Set the standing default destination sink ids for a content type, so an
     * operator redirects a whole type's default destinations as policy data
     * without a code change. The next item of that type pre-selects them.
     *
     * @param typeId - The namespaced content type id.
     * @param sinkIds - The sink ids to pre-select by default.
     */
    setDestinationDefaults(typeId: string, sinkIds: string[]): Promise<void>;

    /**
     * Reject a pending item: record the decision, then commit it through the
     * type's `applyEdit({ status })` seam. Returns null under the same conditions
     * as `approve`.
     *
     * @param id - The envelope id.
     * @param decidedBy - Better Auth user id of the deciding curator.
     */
    reject(id: string, decidedBy?: string): Promise<ICurationItem | null>;

    /**
     * Apply an operator's inline edit to a pending item through its owning type,
     * then re-derive and cache the preview. Returns the updated item, or null
     * when the item is missing, no longer pending, its owner is unregistered, or
     * the type is not editable (no `applyEdit`). The owning type validates the
     * patch and may throw — callers should surface that error.
     *
     * @param id - The envelope id.
     * @param patch - The generic, payload-agnostic edit.
     * @param editedBy - Better Auth user id of the editing operator.
     */
    edit(id: string, patch: ICurationEditPatch, editedBy?: string): Promise<ICurationItem | null>;
}
