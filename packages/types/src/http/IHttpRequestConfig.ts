/**
 * DRAFT (tronrelic#289) — per-request options for the proposed outbound HTTP
 * client contract. See IHttpClient.ts for full status and caveats. Not yet
 * wired into IPluginContext.http.
 */
import type { HttpResponseType } from './HttpResponseType.js';
import type { IAbortSignalLike } from './IAbortSignalLike.js';

/**
 * Per-request options. Provisional — the union of what current consumers pass
 * to axios (trp-ai-assistant streaming + abort + family, trp-telegram-bot
 * multipart + body-size caps, trp-resource-markets generics). Kept loose
 * pending the tronrelic#289 review and expected to change.
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
    signal?: IAbortSignalLike;
    /** Cap on accepted response size, in bytes. */
    maxContentLength?: number;
    /** Cap on sent request body size, in bytes. */
    maxBodyLength?: number;
    /** IP family hint (e.g. 4 to force IPv4). */
    family?: number;
}
