/**
 * Tests for the sign-in audit log: which finished auth requests produce a log
 * entry, at which level, and with which details.
 *
 * The rules are exercised through `logAuthAttempt` with plain values, so no
 * Better Auth request context is needed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { APIError } from 'better-auth/api';
import type { ISystemLogService } from '@/types';
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

/** Headers of a request that arrived through Cloudflare. */
const cloudflareHeaders = new Headers({
    'cf-connecting-ip': '203.0.113.7',
    'x-forwarded-for': '203.0.113.7, 10.0.0.1',
    'cf-ipcountry': 'US',
    'user-agent': 'TestBrowser/1.0'
});

describe('logAuthAttempt', () => {
    let logger: ISystemLogService;

    beforeEach(() => {
        logger = buildLogger();
    });

    it('records a code request with the address and the caller', () => {
        logAuthAttempt(logger, {
            path: '/email-otp/send-verification-otp',
            body: { email: ' Owner@Example.com ', type: 'sign-in' },
            headers: cloudflareHeaders,
            returned: { success: true }
        });

        expect(logger.info).toHaveBeenCalledWith(
            {
                method: 'email-otp',
                path: '/email-otp/send-verification-otp',
                email: 'owner@example.com',
                ip: '203.0.113.7',
                forwardedFor: '203.0.113.7, 10.0.0.1',
                country: 'US',
                userAgent: 'TestBrowser/1.0'
            },
            'Sign-in code sent'
        );
    });

    it('records a refused code request as a warning with the status and reason', () => {
        logAuthAttempt(logger, {
            path: '/email-otp/send-verification-otp',
            body: { email: 'owner@example.com' },
            returned: new APIError('BAD_REQUEST', { code: 'INVALID_EMAIL', message: 'Invalid email' })
        });

        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'owner@example.com', status: 400, reason: 'INVALID_EMAIL' }),
            'Sign-in code request failed'
        );
        expect(logger.info).not.toHaveBeenCalled();
    });

    it('records a successful sign-in with the user and session ids', () => {
        logAuthAttempt(logger, {
            path: '/sign-in/email-otp',
            body: { email: 'owner@example.com', otp: '123456' },
            headers: cloudflareHeaders,
            returned: { token: 'secret-session-token' },
            newSession: { session: { id: 'session-1' }, user: { id: 'user-1', email: 'owner@example.com' } }
        });

        expect(logger.info).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'email-otp',
                email: 'owner@example.com',
                userId: 'user-1',
                sessionId: 'session-1',
                ip: '203.0.113.7'
            }),
            'Sign-in succeeded'
        );
    });

    // Guards the rule in the file header: a code or a token in the log store
    // would let anyone who can read the logs sign in.
    it('never logs the one-time code or the session token', () => {
        logAuthAttempt(logger, {
            path: '/sign-in/email-otp',
            body: { email: 'owner@example.com', otp: '123456' },
            returned: { token: 'secret-session-token' },
            newSession: { session: { id: 'session-1' }, user: { id: 'user-1', email: 'owner@example.com' } }
        });

        const logged = JSON.stringify(vi.mocked(logger.info).mock.calls);
        expect(logged).not.toContain('123456');
        expect(logged).not.toContain('secret-session-token');
    });

    it('records a wrong code as a failed sign-in', () => {
        logAuthAttempt(logger, {
            path: '/sign-in/email-otp',
            body: { email: 'owner@example.com', otp: '000000' },
            headers: cloudflareHeaders,
            returned: new APIError('BAD_REQUEST', { code: 'INVALID_OTP', message: 'Invalid OTP' })
        });

        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'email-otp',
                email: 'owner@example.com',
                status: 400,
                reason: 'INVALID_OTP',
                ip: '203.0.113.7'
            }),
            'Sign-in failed'
        );
    });

    it('names the provider and takes the address from the new session for an OAuth callback', () => {
        logAuthAttempt(logger, {
            path: '/callback/:id',
            params: { id: 'github' },
            returned: new APIError('FOUND', undefined, { location: '/profile' }),
            newSession: { session: { id: 'session-2' }, user: { id: 'user-2', email: 'dev@example.com' } }
        });

        expect(logger.info).toHaveBeenCalledWith(
            expect.objectContaining({ method: 'oauth:github', email: 'dev@example.com', userId: 'user-2' }),
            'Sign-in succeeded'
        );
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('reads the reason from the redirect when an OAuth callback fails', () => {
        logAuthAttempt(logger, {
            path: '/callback/:id',
            params: { id: 'google' },
            returned: new APIError('FOUND', undefined, { location: 'https://site.test/api/auth/error?error=state_mismatch' })
        });

        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ method: 'oauth:google', status: 302, reason: 'state_mismatch' }),
            'Sign-in failed'
        );
    });

    it('logs nothing for the first step of an OAuth redirect', () => {
        logAuthAttempt(logger, {
            path: '/sign-in/social',
            body: { provider: 'google' },
            returned: { url: 'https://accounts.google.com/o/oauth2/auth', redirect: true }
        });

        expect(logger.info).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('ignores endpoints that neither send a code nor sign anyone in', () => {
        logAuthAttempt(logger, {
            path: '/get-session',
            newSession: { session: { id: 'session-1' }, user: { id: 'user-1', email: 'owner@example.com' } }
        });

        expect(logger.info).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    // Better Auth validates the body after hooks have read it, so without the
    // length limits a caller could write body-sized values into the log store.
    it('cuts oversized request values to a fixed length', () => {
        logAuthAttempt(logger, {
            path: '/email-otp/send-verification-otp',
            body: { email: `${'a'.repeat(5000)}@example.com` },
            headers: new Headers({ 'user-agent': 'u'.repeat(5000), 'x-forwarded-for': '1'.repeat(5000) })
        });

        const [details] = vi.mocked(logger.info).mock.calls[0] as unknown as [Record<string, string>];
        expect(details.email).toHaveLength(254);
        expect(details.userAgent).toHaveLength(300);
        expect(details.forwardedFor).toHaveLength(200);
        expect(details.ip).toHaveLength(64);
    });

    it('falls back to the first forwarded address when Cloudflare did not set one', () => {
        logAuthAttempt(logger, {
            path: '/email-otp/send-verification-otp',
            body: { email: 'owner@example.com' },
            headers: new Headers({ 'x-forwarded-for': '198.51.100.4, 10.0.0.1' })
        });

        expect(logger.info).toHaveBeenCalledWith(
            expect.objectContaining({ ip: '198.51.100.4', country: null }),
            'Sign-in code sent'
        );
    });
});
