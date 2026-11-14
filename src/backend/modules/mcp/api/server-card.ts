/**
 * @fileoverview The public endpoint's MCP Server Card and the site's AI Catalog.
 *
 * A Server Card (MCP extension SEP-2127, final October 2026) is a static JSON
 * document a client or registry reads before connecting: who runs the server,
 * where it lives, and which protocol versions it speaks. The AI Catalog at
 * `/.well-known/ai-catalog.json` lists the card, so a crawler that knows only
 * the domain can find it. Facts from the extension's `docs/discovery.md`:
 *
 * - Card media type `application/mcp-server-card+json`; catalog
 *   `application/ai-catalog+json`.
 * - CORS: `Access-Control-Allow-Origin: *`, methods `GET`, request headers
 *   `Content-Type, If-None-Match`, exposed header `ETag` (required).
 * - Caching: `Cache-Control: public, max-age=3600`, an `ETag`, and `304` for a
 *   matching `If-None-Match` (recommended).
 * - Tools are deliberately not listed; clients read them with `tools/list`.
 */

import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { SUPPORTED_PROTOCOL_VERSIONS as SDK_LEGACY_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server';
import type { IMcpServerIdentity } from '../services/IMcpServerIdentity.js';

/** Schema URL every Server Card must name. */
const SERVER_CARD_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';

/** Media type of a Server Card. */
const SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json';

/** Media type of an AI Catalog. */
const AI_CATALOG_MEDIA_TYPE = 'application/ai-catalog+json';

/**
 * Protocol versions the public endpoint answers. The SDK serves the stateless
 * 2026-07-28 revision natively and older revisions through its legacy path.
 * Its exported list names only the older ones, so the modern revision is
 * written here and the rest come from the SDK, which keeps the card in step
 * with an SDK upgrade.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2026-07-28', ...SDK_LEGACY_PROTOCOL_VERSIONS];

/** Methods a discovery document answers. Anything else is refused with 405. */
const ALLOWED_METHODS = 'GET, HEAD, OPTIONS';

/** A JSON document with the headers it is served under. */
interface IDiscoveryDocument {
    /** The serialized body, built once. */
    body: string;

    /** Strong validator over the body, for `If-None-Match`. */
    etag: string;

    /** The document's media type. */
    mediaType: string;
}

/**
 * Serialize a document once and compute its ETag, because it never changes
 * while the process runs.
 *
 * @param value - The document.
 * @param mediaType - Its media type.
 * @returns The body, ETag, and media type.
 */
function toDiscoveryDocument(value: unknown, mediaType: string): IDiscoveryDocument {
    const body = JSON.stringify(value);
    const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;
    return { body, etag, mediaType };
}

/**
 * Build the Server Card for the public endpoint.
 *
 * @param identity - The server identity, shared with the handshake so the two
 *   cannot disagree.
 * @param publicUrl - The public endpoint URL clients connect to.
 * @returns The card document.
 */
export function buildServerCard(identity: IMcpServerIdentity, publicUrl: string): Record<string, unknown> {
    return {
        $schema: SERVER_CARD_SCHEMA,
        name: identity.name,
        title: identity.title,
        version: identity.version,
        description: identity.description,
        websiteUrl: identity.websiteUrl,
        icons: identity.icons,
        remotes: [{ type: 'streamable-http', url: publicUrl, supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS }]
    };
}

/**
 * Build the AI Catalog listing the Server Card.
 *
 * The entry identifier takes the form `urn:air:{publisher}:{namespace}:{name}`.
 * The publisher is the site's host, the namespace is `mcp`, and the name is
 * `public`, after the endpoint the card describes, which leaves room for a card
 * for the signed-in endpoint beside it.
 *
 * @param identity - The server identity; its site URL gives the publisher.
 * @param serverCardUrl - Where the card is served.
 * @returns The catalog document.
 */
export function buildAiCatalog(identity: IMcpServerIdentity, serverCardUrl: string): Record<string, unknown> {
    const publisher = new URL(identity.websiteUrl).hostname;
    return {
        specVersion: '1.0',
        entries: [{ identifier: `urn:air:${publisher}:mcp:public`, type: SERVER_CARD_MEDIA_TYPE, url: serverCardUrl }]
    };
}

/**
 * Build an Express handler serving one discovery document with the CORS and
 * caching headers the extension asks for.
 *
 * The global CORS middleware is skipped for these paths (`loaders/express.ts`),
 * because it refuses browser origins other than the site's own and the card
 * must be readable from any origin. Nothing here reads cookies or credentials,
 * so a wildcard origin exposes nothing that is not already public.
 *
 * @param value - The document to serve.
 * @param mediaType - Its media type.
 * @returns A handler for `GET`, `HEAD`, and the `OPTIONS` preflight that
 *   browsers send because `If-None-Match` is not a simple header.
 */
function createDiscoveryHandler(value: unknown, mediaType: string): (req: Request, res: Response) => void {
    const document = toDiscoveryDocument(value, mediaType);
    /**
     * Answer one request for the document: a preflight, a conditional request
     * that already holds the current version, or the document itself.
     *
     * @param req - The request; its method and `If-None-Match` decide the answer.
     * @param res - The response the headers and body are written to.
     */
    return (req: Request, res: Response): void => {
        res.set({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
            'Access-Control-Expose-Headers': 'ETag'
        });
        if (req.method === 'OPTIONS') {
            res.status(204).end();
        } else if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.set('Allow', ALLOWED_METHODS).status(405).end();
        } else {
            res.set({ 'Cache-Control': 'public, max-age=3600', ETag: document.etag });
            if (req.get('If-None-Match') === document.etag) {
                res.status(304).end();
            } else {
                res.type(document.mediaType).send(document.body);
            }
        }
    };
}

/**
 * Build the handler for the public endpoint's Server Card.
 *
 * @param identity - The server identity.
 * @param publicUrl - The public endpoint URL the card points clients at.
 * @returns The Express handler.
 */
export function createServerCardHandler(identity: IMcpServerIdentity, publicUrl: string): (req: Request, res: Response) => void {
    return createDiscoveryHandler(buildServerCard(identity, publicUrl), SERVER_CARD_MEDIA_TYPE);
}

/**
 * Build the handler for the site's AI Catalog.
 *
 * @param identity - The server identity.
 * @param serverCardUrl - Where the Server Card is served.
 * @returns The Express handler.
 */
export function createAiCatalogHandler(identity: IMcpServerIdentity, serverCardUrl: string): (req: Request, res: Response) => void {
    return createDiscoveryHandler(buildAiCatalog(identity, serverCardUrl), AI_CATALOG_MEDIA_TYPE);
}
