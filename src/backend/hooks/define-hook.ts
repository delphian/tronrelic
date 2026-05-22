/**
 * @fileoverview defineHook factory for producing typed hook descriptors.
 *
 * `defineHook` is the only sanctioned way to construct a `HookDescriptor`.
 * Every descriptor it produces is tracked in a module-local set so the
 * runtime registry can reject registration against any descriptor that
 * was not minted here — preventing plugins from inventing seams the
 * core pipeline does not invoke.
 *
 * The factory is intentionally narrow: descriptors are frozen after
 * construction, ids must be unique across the process, and the input/
 * output types are carried as phantoms so consumers see fully-typed
 * handlers without paying any runtime cost.
 *
 * @module backend/hooks/define-hook
 */

import type { HookDescriptor, HookKind, HookPhase, HookPredicate } from '@/types';

/**
 * Tracked set of every descriptor minted by `defineHook` in this process.
 *
 * Stored as a Map keyed by id so the runtime can reject duplicate ids
 * and look up the descriptor for snapshot generation without coupling
 * to the shape of the central `HOOKS` const.
 */
const KNOWN_DESCRIPTORS: Map<string, HookDescriptor<unknown, unknown, HookKind>> = new Map();

/**
 * Initialisation options accepted by `defineHook`.
 */
export interface IDefineHookOptions<K extends HookKind> {
    /** Dotted, fully qualified id. Must be unique across the process. */
    id: string;
    /** Hook archetype controlling sequencing and combination semantics. */
    kind: K;
    /** Pipeline phase this hook belongs to. */
    phase: HookPhase;
    /** Ordering position within the phase. */
    order: number;
    /** Sentence-length description rendered into the admin UI. */
    description: string;
    /** Predicate badges describing conditional firing. */
    predicates?: ReadonlyArray<HookPredicate>;
    /** Per-plugin handler cap. Defaults to 16. */
    maxHandlersPerPlugin?: number;
}

/**
 * Construct a typed hook descriptor.
 *
 * The generic parameters carry the input and output types — they cannot
 * be inferred from the runtime options, so callers must supply them at
 * the call site. By convention the explicit form is preferred:
 *
 * ```typescript
 * export const HEAD_FRAGMENTS = defineHook<SsrCtx, ReadonlyArray<HeadFragment>, 'waterfall'>({
 *     id: 'ssr.headFragments',
 *     kind: 'waterfall',
 *     phase: 'ssr.page',
 *     order: 200,
 *     description: 'Contribute <style>/<link>/<meta> entries to the rendered <head>.'
 * });
 * ```
 *
 * @template I - Input payload type.
 * @template O - Output value type (`void` for observer / series).
 * @template K - Hook kind discriminator.
 * @param options - Descriptor configuration.
 * @returns Frozen, runtime-tracked descriptor.
 * @throws Error if a descriptor with the same id was already defined.
 */
export function defineHook<I, O, K extends HookKind>(options: IDefineHookOptions<K>): HookDescriptor<I, O, K> {
    if (KNOWN_DESCRIPTORS.has(options.id)) {
        throw new Error(`Duplicate hook descriptor id: '${options.id}'. Hook ids must be unique across the process.`);
    }

    const descriptor: HookDescriptor<I, O, K> = Object.freeze({
        id: options.id,
        kind: options.kind,
        phase: options.phase,
        order: options.order,
        description: options.description,
        predicates: options.predicates ? Object.freeze([...options.predicates]) : undefined,
        maxHandlersPerPlugin: options.maxHandlersPerPlugin
    });

    KNOWN_DESCRIPTORS.set(options.id, descriptor as unknown as HookDescriptor<unknown, unknown, HookKind>);

    return descriptor;
}

/**
 * Test whether a descriptor was produced by `defineHook` in this process.
 *
 * The runtime registry calls this to refuse registrations against
 * fabricated descriptors that bypass the central declaration.
 *
 * @param descriptor - Candidate descriptor.
 * @returns True if the descriptor is tracked.
 */
export function isKnownDescriptor(descriptor: HookDescriptor<unknown, unknown, HookKind>): boolean {
    const tracked = KNOWN_DESCRIPTORS.get(descriptor.id);
    const result = tracked === descriptor;

    return result;
}

/**
 * Snapshot every descriptor known to the process, in stable id order.
 *
 * Used by the registry's `snapshot()` to enumerate declared hooks even
 * when no handlers have been registered against them — empty hooks
 * still appear in the admin timeline.
 *
 * @returns Array of descriptors, sorted by id.
 */
export function listKnownDescriptors(): ReadonlyArray<HookDescriptor<unknown, unknown, HookKind>> {
    const list = Array.from(KNOWN_DESCRIPTORS.values()).sort((a, b) => a.id.localeCompare(b.id));

    return list;
}

/**
 * Drop every tracked descriptor.
 *
 * Test-only utility. Production code never invokes this — descriptors
 * are defined once at module load and persist for the process lifetime.
 */
export function __resetKnownDescriptorsForTests(): void {
    KNOWN_DESCRIPTORS.clear();

    return;
}
