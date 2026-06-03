/**
 * DRAFT — outbound HTTP client abstraction for plugins and modules.
 *
 * Status: proposed, NOT yet wired into `IPluginContext.http`. This is the
 * starting-point draft referenced by tronrelic#289. Its purpose is to replace
 * the leaked axios `AxiosInstance` type on the plugin contract with a
 * core-owned interface, removing the dual-package type-identity hazard (a
 * plugin's local axios version differing from core's) and decoupling the
 * published contract from axios so the implementation can change later.
 *
 * DO NOT rely on this shape yet. Per tronrelic#289, an extensive review of
 * every `context.http` consumer must finalize the request-config/response
 * surface before `IPluginContext.http` is switched to `IHttpClient`. The
 * fields below are a provisional union drawn from current consumers
 * (trp-ai-assistant streaming + abort + family, trp-telegram-bot multipart +
 * body-size caps, trp-resource-markets generics) and are expected to change.
 *
 * Interim convention until the switch lands: type injected http as
 * `IPluginContext['http']`, not `import type { AxiosInstance } from 'axios'`.
 */

/** Response body interpretation requested from the transport. */
export type HttpResponseType = 'json' | 'text' | 'stream' | 'arraybuffer';

/**
 * Per-request options. Provisional — the union of what current consumers pass
 * to axios. Kept loose pending the tronrelic#289 review.
 */
export interface IHttpRequestConfig {
    /** Request headers. */
    headers?: Record<string, string>;
    /** Query string parameters. */
    params?: Record<string, string | number | boolean>;
    /** Per-request timeout in milliseconds. */
    timeout?: number;
    /** How to interpret/return the response body. */
    responseType?: HttpResponseType;
    /** Cancellation signal; aborting cancels the in-flight request. */
    signal?: AbortSignal;
    /** Cap on accepted response size, in bytes. */
    maxContentLength?: number;
    /** Cap on sent request body size, in bytes. */
    maxBodyLength?: number;
    /** IP family hint (e.g. 4 to force IPv4). */
    family?: number;
}

/** Minimal response envelope — only `data` is contractually guaranteed. */
export interface IHttpResponseEnvelope<T = unknown> {
    /** Parsed (or stream/text/buffer) response body, per `responseType`. */
    data: T;
}

/**
 * The outbound HTTP surface plugins and modules consume via `context.http`.
 *
 * Deliberately narrow: `get` and `post` cover every current consumer. Add
 * verbs here only when a real consumer needs them, so the contract stays
 * small and implementation-swappable.
 */
export interface IHttpClient {
    /**
     * Issue a GET request.
     *
     * @param url - Absolute request URL.
     * @param config - Optional per-request options.
     * @returns The response envelope.
     */
    get<T = unknown>(url: string, config?: IHttpRequestConfig): Promise<IHttpResponseEnvelope<T>>;

    /**
     * Issue a POST request.
     *
     * @param url - Absolute request URL.
     * @param data - Request body (JSON-serializable object, FormData, etc.).
     * @param config - Optional per-request options.
     * @returns The response envelope.
     */
    post<T = unknown>(url: string, data?: unknown, config?: IHttpRequestConfig): Promise<IHttpResponseEnvelope<T>>;
}
