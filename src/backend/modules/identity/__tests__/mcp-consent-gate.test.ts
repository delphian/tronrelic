/**
 * Tests for the consent gate that stops users outside `mcp-users` from
 * storing an OAuth grant by posting to `/oauth2/consent` directly.
 *
 * The pure check is tested rather than the Better Auth plugin wrapper, so the
 * tests need no Better Auth request context.
 */
import { describe, it, expect, vi } from 'vitest';
import { APIError } from 'better-auth/api';
import type { ISystemLogService } from '@/types';
import { MCP_USERS_GROUP_ID } from '@/types';
import { enforceMcpConsentMembership } from '../services/createMcpConsentGate.js';

/**
 * Build a logger double whose methods are spies.
 *
 * @returns A logger the code under test can call freely.
 */
function buildLogger(): ISystemLogService {
    const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: () => logger
    } as unknown as ISystemLogService;
    return logger;
}

describe('enforceMcpConsentMembership', () => {
    it('refuses an approval from a user outside the MCP group', () => {
        const logger = buildLogger();
        const user = { id: 'u1', groups: ['admin'] };

        expect(() => enforceMcpConsentMembership({ accept: true }, user, logger)).toThrow(APIError);
        expect(logger.info).toHaveBeenCalled();
    });

    it('allows an approval from a member', () => {
        const user = { id: 'u1', groups: [MCP_USERS_GROUP_ID] };

        expect(() => enforceMcpConsentMembership({ accept: true }, user, buildLogger())).not.toThrow();
    });

    it('lets a non-member deny, so the app still receives access_denied', () => {
        const user = { id: 'u1', groups: [] };

        expect(() => enforceMcpConsentMembership({ accept: false }, user, buildLogger())).not.toThrow();
    });

    it('treats a malformed groups field as no membership', () => {
        const user = { id: 'u1', groups: MCP_USERS_GROUP_ID };

        expect(() => enforceMcpConsentMembership({ accept: true }, user, buildLogger())).toThrow(APIError);
    });

    it('leaves a request with no session to the endpoint', () => {
        expect(() => enforceMcpConsentMembership({ accept: true }, null, buildLogger())).not.toThrow();
    });
});
