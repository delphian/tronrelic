/**
 * @fileoverview Tests for the checks both MCP endpoints apply before the SDK
 * sees a request: kill switch, method, token placement, bearer challenges,
 * scope, and group membership on `/mcp`, and anonymous admission on
 * `/mcp/public`.
 */

import { describe, it, expect, vi } from 'vitest';
import { McpEndpointController } from '../api/mcp-endpoint.controller.js';
import type { McpCallerOutcome } from '../services/mcp-caller.resolver.js';
import { OAuthCallerAuthenticator } from '../services/OAuthCallerAuthenticator.js';
import { AnonymousCallerAuthenticator } from '../services/AnonymousCallerAuthenticator.js';
import { AnonymousCallerKeyer } from '../services/AnonymousCallerKeyer.js';

/** A silent logger. */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;

/** The signed-in endpoint's URLs, used in challenges. */
const URLS = {
    resourceUrl: 'https://tronrelic.test/mcp',
    resourceMetadataUrl: 'https://tronrelic.test/.well-known/oauth-protected-resource/mcp',
    allowedOriginHosts: ['tronrelic.test']
};

/** The public endpoint's URLs; it never challenges, so it names no metadata document. */
const PUBLIC_URLS = {
    resourceUrl: 'https://tronrelic.test/mcp/public',
    allowedOriginHosts: ['tronrelic.test']
};

/** A meter that records nothing, with spies to check what would have been counted. */
function meter() {
    return { observe: vi.fn(), recordWithheld: vi.fn() };
}

/**
 * Build a signed-in endpoint controller whose kill switch and caller outcome are fixed.
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
        new OAuthCallerAuthenticator({ resolve } as any, logger),
        { create: vi.fn() } as any,
        URLS,
        meter(),
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

/**
 * Build a JSON-RPC request whose body is already parsed, which makes the JSON
 * parser pass it through untouched.
 */
function rpc(body: unknown, headers: Record<string, string> = { Authorization: 'Bearer abc' }) {
    return Object.assign(request({ headers }), { body, _body: true });
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
            new OAuthCallerAuthenticator({ resolve } as any, logger),
            { create: vi.fn() } as any,
            URLS,
            meter(),
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
            new OAuthCallerAuthenticator({ resolve: vi.fn(async () => { throw new Error('database down'); }) } as any, logger),
            { create: vi.fn() } as any,
            URLS,
            meter(),
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

    describe('refused tool calls', () => {
        /** A verified caller in mcp-users and admin, calling from an address the test names. */
        const admitted: McpCallerOutcome = {
            kind: 'ok',
            caller: {
                endpoint: 'oauth',
                principalKind: 'user',
                principalId: 'user-1',
                groups: ['mcp-users', 'admin'],
                claims: { userId: 'user-1', clientId: 'client-1', scopes: ['mcp:tools'] },
                endUser: { userId: 'user-1', groups: ['mcp-users', 'admin'] },
                ip: '203.0.113.9'
            } as any
        };

        /**
         * Build an admitted controller whose served list and refusal reason are
         * fixed, with the hand-off to the SDK stubbed out.
         *
         * @param served - Names of the tools served to the caller.
         * @returns The controller, the exposure service's explain spy, and the meter.
         */
        function buildAdmitted(served: string[]) {
            const explainWithheld = vi.fn(async () => 'ip-not-allowed');
            const callMeter = meter();
            const controller = new McpEndpointController(
                { get: vi.fn(async () => ({ enabled: true })) } as any,
                { getServedTools: vi.fn(async () => served.map(name => ({ tool: { name }, restricted: false, scrubSecrets: false }))), explainWithheld } as any,
                new OAuthCallerAuthenticator({ resolve: vi.fn(async () => admitted) } as any, logger),
                { create: vi.fn() } as any,
                URLS,
                callMeter,
                logger
            );
            // The SDK hand-off needs a real Node request; these tests stop before it.
            vi.spyOn(controller as any, 'handOff').mockResolvedValue(undefined);
            return { controller, explainWithheld, callMeter };
        }

        it('logs an error and counts the refusal when a call names a tool that was not served', async () => {
            logger.error.mockClear();
            const { controller, explainWithheld, callMeter } = buildAdmitted(['tronrelic-get-log-statistics']);
            await controller.handle(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tronrelic-query-system-logs' } }), response().res, vi.fn());
            expect(explainWithheld).toHaveBeenCalledWith('tronrelic-query-system-logs', { groups: ['mcp-users', 'admin'], ip: '203.0.113.9' });
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({ tool: 'tronrelic-query-system-logs', reason: 'ip-not-allowed', principalId: 'user-1', ip: '203.0.113.9' }),
                expect.stringContaining('tronrelic-query-system-logs')
            );
            expect(callMeter.recordWithheld).toHaveBeenCalledWith(expect.objectContaining({ principalId: 'user-1' }), 'tronrelic-query-system-logs', 'ip-not-allowed');
        });

        it('logs nothing for a served tool or a request that is not a tool call', async () => {
            logger.error.mockClear();
            const { controller, explainWithheld, callMeter } = buildAdmitted(['tronrelic-get-log-statistics']);
            await controller.handle(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tronrelic-get-log-statistics' } }), response().res, vi.fn());
            await controller.handle(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), response().res, vi.fn());
            // Missing jsonrpc and id: the SDK rejects it as an invalid request, so no tool was refused.
            await controller.handle(rpc({ method: 'tools/call', params: { name: 'tronrelic-query-system-logs' } }), response().res, vi.fn());
            expect(explainWithheld).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
            expect(callMeter.recordWithheld).not.toHaveBeenCalled();
        });
    });

    describe('public endpoint', () => {
        /**
         * Build a public endpoint controller with the hand-off to the SDK stubbed out.
         *
         * @param served - Names of the tools served to anonymous callers.
         * @returns The controller, the exposure service's served-list spy, and the meter.
         */
        function buildPublic(served: string[] = []) {
            const getServedTools = vi.fn(async () => served.map(name => ({ tool: { name }, restricted: false, scrubSecrets: false })));
            const explainWithheld = vi.fn(async () => 'not-granted');
            const callMeter = meter();
            const controller = new McpEndpointController(
                { get: vi.fn(async () => ({ enabled: true })) } as any,
                { getServedTools, explainWithheld } as any,
                new AnonymousCallerAuthenticator(new AnonymousCallerKeyer('test-salt'), URLS.resourceUrl),
                { create: vi.fn() } as any,
                PUBLIC_URLS,
                callMeter,
                logger
            );
            const handOff = vi.spyOn(controller as any, 'handOff').mockResolvedValue(undefined);
            return { controller, getServedTools, callMeter, handOff };
        }

        it('admits a request with no credentials as an anonymous caller in the anonymous group only', async () => {
            const { controller, getServedTools, handOff } = buildPublic();
            await controller.handle(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {}), response().res, vi.fn());
            expect(getServedTools).toHaveBeenCalledWith({ groups: ['anonymous'], ip: '203.0.113.9' });
            const caller = handOff.mock.calls[0][2] as any;
            expect(caller.principalKind).toBe('anonymous');
            expect(caller.endUser).toBeUndefined();
            expect(caller.principalId).toMatch(/^[0-9a-f]{16}$/);
        });

        it('refuses a request carrying credentials with a 400 pointing at /mcp, and never challenges', async () => {
            const { controller, handOff } = buildPublic();
            const { res, recorded } = response();
            await controller.handle(request({ headers: { Authorization: 'Bearer abc' } }), res, vi.fn());
            expect(recorded.status).toBe(400);
            expect(recorded.headers['WWW-Authenticate']).toBeUndefined();
            expect(JSON.stringify(recorded.body)).toContain(URLS.resourceUrl);
            expect(handOff).not.toHaveBeenCalled();
        });

        it('logs a withheld call at warn rather than error, and counts it', async () => {
            logger.warn.mockClear();
            logger.error.mockClear();
            const { controller, callMeter } = buildPublic(['blockchain-network-stats']);
            await controller.handle(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tronrelic-query-system-logs' } }, {}), response().res, vi.fn());
            expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ tool: 'tronrelic-query-system-logs', reason: 'not-granted' }), expect.any(String));
            expect(logger.error).not.toHaveBeenCalled();
            expect(callMeter.recordWithheld).toHaveBeenCalledWith(expect.objectContaining({ principalKind: 'anonymous' }), 'tronrelic-query-system-logs', 'not-granted');
        });
    });
});
