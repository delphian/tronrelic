/**
 * @fileoverview The protected resource metadata document (RFC 9728) for the
 * MCP endpoint.
 *
 * An MCP client that receives a 401 reads this document to learn which
 * authorization server issues tokens for the endpoint and which scope to ask
 * for. Claude uses only the first authorization server listed.
 */

import type { Request, Response } from 'express';
import { MCP_OAUTH_SCOPES } from '@/types';

/**
 * Build an Express handler that serves the metadata document.
 *
 * @param resourceUrl - The MCP endpoint URL; must equal the URL users enter
 *   in their client exactly, since clients compare the two.
 * @param issuer - The OAuth issuer that signs tokens for this endpoint.
 * @returns A handler answering `GET` with the JSON document.
 */
export function createProtectedResourceMetadataHandler(resourceUrl: string, issuer: string): (req: Request, res: Response) => void {
    const document = {
        resource: resourceUrl,
        authorization_servers: [issuer],
        // Includes offline_access: clients request what is listed here, and
        // without it they get no refresh token.
        scopes_supported: [...MCP_OAUTH_SCOPES],
        bearer_methods_supported: ['header'],
        resource_name: 'TronRelic'
    };
    /**
     * Answer a discovery request with the prebuilt document, so an MCP client
     * that received a 401 can find the authorization server.
     *
     * @param _req - Unused; the document is the same for every caller.
     * @param res - Response the JSON document is written to.
     */
    return (_req: Request, res: Response): void => {
        // Public and identical for every caller, so shared caches may keep it
        // briefly. MCP clients fetch it server-to-server; browser access is
        // governed by the application's global CORS policy like any route.
        res.set('Cache-Control', 'public, max-age=300').json(document);
    };
}
