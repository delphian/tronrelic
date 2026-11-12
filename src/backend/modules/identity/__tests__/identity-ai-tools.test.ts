/**
 * Tests for the identity AI tools and the sign-in event filter behind them:
 * the admin check, input validation, paging, and that nothing secret is
 * returned.
 *
 * The tools are built against plain doubles, so no database or Better Auth
 * instance is needed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IAccountSummary, IAiTool, ISystemLogService, IToolEndUserPrincipal } from '@/types';
import { AI_TOOL_NAMES, buildIdentityAiTools, type IIdentityAiToolDependencies } from '../ai-tools.js';
import type { ISignInEventDocument } from '../database/ISignInEventDocument.js';
import { buildSignInEventFilter } from '../services/SignInEventStore.js';
import { logAuthAttempt } from '../services/createSignInAuditLog.js';

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

/** An account the directory double returns. */
const owner: IAccountSummary = {
    id: 'a'.repeat(24),
    email: 'Owner@Example.com',
    name: 'Owner',
    emailVerified: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    groups: ['admin'],
    primaryWallet: null,
    deletedAt: null
};

/** A stored sign-in event the event double returns. */
const storedEvent: ISignInEventDocument = {
    kind: 'code-sent',
    method: 'email-otp',
    path: '/email-otp/send-verification-otp',
    email: 'owner@example.com',
    userId: null,
    sessionId: null,
    ip: '203.0.113.7',
    forwardedFor: '203.0.113.7',
    country: 'US',
    userAgent: 'TestBrowser/1.0',
    status: null,
    reason: null,
    occurredAt: new Date('2026-11-11T10:32:54Z')
};

/** The signed-in admin and non-admin callers. */
const adminCaller: IToolEndUserPrincipal = { userId: 'admin-user' };
const memberCaller: IToolEndUserPrincipal = { userId: 'member-user' };

describe('identity AI tools', () => {
    let deps: IIdentityAiToolDependencies;
    let logger: ISystemLogService;
    let tools: Record<string, IAiTool>;

    /**
     * Call one tool the way the governor does.
     *
     * @param name - The tool's name.
     * @param input - The arguments the model supplied.
     * @param principal - The signed-in caller, when there is one.
     * @returns The tool's answer.
     */
    const call = (name: string, input: Record<string, unknown>, principal?: IToolEndUserPrincipal) =>
        tools[name].handler(input, principal) as Promise<Record<string, unknown>>;

    beforeEach(() => {
        logger = buildLogger();
        deps = {
            accounts: {
                countAccounts: vi.fn(async () => 1),
                getAccount: vi.fn(async (id: string) => (id === owner.id ? owner : null)),
                getAccountByEmail: vi.fn(async (email: string) => (email.toLowerCase() === owner.email.toLowerCase() ? owner : null)),
                getAccountsByIds: vi.fn(async () => [owner]),
                listAccounts: vi.fn(async () => ({ accounts: [owner], total: 1 }))
            },
            listSignInEvents: vi.fn(async () => ({ events: [storedEvent], total: 1 })),
            listSessions: vi.fn(async () => [{
                id: 'session-1',
                createdAt: '2026-11-10T00:00:00.000Z',
                updatedAt: '2026-11-11T00:00:00.000Z',
                expiresAt: '2026-11-17T00:00:00.000Z',
                ipAddress: '203.0.113.7',
                userAgent: 'TestBrowser/1.0'
            }]),
            listWallets: vi.fn(async () => []),
            listConnectedApps: vi.fn(async () => []),
            isAdmin: vi.fn(async (userId: string) => userId === adminCaller.userId)
        };
        tools = Object.fromEntries(buildIdentityAiTools(deps, logger).map(tool => [tool.name, tool]));
    });

    // These tools return every user's email and network address, so their
    // classification is what keeps them off the default MCP path.
    it('declares every tool as a secret, read-only source of untrusted content', () => {
        for (const tool of Object.values(tools)) {
            expect(tool.capability).toEqual({
                sideEffect: 'read',
                reversible: true,
                sensitivity: 'secret',
                surfacesUntrustedContent: true
            });
        }
    });

    it('refuses a signed-in caller who is not an administrator, without reading anything', async () => {
        for (const name of Object.values(AI_TOOL_NAMES)) {
            const answer = await call(name, {}, memberCaller);
            expect(answer).toMatchObject({ success: false, errorKind: 'denied' });
        }

        expect(deps.accounts.listAccounts).not.toHaveBeenCalled();
        expect(deps.listSignInEvents).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('allows an administrator, and a server-side call that has no signed-in caller', async () => {
        await expect(call(AI_TOOL_NAMES.listAccounts, {}, adminCaller)).resolves.toMatchObject({ success: true });
        await expect(call(AI_TOOL_NAMES.listAccounts, {})).resolves.toMatchObject({ success: true });
    });

    it('lists accounts with paging passed through to the directory', async () => {
        vi.mocked(deps.accounts.listAccounts).mockResolvedValue({ accounts: [owner], total: 3 });

        const answer = await call(AI_TOOL_NAMES.listAccounts, { search: ' example.com ', limit: 1, offset: 1 }, adminCaller);

        expect(deps.accounts.listAccounts).toHaveBeenCalledWith({ search: 'example.com', limit: 1, skip: 1 });
        expect(answer).toMatchObject({ total: 3, offset: 1, returned: 1, nextOffset: 2 });
        expect(answer.accounts).toEqual([expect.objectContaining({ id: owner.id, createdAt: '2026-01-01T00:00:00.000Z' })]);
    });

    it('refuses an out-of-range limit with a message the model can correct from', async () => {
        const answer = await call(AI_TOOL_NAMES.listAccounts, { limit: 5000 }, adminCaller);

        expect(answer).toMatchObject({ success: false, errorKind: 'input' });
        expect(String(answer.error)).toContain('limit');
    });

    // Resolving the address by paging the substring search would let anyone
    // hide an account from this tool by putting its address in enough newer
    // display names, so the exact lookup is what the tool must call.
    it('resolves an email through the directory exact lookup, never the substring search', async () => {
        const answer = await call(AI_TOOL_NAMES.getAccount, { email: 'owner@example.com' }, adminCaller);

        expect(deps.accounts.getAccountByEmail).toHaveBeenCalledWith('owner@example.com');
        expect(deps.accounts.listAccounts).not.toHaveBeenCalled();
        expect(answer).toMatchObject({ found: true, account: { id: owner.id } });
        expect(deps.listSessions).toHaveBeenCalledWith(owner.id);
        expect(deps.listSignInEvents).toHaveBeenCalledWith({ email: 'owner@example.com' }, { limit: 20, offset: 0 });
    });

    it('reports an unknown account as not found instead of an error', async () => {
        const answer = await call(AI_TOOL_NAMES.getAccount, { userId: 'c'.repeat(24) }, adminCaller);

        expect(answer).toEqual({ success: true, found: false });
    });

    it('requires exactly one of userId and email, and a well-formed userId', async () => {
        const neither = await call(AI_TOOL_NAMES.getAccount, {}, adminCaller);
        const both = await call(AI_TOOL_NAMES.getAccount, { userId: owner.id, email: owner.email }, adminCaller);
        const malformed = await call(AI_TOOL_NAMES.getAccount, { userId: { $ne: '' } }, adminCaller);

        for (const answer of [neither, both, malformed]) {
            expect(answer).toMatchObject({ success: false, errorKind: 'input' });
        }
        expect(deps.accounts.getAccount).not.toHaveBeenCalled();
    });

    it('turns sign-in event filters into a validated query', async () => {
        const answer = await call(
            AI_TOOL_NAMES.listSignInEvents,
            { email: 'Owner@Example.com', kind: 'sign-in-failed', since: '2026-11-10T00:00:00Z', limit: 10 },
            adminCaller
        );

        expect(deps.listSignInEvents).toHaveBeenCalledWith(
            { email: 'owner@example.com', kind: 'sign-in-failed', since: new Date('2026-11-10T00:00:00Z') },
            { limit: 10, offset: 0 }
        );
        expect(answer).toMatchObject({ total: 1, returned: 1, nextOffset: null });
        expect(answer.events).toEqual([expect.objectContaining({ kind: 'code-sent', occurredAt: '2026-11-11T10:32:54.000Z' })]);
    });

    it('refuses an unknown kind, an unreadable time, and a reversed time window', async () => {
        const badKind = await call(AI_TOOL_NAMES.listSignInEvents, { kind: 'everything' }, adminCaller);
        const badTime = await call(AI_TOOL_NAMES.listSignInEvents, { since: 'yesterday' }, adminCaller);
        const reversed = await call(
            AI_TOOL_NAMES.listSignInEvents,
            { since: '2026-11-11T00:00:00Z', until: '2026-11-10T00:00:00Z' },
            adminCaller
        );

        for (const answer of [badKind, badTime, reversed]) {
            expect(answer).toMatchObject({ success: false, errorKind: 'input' });
        }
        expect(deps.listSignInEvents).not.toHaveBeenCalled();
    });

    it('answers a generic failure and logs the cause when a dependency throws', async () => {
        vi.mocked(deps.listSignInEvents).mockRejectedValue(new Error('mongo host db-internal unreachable'));

        const answer = await call(AI_TOOL_NAMES.listSignInEvents, {}, adminCaller);

        expect(answer).toMatchObject({ success: false, errorKind: 'failed' });
        expect(String(answer.error)).not.toContain('db-internal');
        expect(logger.error).toHaveBeenCalled();
    });
});

describe('buildSignInEventFilter', () => {
    it('returns an empty filter when nothing is asked for', () => {
        expect(buildSignInEventFilter({})).toEqual({});
    });

    it('matches each field by equality and the time window by range', () => {
        const since = new Date('2026-11-10T00:00:00Z');
        const until = new Date('2026-11-11T00:00:00Z');

        const filter = buildSignInEventFilter({
            email: ' Owner@Example.com ',
            userId: 'a'.repeat(24),
            ip: '203.0.113.7',
            method: 'oauth:github',
            kind: 'sign-in-succeeded',
            since,
            until
        });

        expect(filter).toEqual({
            email: 'owner@example.com',
            userId: 'a'.repeat(24),
            ip: '203.0.113.7',
            method: 'oauth:github',
            kind: 'sign-in-succeeded',
            occurredAt: { $gte: since, $lte: until }
        });
    });
});

describe('logAuthAttempt returned event', () => {
    it('returns the event to store, with the outcome fields filled in', () => {
        const event = logAuthAttempt(buildLogger(), {
            path: '/sign-in/email-otp',
            body: { email: 'owner@example.com', otp: '123456' },
            returned: { token: 'secret-session-token' },
            newSession: { session: { id: 'session-1' }, user: { id: 'user-1', email: 'owner@example.com' } }
        });

        expect(event).toMatchObject({
            kind: 'sign-in-succeeded',
            method: 'email-otp',
            email: 'owner@example.com',
            userId: 'user-1',
            sessionId: 'session-1',
            status: null,
            reason: null
        });
        expect(event?.occurredAt).toBeInstanceOf(Date);
        expect(JSON.stringify(event)).not.toContain('123456');
        expect(JSON.stringify(event)).not.toContain('secret-session-token');
    });

    it('returns null for a request that is not recorded', () => {
        expect(logAuthAttempt(buildLogger(), { path: '/get-session' })).toBeNull();
    });
});
