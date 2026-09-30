/**
 * @fileoverview Tests for the checks the MCP endpoint applies before the SDK
 * sees a request: kill switch, method, token placement, bearer challenges,
 * scope, and group membership.
 */

import { describe, it, expect, vi } from 'vitest';
import { McpEndpointController } from '../api/mcp-endpoint.controller.js';
import type { McpCallerOutcome } from '../services/mcp-caller.resolver.js';

/** A silent logger. */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;

/** The endpoint URLs used in challenges. */
const URLS = {
    resourceUrl: 'https://tronrelic.test/mcp',
    resourceMetadataUrl: 'https://tronrelic.test/.well-known/oauth-protected-resource/mcp',
    allowedOriginHosts: ['tronrelic.test']
};

/**
 * Build a controller whose kill switch and caller outcome are fixed.
 *
 * @param enabled - The kill switch state.
 * @param outcome - What the caller resolver answers.
 * @returns The controller and the resolver spy.
 */
function build(enabled: boolean, outcome: McpCallerOutcome = { kind: 'invalid-token' }) {
    const resolve = vi.fn(async () => outcome);
    const controller = new McpEndpointController(
        { get: vi.fn(async () => ({ enabled })) } as any,
        { getServedTools: vi.fn(async () => []) } as any,
        { resolve } as any,
        { create: vi.fn() } as any,
        URLS,
        logger
    );
    return { controller, resolve };
}

/**
 * Build a minimal Express-like request.
 *
 * @param options - Method, query, and headers to set.
 * @returns The request.
 */
function request(options: { method?: string; query?: Record<string, string>; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = Object.fromEntries(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        method: options.method ?? 'POST',
        query: options.query ?? {},
        headers,
        ip: '203.0.113.9',
        get: (name: string) => headers[name.toLowerCase()]
    } as any;
}

/**
 * Build a response recorder with the chainable methods the controller calls.
 *
 * @returns The response and what it recorded.
 */
function response() {
    const recorded: { status?: number; headers: Record<string, string>; body?: unknown } = { headers: {} };
    const res: any = {
        headersSent: false,
        status: vi.fn((code: number) => { recorded.status = code; return res; }),
        set: vi.fn((name: string, value: string) => { recorded.headers[name] = value; return res; }),
        json: vi.fn((body: unknown) => { recorded.body = body; res.headersSent = true; return res; })
    };
    return { res, recorded };
}

describe('McpEndpointController', () => {
    it('answers 503 while the kill switch is off, before checking credentials', async () => {
        const { controller, resolve } = build(false);
        const { res, recorded } = response();
        await controller.handle(request({ headers: { Authorization: 'Bearer abc' } }), res, vi.fn());
        expect(recorded.status).toBe(503);
        expect(resolve).not.toHaveBeenCalled();
    });

    it('answers 503 with a short Retry-After when the kill switch cannot be read', async () => {
        const resolve = vi.fn();
        const next = vi.fn();
        const controller = new McpEndpointController(
            { get: vi.fn(async () => { throw new Error('database down'); }) } as any,
            { getServedTools: vi.fn(async () => []) } as any,
            { resolve } as any,
            { create: vi.fn() } as any,
            URLS,
            logger
        );
        const { res, recorded } = response();
        await controller.handle(request({ headers: { Authorization: 'Bearer abc' } }), res, next);
        expect(recorded.status).toBe(503);
        expect(recorded.headers['Retry-After']).toBe('30');
        expect(next).not.toHaveBeenCalled();
        expect(resolve).not.toHaveBeenCalled();
    });

    it('asks for offline_access in the challenge so clients receive a refresh token', async () => {
        const { controller } = build(true);
        const { res, recorded } = response();
        await controller.handle(request(), res, vi.fn());
        expect(recorded.headers['WWW-Authenticate']).toContain('scope="mcp:tools offline_access"');
    });

    it('answers 405 with an Allow header for non-POST methods', async () => {
        const { controller } = build(true);
        const { res, recorded } = response();
        await controller.handle(request({ method: 'GET' }), res, vi.fn());
        expect(recorded.status).toBe(405);
        expect(recorded.headers.Allow).toBe('POST');
    });

    it('refuses a token sent in the query string', async () => {
        const { controller, resolve } = build(true);
        const { res, recorded } = response();
        await controller.handle(request({ query: { access_token: 'abc' } }), res, vi.fn());
        expect(recorded.status).toBe(400);
        expect(resolve).not.toHaveBeenCalled();
    });

    it('challenges a request with no token, pointing at the resource metadata', async () => {
        const { controller } = build(true);
        const { res, recorded } = response();
        await controller.handle(request(), res, vi.fn());
        expect(recorded.status).toBe(401);
        expect(recorded.headers['WWW-Authenticate']).toContain(`resource_metadata="${URLS.resourceMetadataUrl}"`);
        expect(recorded.headers['WWW-Authenticate']).not.toContain('error=');
    });

    it('challenges an invalid token with error="invalid_token"', async () => {
        const { controller } = build(true, { kind: 'invalid-token' });
        const { res, recorded } = response();
        await controller.handle(request({ headers: { Authorization: 'Bearer abc' } }), res, vi.fn());
        expect(recorded.status).toBe(401);
        expect(recorded.headers['WWW-Authenticate']).toContain('error="invalid_token"');
    });

    it('answers 503, not 401, when the caller cannot be checked because a store is down', async () => {
        const next = vi.fn();
        const controller = new McpEndpointController(
            { get: vi.fn(async () => ({ enabled: true })) } as any,
            { getServedTools: vi.fn(async () => []) } as any,
            { resolve: vi.fn(async () => { throw new Error('database down'); }) } as any,
            { create: vi.fn() } as any,
            URLS,
            logger
        );
        const { res, recorded } = response();
        await controller.handle(request({ headers: { Authorization: 'Bearer abc' } }), res, next);
        expect(recorded.status).toBe(503);
        expect(recorded.headers['Retry-After']).toBe('30');
        expect(recorded.headers['WWW-Authenticate']).toBeUndefined();
        expect(next).not.toHaveBeenCalled();
    });

    it('answers 403 insufficient_scope for a token without the MCP scope', async () => {
        const { controller } = build(true, { kind: 'insufficient-scope' });
        const { res, recorded } = response();
        await controller.handle(request({ headers: { Authorization: 'Bearer abc' } }), res, vi.fn());
        expect(recorded.status).toBe(403);
        expect(recorded.headers['WWW-Authenticate']).toContain('error="insufficient_scope"');
    });

    it('answers 403 for a user outside the MCP group', async () => {
        const { controller } = build(true, { kind: 'not-member' });
        const { res, recorded } = response();
        await controller.handle(request({ headers: { Authorization: 'Bearer abc' } }), res, vi.fn());
        expect(recorded.status).toBe(403);
        expect(recorded.headers['WWW-Authenticate']).toBeUndefined();
    });
});
