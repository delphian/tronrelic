/**
 * @fileoverview Tests for the MCP caller resolver: token outcomes, scope and
 * membership checks, and the short principal cache.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IMcpAccessTokenClaims, IToolEndUserPrincipal } from '@/types';
import { MCP_TOOLS_SCOPE, MCP_USERS_GROUP_ID } from '@/types';
import { McpCallerResolver } from '../services/mcp-caller.resolver.js';

/** A silent logger. */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;

/** Claims for a token carrying the MCP scope. */
const CLAIMS: IMcpAccessTokenClaims = { userId: 'user-1', clientId: 'https://claude.ai/client', scopes: [MCP_TOOLS_SCOPE, 'offline_access'], tokenId: 'jti-1' };

/** A principal in the MCP group. */
const MEMBER: IToolEndUserPrincipal = { userId: 'user-1', groups: [MCP_USERS_GROUP_ID] };

/** A grant store that records the uses it is told about. */
const usage = { recordUse: vi.fn(async () => undefined) };

describe('McpCallerResolver', () => {
    afterEach(() => {
        vi.useRealTimers();
        usage.recordUse.mockClear();
    });

    it('records a use of the app when it admits a request', async () => {
        const resolver = new McpCallerResolver({ verify: vi.fn(async () => CLAIMS) }, vi.fn(async () => MEMBER), usage, logger);
        await resolver.resolve('token', undefined);
        expect(usage.recordUse).toHaveBeenCalledWith('user-1', 'https://claude.ai/client');
    });

    it('records no use when it refuses a request', async () => {
        const resolver = new McpCallerResolver({ verify: vi.fn(async () => CLAIMS) }, vi.fn(async () => ({ userId: 'user-1', groups: [] })), usage, logger);
        await resolver.resolve('token', undefined);
        expect(usage.recordUse).not.toHaveBeenCalled();
    });

    it('refuses a token the verifier rejects', async () => {
        const resolver = new McpCallerResolver({ verify: vi.fn(async () => null) }, vi.fn(), usage, logger);
        expect(await resolver.resolve('bad', undefined)).toEqual({ kind: 'invalid-token' });
    });

    it('reports a missing scope separately, so the endpoint can answer insufficient_scope', async () => {
        const resolver = new McpCallerResolver({ verify: vi.fn(async () => ({ ...CLAIMS, scopes: ['offline_access'] })) }, vi.fn(async () => MEMBER), usage, logger);
        expect(await resolver.resolve('token', undefined)).toEqual({ kind: 'insufficient-scope' });
    });

    it('treats a deleted account as an invalid token', async () => {
        const resolver = new McpCallerResolver({ verify: vi.fn(async () => CLAIMS) }, vi.fn(async () => null), usage, logger);
        expect(await resolver.resolve('token', undefined)).toEqual({ kind: 'invalid-token' });
    });

    it('refuses a user outside the MCP group', async () => {
        const resolver = new McpCallerResolver({ verify: vi.fn(async () => CLAIMS) }, vi.fn(async () => ({ userId: 'user-1', groups: ['admin'] })), usage, logger);
        expect(await resolver.resolve('token', undefined)).toEqual({ kind: 'not-member' });
    });

    it('admits a member and carries the claims, principal, and IP', async () => {
        const resolver = new McpCallerResolver({ verify: vi.fn(async () => CLAIMS) }, vi.fn(async () => MEMBER), usage, logger);
        expect(await resolver.resolve('token', '203.0.113.9')).toEqual({ kind: 'ok', caller: { claims: CLAIMS, endUser: MEMBER, ip: '203.0.113.9' } });
    });

    it('re-reads group membership once the cache window passes', async () => {
        vi.useFakeTimers();
        const resolveEndUser = vi.fn(async () => MEMBER);
        const resolver = new McpCallerResolver({ verify: vi.fn(async () => CLAIMS) }, resolveEndUser, usage, logger);
        await resolver.resolve('token', undefined);
        await resolver.resolve('token', undefined);
        expect(resolveEndUser).toHaveBeenCalledTimes(1);

        resolveEndUser.mockResolvedValueOnce({ userId: 'user-1', groups: [] });
        vi.advanceTimersByTime(31_000);
        expect(await resolver.resolve('token', undefined)).toEqual({ kind: 'not-member' });
        expect(resolveEndUser).toHaveBeenCalledTimes(2);
    });
});
