/**
 * @fileoverview Global hook registry interface.
 *
 * The hook registry stores per-plugin handler registrations against
 * declared descriptors, exposes a typed invoker that core uses to fire
 * each seam, and serves the introspection snapshot consumed by the
 * `/api/admin/system/hooks` endpoint. There is one instance per process,
 * constructed during bootstrap and threaded into plugin contexts the
 * same way the service registry is.
 *
 * Plugins do not call the registry directly — they receive a scoped
 * facade (`IPluginHooks`) that tags every registration with the plugin
 * id, enforces per-plugin handler caps, and returns disposables for
 * lifecycle cleanup. This file describes the underlying registry the
 * facade delegates to.
 *
 * @module types/hooks/IHookRegistry
 */

import type { HookDescriptor, HookHandler, HookKind } from './HookDescriptor.js';

/**
 * Options accepted when registering a handler against a hook.
 */
export interface IHookRegisterOptions {
    /**
     * Execution priority among handlers registered against the same hook.
     * Lower numbers run first. Default is `100`. Ties are broken by
     * registration timestamp so behavior is deterministic.
     */
    priority?: number;
}

/**
 * Disposer returned from registration. Calling it removes the handler
 * from the registry. Plugins should retain the disposer and invoke it
 * from `disable()` — the per-plugin facade collects them automatically.
 */
export type HookRegisterDisposer = () => void;

/**
 * Introspection record describing one registered handler.
 *
 * Surfaced verbatim through the admin endpoint so the timeline UI can
 * render handler lists without further server-side shaping.
 */
export interface IHookHandlerRecord {
    /** Plugin id that registered the handler. */
    readonly pluginId: string;
    /** Execution priority (lower = earlier). */
    readonly priority: number;
    /** ISO-8601 timestamp of registration. */
    readonly registeredAt: string;
    /**
     * Best-effort source location captured at registration time, for
     * the admin UI's deep links. May be `null` when the runtime cannot
     * resolve a callsite.
     */
    readonly source: string | null;
}

/**
 * Introspection record for a single declared hook.
 */
export interface IHookSnapshotRecord {
    /** Dotted id from the descriptor. */
    readonly id: string;
    /** Hook archetype. */
    readonly kind: HookKind;
    /** Order within the phase. */
    readonly order: number;
    /** Sentence-length description from the descriptor. */
    readonly description: string;
    /** Predicate badges describing conditional firing, if any. */
    readonly predicates: ReadonlyArray<{ id: string; label: string; description: string }>;
    /** Whether handlers can short-circuit the pipeline. */
    readonly shortCircuit: boolean;
    /** Handlers registered against this hook, in execution order. */
    readonly handlers: ReadonlyArray<IHookHandlerRecord>;
}

/**
 * Top-level introspection payload returned from `snapshot()` and served
 * by the admin endpoint. Organized into tracks (phases) so the bird's-eye
 * UI renders without re-grouping.
 */
export interface IHookSnapshot {
    /** Tracks in display order, one per pipeline phase. */
    readonly tracks: ReadonlyArray<{
        readonly id: string;
        readonly label: string;
        readonly hooks: ReadonlyArray<IHookSnapshotRecord>;
    }>;
}

/**
 * Process-wide hook registry. Implementations are responsible for
 * storage, ordering, isolation of handler failures, and the snapshot
 * used by introspection.
 */
export interface IHookRegistry {
    /**
     * Register a handler against a hook descriptor.
     *
     * Validates that the descriptor was declared in the central registry
     * (the runtime tracks which descriptors `defineHook` has produced)
     * and enforces the per-plugin handler cap.
     *
     * @param pluginId - Plugin (or `'core'`) registering the handler.
     * @param descriptor - Hook descriptor produced by `defineHook`.
     * @param handler - Handler function. Signature is inferred from the
     *   descriptor's generic parameters.
     * @param options - Optional priority override.
     * @returns Disposer that removes the registration.
     */
    register<I, O, K extends HookKind>(
        pluginId: string,
        descriptor: HookDescriptor<I, O, K>,
        handler: HookHandler<I, O, K>,
        options?: IHookRegisterOptions
    ): HookRegisterDisposer;

    /**
     * Drop every handler registered by the given plugin across all hooks.
     *
     * Called when a plugin is disabled or uninstalled. Mirrors the
     * cleanup semantics of `IServiceRegistry.unregister` but operates in
     * bulk across the entire hook surface.
     *
     * @param pluginId - Plugin whose handlers should be removed.
     * @returns Count of handlers removed.
     */
    disposeForPlugin(pluginId: string): number;

    /**
     * Produce the introspection snapshot consumed by the admin endpoint.
     *
     * The snapshot is built from the union of declared descriptors and
     * the current handler table — empty hooks appear in the output so
     * the timeline UI can render them greyed out.
     *
     * @returns Structured payload ready for JSON serialization.
     */
    snapshot(): IHookSnapshot;

    /**
     * Invoke a declared hook with the appropriate archetype semantics.
     *
     * Resolves the handler list for the descriptor, orders it by priority
     * + registration timestamp, and dispatches to the per-kind invoker.
     * The return type depends on the descriptor's kind:
     *
     * - `observer` and `series` resolve to `undefined` (no return value;
     *   side effects only).
     * - `waterfall` resolves to the final threaded value of type `O`. The
     *   caller must supply the `seed` initial value.
     * - `bail` resolves to `O | undefined` — the first non-`undefined`
     *   answer wins, or `undefined` if no handler responded.
     *
     * Handler failures are isolated according to the archetype's rules
     * documented in `HookDescriptor.HookKind`. A `HookAbortError` thrown
     * by a series/waterfall/bail handler propagates out of this call.
     *
     * @template I - Input payload type.
     * @template O - Output value type.
     * @template K - Hook kind discriminator.
     * @param descriptor - Hook descriptor produced by `defineHook`.
     * @param input - Payload passed to each handler.
     * @param seed - Initial threaded value (waterfall only; ignored
     *   otherwise).
     * @returns Kind-dependent result.
     */
    invoke<I, O>(
        descriptor: HookDescriptor<I, O, 'observer'>,
        input: I
    ): Promise<void>;
    invoke<I, O>(
        descriptor: HookDescriptor<I, O, 'series'>,
        input: I
    ): Promise<void>;
    invoke<I, O>(
        descriptor: HookDescriptor<I, O, 'waterfall'>,
        input: I,
        seed: O
    ): Promise<O>;
    invoke<I, O>(
        descriptor: HookDescriptor<I, O, 'bail'>,
        input: I
    ): Promise<O | undefined>;
}
