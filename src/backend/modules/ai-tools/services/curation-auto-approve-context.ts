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
}

/** Process-wide async-context store; empty outside a governed invocation. */
const storage = new AsyncLocalStorage<ICurationAutoApproveStore>();

/**
 * Run `fn` with the curation auto-approve decision in scope so any
 * `curation.hold(...)` it triggers can read it. The governor wraps the handler
 * call with this.
 *
 * @param autoApprove - Whether held effects of this invocation auto-approve.
 * @param fn - The handler execution to run within the context.
 * @returns Whatever `fn` resolves to.
 */
export function runWithCurationAutoApprove<T>(autoApprove: boolean, fn: () => Promise<T>): Promise<T> {
    return storage.run({ autoApprove }, fn);
}

/**
 * Whether the currently executing governed invocation has opted its held effects
 * into auto-approval. False outside a governed invocation (e.g. a manual admin
 * approve, or a direct service call).
 *
 * @returns True when the active invocation auto-approves its held effects.
 */
export function shouldAutoApproveCuration(): boolean {
    return storage.getStore()?.autoApprove === true;
}
