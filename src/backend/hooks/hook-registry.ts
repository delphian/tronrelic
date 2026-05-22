/**
 * @fileoverview Runtime hook registry implementation.
 *
 * Concrete `IHookRegistry` backed by a Map of descriptor id → handler
 * list. Validates that every descriptor passed in was minted by
 * `defineHook`, enforces the per-plugin handler cap, and produces the
 * introspection snapshot consumed by the `/api/admin/system/hooks`
 * endpoint.
 *
 * The registry deliberately does not invoke handlers itself. Invocation
 * lives in `invoke.ts` so core call sites can compose the registry's
 * handler list with their archetype-specific dispatch without going
 * through an extra method indirection.
 *
 * @see {@link ../../../docs/system/system-hooks.md} for the contract
 *   this implementation enforces — archetypes, lifecycle window, abort
 *   semantics, and snapshot shape.
 * @module backend/hooks/hook-registry
 */

import type {
    HookDescriptor,
    HookHandler,
    HookKind,
    HookPhase,
    IHookRegisterOptions,
    IHookRegistry,
    IHookSnapshot,
    IHookSnapshotRecord,
    IHookHandlerRecord,
    HookRegisterDisposer,
    ISystemLogService
} from '@/types';
import type { IRegisteredHandler } from './invoke.js';
import { orderHandlers, invokeHook } from './invoke.js';
import { isKnownDescriptor, listKnownDescriptors } from './define-hook.js';

const DEFAULT_PRIORITY = 100;
const DEFAULT_MAX_HANDLERS_PER_PLUGIN = 16;
const RESERVED_PLUGIN_ID = 'core';

/**
 * Display labels and order for each pipeline phase, used by the admin
 * snapshot. Phases not in this list will not appear in the snapshot —
 * adding a new phase requires extending this table.
 */
const PHASE_TRACKS: ReadonlyArray<{ id: HookPhase; label: string }> = [
    { id: 'ssr.page', label: 'SSR Page Render' },
    { id: 'http.api', label: 'REST API Request' },
    { id: 'websocket.event', label: 'WebSocket Event' },
    { id: 'scheduler.tick', label: 'Scheduler Tick' },
    { id: 'observer.dispatch', label: 'Observer Dispatch' }
];

/**
 * Map-backed hook registry. One instance per process; constructed during
 * bootstrap and threaded into plugin contexts via the per-plugin facade.
 */
export class HookRegistry implements IHookRegistry {
    /** Handler lists keyed by descriptor id. */
    private readonly handlersByHook: Map<string, IRegisteredHandler[]> = new Map();

    /**
     * Construct a registry.
     *
     * @param logger - System logger used for registration and disposal
     *   diagnostics. Handler-time failure logging happens inside the
     *   invokers in `invoke.ts`.
     */
    constructor(private readonly logger: ISystemLogService) {}

    /**
     * Register a handler against a declared hook.
     *
     * @template I - Input payload type.
     * @template O - Output value type.
     * @template K - Hook kind discriminator.
     * @param pluginId - Plugin id (or `'core'`) registering the handler.
     * @param descriptor - Descriptor minted by `defineHook`.
     * @param handler - Handler function inferred from the descriptor.
     * @param options - Optional priority override.
     * @returns Disposer that removes the registration.
     * @throws Error if the descriptor is unknown or the per-plugin cap
     *   is exceeded.
     */
    register<I, O, K extends HookKind>(
        pluginId: string,
        descriptor: HookDescriptor<I, O, K>,
        handler: HookHandler<I, O, K>,
        options?: IHookRegisterOptions
    ): HookRegisterDisposer {
        if (!pluginId || typeof pluginId !== 'string') {
            throw new Error('Hook registration requires a non-empty pluginId.');
        }
        if (!descriptor || typeof descriptor.id !== 'string') {
            throw new Error('Hook registration requires a valid descriptor.');
        }
        if (!isKnownDescriptor(descriptor as HookDescriptor<unknown, unknown, HookKind>)) {
            throw new Error(
                `Hook descriptor '${descriptor.id}' was not produced by defineHook. ` +
                `Declare it in the central HOOKS registry before registering handlers.`
            );
        }

        const cap = descriptor.maxHandlersPerPlugin ?? DEFAULT_MAX_HANDLERS_PER_PLUGIN;
        const existing = this.handlersByHook.get(descriptor.id) ?? [];
        const ownedByPlugin = existing.filter(h => h.pluginId === pluginId).length;
        if (ownedByPlugin >= cap) {
            throw new Error(
                `Plugin '${pluginId}' has reached the handler cap of ${cap} for hook '${descriptor.id}'. ` +
                `Bump maxHandlersPerPlugin on the descriptor if more are justified.`
            );
        }

        const record: IRegisteredHandler = {
            pluginId,
            priority: options?.priority ?? DEFAULT_PRIORITY,
            registeredAt: Date.now(),
            source: captureRegistrationSource(),
            fn: handler as unknown as (...args: unknown[]) => unknown
        };

        existing.push(record);
        this.handlersByHook.set(descriptor.id, existing);

        this.logger.debug(
            { hookId: descriptor.id, pluginId, priority: record.priority },
            'Hook handler registered'
        );

        return () => {
            const list = this.handlersByHook.get(descriptor.id);
            if (!list) return;
            const idx = list.indexOf(record);
            if (idx < 0) return;
            list.splice(idx, 1);
            if (list.length === 0) {
                this.handlersByHook.delete(descriptor.id);
            }
            this.logger.debug(
                { hookId: descriptor.id, pluginId },
                'Hook handler unregistered'
            );
        };
    }

    /**
     * Remove every handler registered by the given plugin.
     *
     * @param pluginId - Plugin whose handlers should be dropped.
     * @returns Count of handlers removed.
     */
    disposeForPlugin(pluginId: string): number {
        let removed = 0;
        for (const [hookId, list] of this.handlersByHook) {
            const before = list.length;
            const kept = list.filter(h => h.pluginId !== pluginId);
            if (kept.length === before) continue;
            removed += before - kept.length;
            if (kept.length === 0) {
                this.handlersByHook.delete(hookId);
            } else {
                this.handlersByHook.set(hookId, kept);
            }
        }
        if (removed > 0) {
            this.logger.info({ pluginId, removed }, 'Hook handlers disposed for plugin');
        }

        return removed;
    }

    /**
     * Retrieve the ordered handler list for a descriptor.
     *
     * Returned for use by `invoke.ts`. Empty list is returned for
     * descriptors with no registrations rather than `undefined` so
     * callers can iterate unconditionally.
     *
     * @template I - Input payload type.
     * @template O - Output value type.
     * @template K - Hook kind discriminator.
     * @param descriptor - Descriptor whose handlers are requested.
     * @returns Ordered handler records.
     */
    getHandlers<I, O, K extends HookKind>(
        descriptor: HookDescriptor<I, O, K>
    ): ReadonlyArray<IRegisteredHandler> {
        const list = this.handlersByHook.get(descriptor.id) ?? [];
        const result = orderHandlers(list);

        return result;
    }

    /**
     * Produce the introspection snapshot for the admin endpoint.
     *
     * Built from the union of declared descriptors and the live handler
     * table — empty hooks appear so the UI can render them greyed out.
     *
     * @returns Structured payload.
     */
    snapshot(): IHookSnapshot {
        const descriptors = listKnownDescriptors();
        const byPhase: Map<HookPhase, IHookSnapshotRecord[]> = new Map();
        for (const track of PHASE_TRACKS) {
            byPhase.set(track.id, []);
        }

        for (const desc of descriptors) {
            const bucket = byPhase.get(desc.phase);
            if (!bucket) continue;
            const handlerRecords: IHookHandlerRecord[] = orderHandlers(
                this.handlersByHook.get(desc.id) ?? []
            ).map(h => ({
                pluginId: h.pluginId,
                priority: h.priority,
                registeredAt: new Date(h.registeredAt).toISOString(),
                source: h.source
            }));

            bucket.push({
                id: desc.id,
                kind: desc.kind,
                order: desc.order,
                description: desc.description,
                predicates: (desc.predicates ?? []).map(p => ({
                    id: p.id,
                    label: p.label,
                    description: p.description
                })),
                // Every archetype except observer can halt the pipeline:
                // series/waterfall/bail all propagate HookAbortError up
                // to the caller. Only observer (Promise.allSettled) is
                // immune.
                shortCircuit: desc.kind !== 'observer',
                handlers: handlerRecords
            });
        }

        const tracks = PHASE_TRACKS.map(track => ({
            id: track.id,
            label: track.label,
            hooks: (byPhase.get(track.id) ?? []).sort((a, b) => a.order - b.order)
        }));

        return { tracks };
    }

    /**
     * Invoke a declared hook with kind-appropriate dispatch.
     *
     * Looks up the handler list for the descriptor, then delegates to
     * the unified `invokeHook` engine. For waterfall hooks the caller
     * must supply the initial threaded value via `seed`; for other
     * kinds `seed` is ignored.
     *
     * @template I - Input payload type.
     * @template O - Output value type.
     * @template K - Hook kind discriminator.
     * @param descriptor - Hook descriptor.
     * @param input - Payload passed to each handler.
     * @param seed - Initial threaded value (waterfall only).
     * @returns Kind-dependent result.
     */
    invoke<I, O>(descriptor: HookDescriptor<I, O, 'observer'>, input: I): Promise<void>;
    invoke<I, O>(descriptor: HookDescriptor<I, O, 'series'>, input: I): Promise<void>;
    invoke<I, O>(descriptor: HookDescriptor<I, O, 'waterfall'>, input: I, seed: O): Promise<O>;
    invoke<I, O>(descriptor: HookDescriptor<I, O, 'bail'>, input: I): Promise<O | undefined>;
    invoke<I, O, K extends HookKind>(
        descriptor: HookDescriptor<I, O, K>,
        input: I,
        seed?: O
    ): Promise<void | O | undefined> {
        const handlers = this.handlersByHook.get(descriptor.id) ?? [];
        if (descriptor.kind === 'waterfall') {
            // The public overload makes `seed` mandatory for waterfall,
            // so reaching here without it is a contract violation from
            // an untyped caller (e.g. JS, `any`-typed glue). Throw eagerly
            // rather than silently threading `undefined` into the first
            // handler.
            if (seed === undefined) {
                throw new Error(
                    `Hook '${descriptor.id}' is a waterfall and requires a seed value; ` +
                    `invoke() was called without one.`
                );
            }
            return invokeHook(descriptor, handlers, input, seed, this.logger);
        }

        return invokeHook(descriptor, handlers, input, this.logger);
    }
}

/**
 * Best-effort source-file capture from a stack trace one frame above
 * the caller. Returns `null` when the trace is missing or unparseable —
 * the admin UI tolerates `null` and renders the registration without a
 * deep link.
 *
 * @returns A `file:line:col` string or `null`.
 */
function captureRegistrationSource(): string | null {
    const stack = new Error().stack;
    if (!stack) return null;
    const lines = stack.split('\n');
    for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.includes('/hooks/') || line.includes('node_modules')) continue;
        const match = line.match(/\((.+:\d+:\d+)\)/) || line.match(/at (.+:\d+:\d+)$/);
        if (match) {
            return match[1];
        }
    }

    return null;
}

export { RESERVED_PLUGIN_ID };
