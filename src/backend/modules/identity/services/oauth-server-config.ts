/**
 * @fileoverview The public URLs of the OAuth authorization server and the MCP
 * resource it issues tokens for.
 *
 * Several components must agree on these strings exactly. The token issuer
 * (`iss`) must match the discovery document's `issuer`, and the MCP endpoint
 * must reject any token whose audience (`aud`) is not its own URL. Computing
 * them once, from the same base URL Better Auth already uses, keeps them from
 * drifting apart.
 */

/**
 * The URLs the OAuth server and the MCP endpoint publish.
 */
export interface IOAuthServerConfig {
    /**
     * The public URL Better Auth runs under, exactly as resolved from the
     * environment. `createAuth` passes it to Better Auth as `baseURL`, so the
     * auth server and the issuer below are derived from one value and cannot
     * disagree.
     */
    baseUrl: string;

    /**
     * The OAuth issuer: the site's origin with no path and no trailing slash.
     * Written into every access token and served in the discovery document.
     */
    issuer: string;

    /** The MCP endpoint URL, and the only audience the MCP endpoint accepts. */
    mcpResourceUrl: string;

    /** Where the MCP endpoint's protected resource metadata is served (RFC 9728 path form). */
    mcpResourceMetadataUrl: string;

    /**
     * Path of the page that signs users in and asks for consent during an
     * OAuth authorization. Relative, so Better Auth resolves it against the
     * request's own origin.
     */
    authorizePage: string;

    /** The site's host name, the only value a browser `Origin` header may carry on the MCP endpoint. */
    siteHost: string;
}

/** Path the MCP endpoint is mounted at. */
export const MCP_ENDPOINT_PATH = '/mcp';

/** Path of the combined sign-in and consent page in the frontend. */
const AUTHORIZE_PAGE_PATH = '/oauth/authorize';

/**
 * Derive the OAuth and MCP URLs from the site's public base URL.
 *
 * @param baseUrl - The public URL Better Auth runs under (`BETTER_AUTH_URL`,
 *   falling back to `SITE_URL`). Only its origin is used.
 * @returns The URLs every component must agree on.
 * @throws {Error} When the base URL is missing or not a valid URL, because the
 *   OAuth server cannot issue tokens without a stable issuer.
 */
export function resolveOAuthServerConfig(baseUrl: string | undefined): IOAuthServerConfig {
    if (!baseUrl) {
        throw new Error('BETTER_AUTH_URL or SITE_URL must be set so the OAuth issuer and MCP resource URL can be derived.');
    }
    const origin = new URL(baseUrl);
    const issuer = origin.origin;
    return {
        baseUrl,
        issuer,
        mcpResourceUrl: `${issuer}${MCP_ENDPOINT_PATH}`,
        mcpResourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource${MCP_ENDPOINT_PATH}`,
        authorizePage: AUTHORIZE_PAGE_PATH,
        siteHost: origin.hostname
    };
}
