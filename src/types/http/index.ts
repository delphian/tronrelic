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
