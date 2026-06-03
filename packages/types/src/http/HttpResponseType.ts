/**
 * DRAFT (tronrelic#289) — supporting type for the proposed outbound HTTP client
 * contract. See IHttpClient.ts for full status and caveats. Not yet wired into
 * IPluginContext.http.
 */

/** Response body interpretation requested from the transport. */
export type HttpResponseType = 'json' | 'text' | 'stream' | 'arraybuffer';
