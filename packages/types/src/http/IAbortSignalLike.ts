/**
 * DRAFT (tronrelic#289) — minimal structural AbortSignal shape for the proposed
 * outbound HTTP client contract. See IHttpClient.ts for full status and caveats.
 *
 * Defined locally rather than referencing the global `AbortSignal` so the
 * published contract stays self-contained: a consumer whose tsconfig omits the
 * `dom` lib and `@types/node` can still consume `IHttpRequestConfig` without a
 * typecheck failure. A real DOM or Node `AbortSignal` is structurally assignable
 * to this shape, so callers pass `new AbortController().signal` unchanged.
 */

/** Minimal structural subset of the standard AbortSignal a real one satisfies. */
export interface IAbortSignalLike {
    /** True once abort has been requested. */
    readonly aborted: boolean;
    /** Register an abort listener. */
    addEventListener(type: 'abort', listener: (this: IAbortSignalLike, ev: any) => any, options?: any): void;
    /** Remove a previously registered abort listener. */
    removeEventListener(type: 'abort', listener: (this: IAbortSignalLike, ev: any) => any, options?: any): void;
    /** Abort event handler, or null when none is set. */
    onabort: ((this: IAbortSignalLike, ev: any) => any) | null;
}
