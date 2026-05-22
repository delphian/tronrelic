/**
 * @fileoverview Kind-specific invocation engines for the hook system.
 *
 * Each of the four hook archetypes (observer, series, waterfall, bail)
 * has distinct semantics for sequencing handlers, propagating return
 * values, and isolating failures. This module exposes one runtime
 * dispatcher per archetype plus a unified `invokeHook` entry point that
 * routes by the descriptor's `kind`. Core call sites consume the
 * unified entry point; archetype-specific helpers are exported for
 * testing.
 *
 * Failure isolation rules:
 *
 * - Observer: all handlers run in parallel; rejections are logged and
 *   swallowed so one misbehaving plugin cannot block notifications to
 *   others.
 * - Series: handlers run sequentially; a `HookAbortError` halts the
 *   pipeline cleanly, any other throw is logged and the next handler
 *   runs.
 * - Waterfall: same as series, but the threaded value carries forward.
 *   On an unexpected throw, the value is unchanged and the next handler
 *   receives the same input the failed one did.
 * - Bail: handlers run sequentially; the first `undefined`-returning
 *   handler defers to the next, the first non-`undefined` return wins
 *   and remaining handlers are skipped. `HookAbortError` halts the
 *   pipeline; other throws are logged and the next handler runs.
 *
 * @module backend/hooks/invoke
 */

import type {
    HookDescriptor,
    HookKind,
    ISystemLogService,
    ObserverHookHandler,
    SeriesHookHandler,
    WaterfallHookHandler,
    BailHookHandler
} from '@/types';
import { isHookAbortError } from '@/types';

/**
 * Internal record stored by the registry for each registered handler.
 *
 * The shape is identical across archetypes so the registry can hold a
 * single heterogeneous list per descriptor; per-archetype invokers cast
 * the `fn` to the correct signature at dispatch time.
 */
export interface IRegisteredHandler {
    /** Plugin id (or `'core'`) that owns the registration. */
    readonly pluginId: string;
    /** Lower numbers run first. */
    readonly priority: number;
    /** Registration time, used as a deterministic tiebreaker. */
    readonly registeredAt: number;
    /** Best-effort source location string for the admin UI. */
    readonly source: string | null;
    /** Untyped handler function — narrowed by the per-kind invoker. */
    readonly fn: (...args: unknown[]) => unknown;
}

/**
 * Sort handlers by (priority asc, registeredAt asc). Stable for ties.
 *
 * Returns a fresh array so callers may safely iterate without observing
 * concurrent registrations.
 *
 * @param handlers - Handler records to order.
 * @returns Sorted copy.
 */
export function orderHandlers(handlers: ReadonlyArray<IRegisteredHandler>): ReadonlyArray<IRegisteredHandler> {
    const copy = [...handlers];
    copy.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.registeredAt - b.registeredAt;
    });

    return copy;
}

/**
 * Invoke an observer-kind hook.
 *
 * Handlers run in parallel via `Promise.allSettled`. Rejections are
 * logged and discarded; the call resolves when every handler has
 * settled. Returns `undefined` because observer hooks have no return
 * value.
 *
 * @template I - Input payload type.
 * @param descriptor - Descriptor of the hook being invoked.
 * @param handlers - Pre-ordered handler list.
 * @param input - Payload to pass each handler.
 * @param logger - System logger for handler failures.
 */
export async function invokeObserver<I>(
    descriptor: HookDescriptor<I, void, 'observer'>,
    handlers: ReadonlyArray<IRegisteredHandler>,
    input: I,
    logger: ISystemLogService
): Promise<void> {
    if (handlers.length === 0) return;

    const results = await Promise.allSettled(
        handlers.map(h => Promise.resolve().then(() => (h.fn as ObserverHookHandler<I>)(input)))
    );

    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'rejected') {
            logger.warn(
                { err: r.reason, hookId: descriptor.id, pluginId: handlers[i].pluginId, kind: 'observer' },
                'Hook handler rejected'
            );
        }
    }

    return;
}

/**
 * Invoke a series-kind hook.
 *
 * Handlers run sequentially. A `HookAbortError` propagates out of the
 * call so the caller can short-circuit; any other throw is logged and
 * the pipeline continues with the next handler.
 *
 * @template I - Input payload type.
 * @param descriptor - Descriptor of the hook being invoked.
 * @param handlers - Pre-ordered handler list.
 * @param input - Payload to pass each handler.
 * @param logger - System logger for handler failures.
 */
export async function invokeSeries<I>(
    descriptor: HookDescriptor<I, void, 'series'>,
    handlers: ReadonlyArray<IRegisteredHandler>,
    input: I,
    logger: ISystemLogService
): Promise<void> {
    for (const h of handlers) {
        try {
            await (h.fn as SeriesHookHandler<I>)(input);
        } catch (err) {
            if (isHookAbortError(err)) {
                throw err;
            }
            logger.warn(
                { err, hookId: descriptor.id, pluginId: h.pluginId, kind: 'series' },
                'Hook handler threw'
            );
        }
    }

    return;
}

/**
 * Invoke a waterfall-kind hook.
 *
 * Each handler receives the input and the current threaded value, and
 * returns the next value. A throw other than `HookAbortError` is
 * isolated and the value is left unchanged for the next handler.
 *
 * @template I - Input payload type.
 * @template O - Threaded value type.
 * @param descriptor - Descriptor of the hook being invoked.
 * @param handlers - Pre-ordered handler list.
 * @param input - Input payload supplied to every handler.
 * @param seed - Initial value threaded into the first handler.
 * @param logger - System logger for handler failures.
 * @returns Final threaded value after all handlers complete.
 */
export async function invokeWaterfall<I, O>(
    descriptor: HookDescriptor<I, O, 'waterfall'>,
    handlers: ReadonlyArray<IRegisteredHandler>,
    input: I,
    seed: O,
    logger: ISystemLogService
): Promise<O> {
    let current: O = seed;
    for (const h of handlers) {
        try {
            current = await (h.fn as WaterfallHookHandler<I, O>)(input, current);
        } catch (err) {
            if (isHookAbortError(err)) {
                throw err;
            }
            logger.warn(
                { err, hookId: descriptor.id, pluginId: h.pluginId, kind: 'waterfall' },
                'Hook handler threw — value unchanged'
            );
        }
    }

    return current;
}

/**
 * Invoke a bail-kind hook.
 *
 * Handlers run sequentially. The first to return a non-`undefined`
 * value wins and remaining handlers are skipped. Returns `undefined`
 * if no handler answers, signalling to core that it should fall
 * through to its default behaviour.
 *
 * @template I - Input payload type.
 * @template O - Override value type.
 * @param descriptor - Descriptor of the hook being invoked.
 * @param handlers - Pre-ordered handler list.
 * @param input - Payload to pass each handler.
 * @param logger - System logger for handler failures.
 * @returns First non-`undefined` value, or `undefined` if none answered.
 */
export async function invokeBail<I, O>(
    descriptor: HookDescriptor<I, O, 'bail'>,
    handlers: ReadonlyArray<IRegisteredHandler>,
    input: I,
    logger: ISystemLogService
): Promise<O | undefined> {
    let answer: O | undefined = undefined;
    for (const h of handlers) {
        try {
            const result = await (h.fn as BailHookHandler<I, O>)(input);
            if (result !== undefined) {
                answer = result;
                break;
            }
        } catch (err) {
            if (isHookAbortError(err)) {
                throw err;
            }
            logger.warn(
                { err, hookId: descriptor.id, pluginId: h.pluginId, kind: 'bail' },
                'Hook handler threw'
            );
        }
    }

    return answer;
}

/**
 * Resolve the descriptor's archetype and dispatch to the appropriate
 * invoker. Returned type varies by kind — `void` for observer / series,
 * `O` for waterfall, `O | undefined` for bail.
 *
 * @template I - Input payload type.
 * @template O - Output value type.
 * @template K - Hook kind discriminator.
 * @param descriptor - Descriptor of the hook being invoked.
 * @param handlers - Pre-ordered handler list.
 * @param input - Payload to pass each handler.
 * @param seedOrLogger - For waterfall hooks, the seed value; otherwise
 *   the system logger.
 * @param maybeLogger - System logger when a seed was passed.
 * @returns Kind-dependent result.
 */
export async function invokeHook<I, O, K extends HookKind>(
    descriptor: HookDescriptor<I, O, K>,
    handlers: ReadonlyArray<IRegisteredHandler>,
    input: I,
    seedOrLogger: O | ISystemLogService,
    maybeLogger?: ISystemLogService
): Promise<void | O | undefined> {
    const ordered = orderHandlers(handlers);

    if (descriptor.kind === 'waterfall') {
        const logger = maybeLogger as ISystemLogService;
        const seed = seedOrLogger as O;
        return invokeWaterfall(descriptor as HookDescriptor<I, O, 'waterfall'>, ordered, input, seed, logger);
    }

    const logger = (maybeLogger ?? seedOrLogger) as ISystemLogService;

    if (descriptor.kind === 'observer') {
        return invokeObserver(descriptor as HookDescriptor<I, void, 'observer'>, ordered, input, logger);
    }
    if (descriptor.kind === 'series') {
        return invokeSeries(descriptor as HookDescriptor<I, void, 'series'>, ordered, input, logger);
    }
    if (descriptor.kind === 'bail') {
        return invokeBail(descriptor as HookDescriptor<I, O, 'bail'>, ordered, input, logger);
    }

    throw new Error(`Unknown hook kind '${String(descriptor.kind)}' for hook '${descriptor.id}'`);
}
