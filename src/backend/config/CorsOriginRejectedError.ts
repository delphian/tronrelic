/**
 * @file CorsOriginRejectedError.ts
 *
 * The error raised when a browser request arrives from an origin that is not
 * on the CORS allowed list.
 */

/**
 * Marks a request refused by CORS policy as a client error rather than a
 * server failure.
 *
 * A plain `Error` reached the shared Express error handler as a 500, so every
 * request from a foreign website was logged as "Unhandled error" with no record
 * of where it came from. This class carries the `status` and `expose` fields
 * that `http-errors`-style middleware use, which the error handler already
 * reads: the request is answered with 403, logged at warn level, and the
 * `origin` property is stored with the log entry so an operator can see which
 * site was refused. The message itself stays fixed so the response body never
 * repeats the caller's header back to it.
 *
 * Socket.IO uses the same origin callback, but its engine answers a failed
 * middleware with its own 400 and never passes the error to Express, so only
 * HTTP requests are logged.
 */
export class CorsOriginRejectedError extends Error {
    /** HTTP status the error handler answers with. */
    public readonly status = 403;

    /** Tells the error handler the fixed message is safe to return. */
    public readonly expose = true;

    /**
     * @param origin - The Origin header that was refused, kept on the error so
     *   the log entry records which site made the request.
     */
    constructor(public readonly origin: string) {
        super('CORS policy: Origin not allowed');
        this.name = 'CorsOriginRejectedError';
    }
}
