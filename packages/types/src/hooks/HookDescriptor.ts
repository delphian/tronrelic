/**
 * @fileoverview Typed descriptor for a declared hook seam.
 *
 * Hook descriptors are the single source of truth for every extension point
 * the core pipeline exposes to plugins. A descriptor names the seam, fixes
 * its kind (observer / series / waterfall / bail), pins its position within
 * a lifecycle phase, documents its contract, and brands its input and
 * output types so the compiler refuses any handler whose signature does
 * not match. Descriptors are immutable once defined and live in a single
 * registry file imported by both core invokers and plugin authors.
 *
 * Adding a new hook requires a PR that defines a descriptor; the runtime
 * `invoke` helper refuses to fire any seam that is not in the registry,
 * which keeps the surface declared and auditable.
 *
 * @module types/hooks/HookDescriptor
 */

/**
 * The four supported hook archetypes. Each maps to a distinct invocation
 * shape — see `invoke` in the backend for the runtime semantics.
 *
 * - `observer`: parallel, fire-and-forget; handlers may not short-circuit
 *   or transform values. Used when core notifies plugins that something
 *   happened.
 * - `series`: ordered, awaited; handlers execute side effects in turn.
 *   May abort the pipeline by throwing `HookAbortError`.
 * - `waterfall`: ordered, awaited; each handler receives the previous
 *   handler's return value, threads a value through the pipeline. The
 *   final value is consumed by core.
 * - `bail`: ordered, awaited; first handler returning a non-`undefined`
 *   value wins and remaining handlers are skipped. Used for overrideable
 *   defaults where core falls through if no plugin answers.
 */
export type HookKind = 'observer' | 'series' | 'waterfall' | 'bail';

/**
 * Pipeline phase a hook belongs to. The admin UI organizes the bird's-eye
 * timeline by phase, so every hook is associated with exactly one.
 */
export type HookPhase =
    | 'ssr.page'
    | 'http.api'
    | 'websocket.event'
    | 'scheduler.tick'
    | 'observer.dispatch'
    | 'ai.tool';

/**
 * Optional predicate badges surfaced in the admin UI. Predicates document
 * conditional firing — for example, a hook that runs only for admin
 * requests, or only on the error path. They are documentation, not
 * enforcement: the predicate string renders as a badge so operators
 * understand why a hook may not fire on every request.
 */
export interface HookPredicate {
    /** Stable identifier used as the badge key (kebab-case). */
    readonly id: string;
    /** Human-readable label shown on the badge. */
    readonly label: string;
    /** Sentence-length description shown on hover. */
    readonly description: string;
}

/**
 * Branded descriptor for a single hook seam.
 *
 * The `__input` and `__output` properties are phantom type carriers — they
 * are never assigned at runtime, only used by the compiler to enforce
 * handler signatures off the descriptor at the call site. This keeps the
 * runtime registry data-only while preserving full type-safety on
 * `context.hooks.register(HOOKS.foo, handler)`.
 *
 * @template I - Type of the input payload passed to handlers.
 * @template O - Type produced by handlers. For `observer` and `series`
 *   this is `void`; for `waterfall` it is the threaded value; for `bail`
 *   it is the optional override value.
 * @template K - Hook kind, narrowed for invocation-time dispatch.
 */
export interface HookDescriptor<I, O, K extends HookKind = HookKind> {
    /** Dotted, fully qualified id — e.g. `ssr.headFragments`. */
    readonly id: string;
    /** Archetype controlling how handlers are sequenced and combined. */
    readonly kind: K;
    /** Pipeline phase this hook belongs to. */
    readonly phase: HookPhase;
    /**
     * Numeric position within the phase. Drives the top-to-bottom order
     * of nodes on the admin timeline. Gaps are recommended (10, 20, 30…)
     * so additions can slot between existing entries without renumbering.
     */
    readonly order: number;
    /** Sentence-length prose describing what the hook is for. */
    readonly description: string;
    /** Optional conditional-firing badges for the admin UI. */
    readonly predicates?: ReadonlyArray<HookPredicate>;
    /**
     * Maximum handlers a single plugin may register against this hook.
     * Defaults to 16 when omitted; bumped on individual hooks where a
     * higher cap is justified.
     */
    readonly maxHandlersPerPlugin?: number;

    /** Phantom input type. Never read at runtime. */
    readonly __input?: I;
    /** Phantom output type. Never read at runtime. */
    readonly __output?: O;
}

/**
 * Handler function for an observer-kind hook. Errors are isolated by the
 * invoker — a throw from one handler does not affect others, and never
 * propagates back to core.
 */
export type ObserverHookHandler<I> = (input: I) => void | Promise<void>;

/**
 * Handler function for a series-kind hook. Throw `HookAbortError` to
 * halt the pipeline cleanly; any other throw is logged and the next
 * handler runs.
 */
export type SeriesHookHandler<I> = (input: I) => void | Promise<void>;

/**
 * Handler function for a waterfall-kind hook. The handler receives the
 * input payload plus the current value (initially the seed from core)
 * and returns the value to thread to the next handler.
 */
export type WaterfallHookHandler<I, O> = (input: I, current: O) => O | Promise<O>;

/**
 * Handler function for a bail-kind hook. Return `undefined` to defer to
 * subsequent handlers (and ultimately core's default); return any other
 * value to bail with that value as the final result.
 */
export type BailHookHandler<I, O> = (input: I) => O | undefined | Promise<O | undefined>;

/**
 * Discriminated union dispatched by the runtime invoker based on the
 * descriptor's `kind`. Plugin authors do not see this — they receive the
 * appropriate handler shape inferred from the descriptor.
 */
export type HookHandler<I, O, K extends HookKind> =
    K extends 'observer' ? ObserverHookHandler<I> :
    K extends 'series' ? SeriesHookHandler<I> :
    K extends 'waterfall' ? WaterfallHookHandler<I, O> :
    K extends 'bail' ? BailHookHandler<I, O> :
    never;
