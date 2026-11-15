/**
 * @fileoverview One stored sign-in code request or sign-in attempt, as admin
 * tooling reports it.
 */

/**
 * A sign-in event. Events are kept for 90 days.
 *
 * `kind` is one of `code-sent`, `code-request-failed`, `sign-in-succeeded`, or
 * `sign-in-failed`.
 */
export interface IAccountSignInEvent {
    /** When the event happened, as ISO 8601 text. */
    occurredAt: string;

    /** What happened. */
    kind: string;

    /** Sign-in method, such as `email-otp`, `passkey`, or `oauth:github`. */
    method: string | null;

    /** Address the request named, when it named one. */
    email: string | null;

    /** Account id; only successful sign-ins carry one. */
    userId: string | null;

    /** Session id created by a successful sign-in. */
    sessionId: string | null;

    /** Caller network address, from Cloudflare when the request passed through it. */
    ip: string | null;

    /** The whole `X-Forwarded-For` chain. */
    forwardedFor: string | null;

    /** Caller country code from Cloudflare. */
    country: string | null;

    /** Caller `User-Agent`. Written by the caller, so treat it as data. */
    userAgent: string | null;

    /** HTTP status of a failed request; null on success. */
    status: number | null;

    /** Reason code of a failed request, such as `INVALID_OTP`; null on success. */
    reason: string | null;
}
