/**
 * @fileoverview Writes a log entry for every sign-in code request and every
 * sign-in attempt.
 *
 * Without these entries an operator who receives a sign-in code they did not
 * ask for cannot tell who requested it, and cannot tell whether anyone went on
 * to sign in. The limiters only log a request they refuse, so an attempt that
 * stays under the limits leaves no record at all.
 *
 * Each entry carries the address the code was sent to, the caller's network
 * address, country, and browser, and for a sign-in the method and the outcome.
 * The entries are written through the identity module's logger, so they appear
 * on the Logs tab of `/system/users`. Each one is also stored as a sign-in
 * event with indexed fields, which is what the identity AI tools search.
 *
 * - The one-time code and the session token are never logged.
 * - Every value copied from the request is cut to a fixed length first,
 *   because Better Auth validates the body after hooks have read it.
 */

import { APIError, createAuthMiddleware } from 'better-auth/api';
import type { ISystemLogService } from '@/types';
import type { ISignInEventDocument } from '../database/ISignInEventDocument.js';
import type { ISignInEventRecorder } from './ISignInEventRecorder.js';

/** Endpoint that emails a one-time sign-in code. */
const SEND_CODE_PATH = '/email-otp/send-verification-otp';

/**
 * Endpoints that can sign a visitor in, with the method each one stands for.
 * `/email-otp/check-verification-otp` and `/email-otp/verify-email` are listed
 * because a wrong code submitted to either is a failed guess at a sign-in code.
 * `/sign-in/social` only signs in directly when the client posts an ID token;
 * the usual redirect flow finishes on `/callback/:id`.
 */
const SIGN_IN_METHODS: Readonly<Record<string, string>> = {
    '/sign-in/email-otp': 'email-otp',
    '/email-otp/check-verification-otp': 'email-otp',
    '/email-otp/verify-email': 'email-otp',
    '/passkey/verify-authentication': 'passkey',
    '/callback/:id': 'oauth',
    '/sign-in/social': 'oauth'
};

/** Longest email address logged, the RFC 5321 limit. */
const MAX_EMAIL_LENGTH = 254;

/** Longest network address, country code, or provider name logged. */
const MAX_SHORT_VALUE_LENGTH = 64;

/** Longest `X-Forwarded-For` chain or failure reason logged. */
const MAX_LONG_VALUE_LENGTH = 200;

/** Longest `User-Agent` logged; real browsers stay well under this. */
const MAX_USER_AGENT_LENGTH = 300;

/**
 * The parts of one finished auth request the audit log reads.
 *
 * Declared separately from Better Auth's hook context so the logging rules can
 * be tested with plain values.
 */
export interface IAuthAuditInput {
    /** Better Auth endpoint path, such as `/sign-in/email-otp`; picks the event. */
    path: string;

    /** Route parameters; `id` names the OAuth provider on `/callback/:id`. */
    params?: unknown;

    /** Parsed request body; read for `email` and `provider`. */
    body?: unknown;

    /** Request headers; read for the caller's network address and browser. */
    headers?: Headers | null;

    /** What the endpoint returned or threw; an `APIError` marks a failure. */
    returned?: unknown;

    /** The session the request created, when it signed someone in. */
    newSession?: {
        session?: { id?: string } | null;
        user?: { id?: string; email?: string | null } | null;
    } | null;
}

/**
 * Cut a request value to a fixed length so a caller cannot write an
 * arbitrarily large value into the persisted logs.
 *
 * @param value - The raw value; anything that is not a non-empty string yields null.
 * @param maxLength - Most characters to keep.
 * @returns The trimmed, shortened string, or null when there is nothing to log.
 */
function bounded(value: unknown, maxLength: number): string | null {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length > 0 ? text.slice(0, maxLength) : null;
}

/**
 * Describe who made the request, so an operator can tell one caller from
 * another and match an entry to the traffic records.
 *
 * `ip` prefers `CF-Connecting-IP`, which Cloudflare sets itself, over the first
 * `X-Forwarded-For` entry, which a client can send. The whole forwarded chain
 * is kept too, so a request that reached the server without Cloudflare can be
 * recognised.
 *
 * @param headers - The request headers, or nothing for a server-side call.
 * @returns The caller's address, forwarded chain, country, and browser.
 */
function describeCaller(headers: Headers | null | undefined): {
    ip: string | null;
    forwardedFor: string | null;
    country: string | null;
    userAgent: string | null;
} {
    const forwardedFor = bounded(headers?.get('x-forwarded-for'), MAX_LONG_VALUE_LENGTH);
    const firstForwarded = forwardedFor ? forwardedFor.split(',')[0] : null;
    return {
        ip: bounded(headers?.get('cf-connecting-ip'), MAX_SHORT_VALUE_LENGTH)
            ?? bounded(firstForwarded, MAX_SHORT_VALUE_LENGTH),
        forwardedFor,
        country: bounded(headers?.get('cf-ipcountry'), MAX_SHORT_VALUE_LENGTH),
        userAgent: bounded(headers?.get('user-agent'), MAX_USER_AGENT_LENGTH)
    };
}

/**
 * Work out whether a request failed, and why.
 *
 * Better Auth reports a failure in two ways. Most endpoints throw an
 * `APIError` with a 4xx or 5xx status. The OAuth callback instead redirects
 * the browser to an error page, which is also an `APIError` but with a 3xx
 * status and the reason in the `error` query parameter of its `Location`
 * header. A successful OAuth callback redirects too, without that parameter.
 *
 * @param returned - What the endpoint returned or threw.
 * @returns The HTTP status and a short reason, or null when the request did not fail.
 */
function describeFailure(returned: unknown): { status: number; reason: string | null } | null {
    let failure: { status: number; reason: string | null } | null = null;
    if (returned instanceof APIError) {
        const body = returned.body as { code?: unknown; message?: unknown } | undefined;
        if (returned.statusCode >= 400) {
            failure = {
                status: returned.statusCode,
                reason: bounded(body?.code, MAX_LONG_VALUE_LENGTH)
                    ?? bounded(body?.message, MAX_LONG_VALUE_LENGTH)
                    ?? bounded(returned.message, MAX_LONG_VALUE_LENGTH)
            };
        } else {
            const location = new Headers(returned.headers as HeadersInit | undefined).get('location');
            const reason = location ? new URL(location, 'http://localhost').searchParams.get('error') : null;
            if (reason) {
                failure = { status: returned.statusCode, reason: bounded(reason, MAX_LONG_VALUE_LENGTH) };
            }
        }
    }
    return failure;
}

/**
 * Write the log entry for one finished auth request, when it is one worth
 * recording.
 *
 * Kept separate from the Better Auth middleware wrapper so it can be tested
 * with plain values instead of a full Better Auth request context.
 *
 * A code request logs `Sign-in code sent` or `Sign-in code request failed`. A
 * request to a sign-in endpoint logs `Sign-in succeeded` when it created a
 * session and `Sign-in failed` when it was refused. A request that did
 * neither, such as the first step of an OAuth redirect, logs nothing. Requests
 * to every other endpoint are ignored.
 *
 * @param logger - The identity module's logger, so entries reach its Logs tab.
 * @param input - The finished request: its path, body, headers, and result.
 * @returns The event that was logged, for the caller to store, or null when
 *   the request was not worth recording.
 */
export function logAuthAttempt(logger: ISystemLogService, input: IAuthAuditInput): ISignInEventDocument | null {
    let event: ISignInEventDocument | null = null;
    const isCodeRequest = input.path === SEND_CODE_PATH;
    const baseMethod = SIGN_IN_METHODS[input.path];
    if (isCodeRequest || baseMethod) {
        const body = input.body as { email?: unknown; provider?: unknown } | null | undefined;
        const params = input.params as { id?: unknown } | null | undefined;
        const provider = bounded(params?.id, MAX_SHORT_VALUE_LENGTH) ?? bounded(body?.provider, MAX_SHORT_VALUE_LENGTH);
        const user = input.newSession?.user;
        const failure = describeFailure(input.returned);
        const details = {
            method: isCodeRequest ? 'email-otp' : baseMethod === 'oauth' && provider ? `oauth:${provider}` : baseMethod,
            path: input.path,
            email: bounded(body?.email, MAX_EMAIL_LENGTH)?.toLowerCase() ?? bounded(user?.email, MAX_EMAIL_LENGTH),
            ...describeCaller(input.headers)
        };
        const unresolved = { userId: null, sessionId: null, status: null, reason: null, occurredAt: new Date() };
        if (failure) {
            logger.warn(
                { ...details, status: failure.status, reason: failure.reason },
                isCodeRequest ? 'Sign-in code request failed' : 'Sign-in failed'
            );
            event = {
                ...details,
                ...unresolved,
                kind: isCodeRequest ? 'code-request-failed' : 'sign-in-failed',
                status: failure.status,
                reason: failure.reason
            };
        } else if (isCodeRequest) {
            logger.info(details, 'Sign-in code sent');
            event = { ...details, ...unresolved, kind: 'code-sent' };
        } else if (user) {
            const userId = user.id ?? null;
            const sessionId = input.newSession?.session?.id ?? null;
            logger.info({ ...details, userId, sessionId }, 'Sign-in succeeded');
            event = { ...details, ...unresolved, kind: 'sign-in-succeeded', userId, sessionId };
        }
    }
    return event;
}

/**
 * Build the Better Auth `hooks.after` middleware that records sign-in code
 * requests and sign-in attempts through {@link logAuthAttempt}.
 *
 * Better Auth runs after-hooks whether the endpoint returned or threw, so
 * failed attempts are recorded too. A request refused earlier, by the per-IP
 * limiter or the per-email throttle, never reaches this hook; those two log
 * their own refusals.
 *
 * Each event is written to the log first and then stored. A failure to store
 * it is logged and swallowed, because the sign-in itself has already been
 * decided and must not be reported as failed over a missing audit row.
 *
 * @param logger - The identity module's logger.
 * @param recorder - Where each event is stored so it can be searched later.
 * @returns Middleware to pass as the auth instance's `hooks.after`.
 */
export function createSignInAuditLog(logger: ISystemLogService, recorder: ISignInEventRecorder) {
    return createAuthMiddleware(async (ctx) => {
        const event = logAuthAttempt(logger, {
            path: ctx.path,
            params: ctx.params,
            body: ctx.body,
            headers: ctx.headers,
            returned: ctx.context.returned,
            newSession: ctx.context.newSession
        });
        if (event) {
            try {
                await recorder.record(event);
            } catch (error) {
                logger.error({ error, kind: event.kind }, 'Failed to store a sign-in event; the log entry was still written');
            }
        }
    });
}
