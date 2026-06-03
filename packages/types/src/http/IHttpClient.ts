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
 * supporting types (IHttpRequestConfig, IHttpResponseEnvelope, HttpResponseType)
 * are a provisional union drawn from current consumers (trp-ai-assistant
 * streaming + abort + family, trp-telegram-bot multipart + body-size caps,
 * trp-resource-markets generics) and are expected to change.
 *
 * Interim convention until the switch lands: type injected http as
 * `IPluginContext['http']`, not `import type { AxiosInstance } from 'axios'`.
 */
import type { IHttpRequestConfig } from './IHttpRequestConfig.js';
import type { IHttpResponseEnvelope } from './IHttpResponseEnvelope.js';

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
