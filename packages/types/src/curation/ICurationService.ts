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

/** Summary of a registered curation type, for admin listing. */
export interface ICurationTypeInfo {
    /** Namespaced type id. */
    typeId: string;

    /** Human-readable label. */
    label: string;

    /** Id of the registering plugin or module. */
    providerId: string;
}

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
     * @param type - The type contract (describe / onApprove / onReject).
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
     * Approve a pending item: record the decision, then invoke the owning
     * type's `onApprove`. Returns null when the item is missing or no longer
     * pending, or when the owning type is unregistered (decision blocked).
     *
     * @param id - The envelope id.
     * @param decidedBy - Better Auth user id of the deciding curator.
     */
    approve(id: string, decidedBy?: string): Promise<ICurationItem | null>;

    /**
     * Reject a pending item: record the decision, then invoke the owning type's
     * `onReject`. Returns null under the same conditions as `approve`.
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
