/**
 * Framework-agnostic HTTP abstractions for the TronRelic plugin system.
 *
 * These interfaces decouple plugins from Express-specific types, allowing the
 * backend to potentially swap HTTP frameworks without breaking plugins. Plugins
 * import these types instead of Express types directly.
 *
 * The backend provides concrete implementations (adapters) that map these
 * interfaces to the actual HTTP framework being used.
 */
export type { IHttpRequest } from './IHttpRequest.js';
export type { IHttpResponse } from './IHttpResponse.js';
export type { IHttpNext } from './IHttpNext.js';
// DRAFT (tronrelic#289) — proposed outbound HTTP client contract, not yet wired
// into IPluginContext.http. See IHttpClient.ts for status and caveats.
export type { IHttpClient } from './IHttpClient.js';
export type { IHttpRequestConfig } from './IHttpRequestConfig.js';
export type { IHttpResponseEnvelope } from './IHttpResponseEnvelope.js';
export type { HttpResponseType } from './HttpResponseType.js';
export type { IAbortSignalLike } from './IAbortSignalLike.js';
