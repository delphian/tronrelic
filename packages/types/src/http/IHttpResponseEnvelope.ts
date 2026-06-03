/**
 * DRAFT (tronrelic#289) — response envelope for the proposed outbound HTTP
 * client contract. See IHttpClient.ts for full status and caveats. Not yet
 * wired into IPluginContext.http.
 */

/** Minimal response envelope — only `data` is contractually guaranteed. */
export interface IHttpResponseEnvelope<T = unknown> {
    /** Parsed (or stream/text/buffer) response body, per `responseType`. */
    data: T;
}
