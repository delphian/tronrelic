/**
 * @fileoverview Tests for the public endpoint's Server Card, the AI Catalog,
 * and the server identity both are built from.
 *
 * They pin the parts registries and clients check: the reverse-DNS name, the
 * 100-character description limit, the card's schema URL and remote, the CORS
 * headers a browser client needs, and the ETag round trip.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { buildMcpServerIdentity } from '../services/buildMcpServerIdentity.js';
import { buildAiCatalog, buildServerCard, createServerCardHandler } from '../api/server-card.js';

const PUBLIC_URL = 'https://tronrelic.com/mcp/public';

/**
 * A minimal Express response that records what the handler wrote.
 *
 * @returns The response and the recorded headers, status, and body.
 */
function recordingResponse(): { res: Response; headers: Record<string, string>; state: { status: number; body?: string; type?: string } } {
    const headers: Record<string, string> = {};
    const state: { status: number; body?: string; type?: string } = { status: 200 };
    const res = {
        set: vi.fn((name: string | Record<string, string>, value?: string) => {
            Object.assign(headers, typeof name === 'string' ? { [name]: value } : name);
            return res;
        }),
        status: vi.fn((code: number) => { state.status = code; return res; }),
        type: vi.fn((type: string) => { state.type = type; return res; }),
        send: vi.fn((body: string) => { state.body = body; return res; }),
        end: vi.fn(() => res)
    } as unknown as Response;
    return { res, headers, state };
}

/**
 * A minimal request with a method and optional headers.
 *
 * @param method - The HTTP method.
 * @param requestHeaders - Request headers, keyed by lower-case name.
 * @returns The request.
 */
function request(method: string, requestHeaders: Record<string, string> = {}): Request {
    return { method, get: (name: string) => requestHeaders[name.toLowerCase()] } as unknown as Request;
}

describe('buildMcpServerIdentity', () => {
    it('derives the reverse-DNS name and every URL from the origin, with a description the card accepts', () => {
        const identity = buildMcpServerIdentity('https://tronrelic.com/some/path');

        expect(identity.name).toBe('com.tronrelic/mcp');
        expect(identity.websiteUrl).toBe('https://tronrelic.com');
        expect(identity.icons[0].src).toBe('https://tronrelic.com/icon.png');
        expect(identity.termsUrl).toBe('https://tronrelic.com/terms');
        expect(identity.description.length).toBeLessThanOrEqual(100);
        expect(identity.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    });
});

describe('Server Card and AI Catalog', () => {
    const identity = buildMcpServerIdentity('https://tronrelic.com');

    it('names the schema, the identity, and one streamable-http remote at the public URL', () => {
        const card = buildServerCard(identity, PUBLIC_URL) as Record<string, any>;

        expect(card.$schema).toBe('https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json');
        expect(card).toMatchObject({ name: 'com.tronrelic/mcp', title: 'TronRelic', version: identity.version });
        expect(card.remotes).toEqual([expect.objectContaining({ type: 'streamable-http', url: PUBLIC_URL })]);
        expect(card.remotes[0].supportedProtocolVersions[0]).toBe('2026-07-28');
        expect(card.tools).toBeUndefined();
    });

    it('lists the card in the catalog under a urn:air identifier', () => {
        const catalog = buildAiCatalog(identity, `${PUBLIC_URL}/server-card`);

        expect(catalog).toEqual({
            specVersion: '1.0',
            entries: [{ identifier: 'urn:air:tronrelic.com:mcp:public', type: 'application/mcp-server-card+json', url: `${PUBLIC_URL}/server-card` }]
        });
    });

    it('serves the card to any origin with its media type, caching headers, and ETag', () => {
        const handler = createServerCardHandler(identity, PUBLIC_URL);
        const { res, headers, state } = recordingResponse();

        handler(request('GET'), res);

        expect(headers['Access-Control-Allow-Origin']).toBe('*');
        expect(headers['Access-Control-Expose-Headers']).toBe('ETag');
        expect(headers['Cache-Control']).toBe('public, max-age=3600');
        expect(state.type).toBe('application/mcp-server-card+json');
        expect(JSON.parse(state.body!).name).toBe('com.tronrelic/mcp');
        expect(headers.ETag).toMatch(/^"[0-9a-f]{32}"$/);
    });

    it('answers a matching If-None-Match with 304, a preflight with 204, and another method with 405', () => {
        const handler = createServerCardHandler(identity, PUBLIC_URL);
        const first = recordingResponse();
        handler(request('GET'), first.res);

        const repeat = recordingResponse();
        handler(request('GET', { 'if-none-match': first.headers.ETag }), repeat.res);
        const preflight = recordingResponse();
        handler(request('OPTIONS'), preflight.res);
        const post = recordingResponse();
        handler(request('POST'), post.res);

        expect(repeat.state.status).toBe(304);
        expect(repeat.state.body).toBeUndefined();
        expect(preflight.state.status).toBe(204);
        expect(post.state.status).toBe(405);
        expect(post.headers.Allow).toBe('GET, HEAD, OPTIONS');
    });
});
