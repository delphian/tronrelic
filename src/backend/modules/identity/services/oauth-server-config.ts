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
     * The public MCP endpoint URL. It takes no sign-in and accepts no token
     * from this server, so it is listed here only so every component derives
     * it from the same origin as the signed-in endpoint.
     */
    mcpPublicUrl: string;

    /** Where the public endpoint's MCP Server Card is served, for discovery before connecting. */
    mcpServerCardUrl: string;

    /** Where the site's AI Catalog is served, listing the Server Card for domain-level discovery. */
    aiCatalogUrl: string;

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

/**
 * Path the public MCP endpoint is mounted at, for callers who do not sign in.
 * A separate URL from {@link MCP_ENDPOINT_PATH} because clients start their
 * sign-in on a 401, which a URL that serves anonymous callers can never send.
 */
export const MCP_PUBLIC_ENDPOINT_PATH = '/mcp/public';

/**
 * Path of the public endpoint's Server Card: `<endpoint>/server-card`, the
 * location the MCP Server Card extension (SEP-2127) reserves.
 */
export const MCP_SERVER_CARD_PATH = `${MCP_PUBLIC_ENDPOINT_PATH}/server-card`;

/** Path of the site's AI Catalog, the well-known location clients try for domain-level discovery. */
export const AI_CATALOG_PATH = '/.well-known/ai-catalog.json';

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
        mcpPublicUrl: `${issuer}${MCP_PUBLIC_ENDPOINT_PATH}`,
        mcpServerCardUrl: `${issuer}${MCP_SERVER_CARD_PATH}`,
        aiCatalogUrl: `${issuer}${AI_CATALOG_PATH}`,
        authorizePage: AUTHORIZE_PAGE_PATH,
        siteHost: origin.hostname
    };
}
