/**
 * @file curation-auto-approve-context.ts
 *
 * Ambient per-invocation channel telling the curation service whether the held
 * effects of the tool currently executing should be auto-approved.
 *
 * The bridge problem: a tool handler routes an effect into the queue by calling
 * the singleton `curation.hold(...)`; the governor only sees `handler(input)` and
 * never the individual hold calls, and the curation service is generic and knows
 * nothing about tools or policy. The auto-approve decision, however, belongs to
 * the governor (it owns the tool's effective policy and the trigger path). An
 * `AsyncLocalStorage` carries that decision across the awaited handler call — the
 * governor sets it, `hold()` reads it — without threading a flag through every
 * plugin's hold input or coupling the curation service to the policy engine.
 * Per-async-context isolation keeps concurrent invocations from cross-talking.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** The store carried for the duration of one governed handler execution. */
interface ICurationAutoApproveStore {
    /** Whether held effects produced during this invocation auto-approve. */
    autoApprove: boolean;

    /**
     * Whether the governed execution is still live. Flipped to false once the
     * wrapped call settles (success, error, or — critically — a timeout the
     * governor stops awaiting). The handler promise can outlive that settlement
     * because the governor cannot abort it; its later async continuations still
     * share this same store object, so gating auto-approval on `live` stops a
     * detached, timed-out handler from auto-committing an effect the governor
     * has already recorded as failed.
     */
    live: boolean;
}

/** Process-wide async-context store; empty outside a governed invocation. */
const storage = new AsyncLocalStorage<ICurationAutoApproveStore>();

/**
 * Run `fn` with the curation auto-approve decision in scope so any
 * `curation.hold(...)` it triggers can read it. The governor wraps the handler
 * call with this. The scope is marked dead the instant `fn` settles, so a
 * handler that kept running past a timeout can no longer auto-approve.
 *
 * @param autoApprove - Whether held effects of this invocation auto-approve.
 * @param fn - The handler execution to run within the context.
 * @returns Whatever `fn` resolves to.
 */
export function runWithCurationAutoApprove<T>(autoApprove: boolean, fn: () => Promise<T>): Promise<T> {
    // The store is mutated (not replaced) on settlement so every continuation
    // sharing this async context — including a detached, still-running handler —
    // observes the liveness change through the same object reference.
    const store: ICurationAutoApproveStore = { autoApprove, live: true };
    return storage.run(store, async () => {
        try {
            return await fn();
        } finally {
            store.live = false;
        }
    });
}

/**
 * Whether the currently executing governed invocation has opted its held effects
 * into auto-approval AND is still live. False outside a governed invocation (a
 * manual admin approve, a direct service call) and false once the governed
 * execution has settled — so an effect held by a handler that outran its timeout
 * falls back to manual review rather than silently auto-approving.
 *
 * @returns True when the active, still-live invocation auto-approves its held effects.
 */
export function shouldAutoApproveCuration(): boolean {
    const store = storage.getStore();
    return store?.autoApprove === true && store.live === true;
}
