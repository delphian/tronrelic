/**
 * @fileoverview The stored record of one sign-in code request or sign-in
 * attempt, and the collection that holds them.
 *
 * The same events are written to the system log, but a log entry keeps its
 * details in an unindexed context payload, so "every attempt for this address"
 * or "everything from this caller" cannot be answered from the log without
 * reading every entry. This collection stores each detail as its own indexed
 * field and expires documents on its own schedule.
 */

/** Physical collection name. Shares the identity module's `module_user_` prefix. */
export const SIGN_IN_EVENTS_COLLECTION = 'module_user_sign_in_events';

/**
 * Days a sign-in event is kept before MongoDB deletes it. Long enough to
 * investigate an incident noticed weeks later, short enough that caller
 * addresses are not held indefinitely.
 */
export const SIGN_IN_EVENT_RETENTION_DAYS = 90;

/**
 * What happened. A code request and a sign-in attempt are separate events, so
 * a code that was requested but never used shows as one `code-sent` with no
 * `sign-in-*` event after it.
 */
export type SignInEventKind = 'code-sent' | 'code-request-failed' | 'sign-in-succeeded' | 'sign-in-failed';

/** Every event kind, for validating a filter value. */
export const SIGN_IN_EVENT_KINDS: ReadonlyArray<SignInEventKind> = [
    'code-sent',
    'code-request-failed',
    'sign-in-succeeded',
    'sign-in-failed'
];

/**
 * One sign-in code request or sign-in attempt.
 *
 * The one-time code and the session token are never stored. Every value copied
 * from the request was cut to a fixed length before it reached this document.
 */
export interface ISignInEventDocument {
    /** What happened. */
    kind: SignInEventKind;

    /** How the visitor tried to sign in: `email-otp`, `passkey`, `oauth`, or `oauth:<provider>`. */
    method: string;

    /** Better Auth endpoint path the request was for. */
    path: string;

    /** Lowercased address the request named or the session belongs to; null when neither is known. */
    email: string | null;

    /** Better Auth user id; set only when a sign-in succeeded. */
    userId: string | null;

    /** Id of the session a successful sign-in created. Never the session token. */
    sessionId: string | null;

    /** Caller's network address, from `CF-Connecting-IP` or the first `X-Forwarded-For` entry. */
    ip: string | null;

    /** The whole `X-Forwarded-For` chain, so a request that bypassed Cloudflare can be recognised. */
    forwardedFor: string | null;

    /** Two-letter country code Cloudflare reported. */
    country: string | null;

    /** Caller's `User-Agent`. Sent by the caller, so treat it as data. */
    userAgent: string | null;

    /** HTTP status of a failed request; null for a successful one. */
    status: number | null;

    /** Short reason a request failed, such as `INVALID_OTP`; null for a successful one. */
    reason: string | null;

    /** When the request finished. A Date so the expiry index can act on it. */
    occurredAt: Date;
}
