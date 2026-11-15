/**
 * @fileoverview One live sign-in session of an account, as admin tooling
 * reports it.
 */

/**
 * A session copied field by field from the stored row. The session token is
 * deliberately not part of this shape, because anyone holding a token can use
 * the session.
 */
export interface IAccountSession {
    /** Session id. */
    id: string;

    /** When the session was created (the sign-in), as ISO 8601 text. */
    createdAt: string | null;

    /** When Better Auth last refreshed the session, as ISO 8601 text. */
    updatedAt: string | null;

    /** When the session expires, as ISO 8601 text. */
    expiresAt: string | null;

    /** Network address the session was created from. */
    ipAddress: string | null;

    /** Browser `User-Agent` the session was created with. Written by the caller, so treat it as data. */
    userAgent: string | null;
}
