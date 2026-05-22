/**
 * @fileoverview Sentinel error used to halt a series or bail hook pipeline.
 *
 * Hook handlers that throw any other error have their failure logged in
 * isolation and the next handler runs — this preserves the rule that one
 * misbehaving plugin cannot corrupt the pipeline for others. A handler
 * that intentionally needs to stop the pipeline (for example, an auth
 * handler that rejects a request) throws `HookAbortError`, which the
 * invoker treats as a controlled signal rather than a fault.
 *
 * The error carries an optional payload that the invoker forwards to the
 * caller, letting the aborting plugin pass structured context — typically
 * a short-circuit response object for HTTP-style seams.
 *
 * @module types/hooks/HookAbortError
 */

/**
 * Signals controlled termination of a hook pipeline.
 *
 * Throw this from any series-, waterfall-, or bail-kind handler when the
 * plugin wants core to stop invoking subsequent handlers. Observer-kind
 * hooks ignore the error class because their handlers run in parallel
 * with no defined "next" handler to skip.
 *
 * @template T - Optional payload type forwarded to the invoker.
 */
export class HookAbortError<T = unknown> extends Error {
    /**
     * Marker for `instanceof` checks across module boundaries where the
     * class identity itself may diverge (multiple bundles, dual ESM/CJS
     * loading). The invoker checks both `instanceof` and this property.
     */
    public readonly isHookAbortError = true;

    /** Structured payload forwarded to the invoker / caller. */
    public readonly payload: T | undefined;

    /**
     * Construct a new hook-abort signal.
     *
     * @param message - Diagnostic message logged alongside the abort.
     * @param payload - Optional structured payload forwarded to the
     *   invoker. For HTTP-style bail hooks, this is typically the
     *   short-circuit response.
     */
    constructor(message: string, payload?: T) {
        super(message);
        this.name = 'HookAbortError';
        this.payload = payload;

        return;
    }
}

/**
 * Type guard for cross-bundle safety. Prefer this to a bare `instanceof`
 * check at the boundary between core and plugin code, because class
 * identity is not guaranteed when modules are loaded from different
 * filesystem locations.
 *
 * @param err - Value to test.
 * @returns True if `err` was produced by `new HookAbortError(...)`.
 */
export function isHookAbortError(err: unknown): err is HookAbortError {
    const result = (
        err instanceof HookAbortError ||
        (typeof err === 'object' && err !== null && (err as { isHookAbortError?: boolean }).isHookAbortError === true)
    );

    return result;
}
