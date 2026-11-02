/**
 * @fileoverview Works out the X-Forwarded-For value to send on a
 * server-to-server call from the frontend to the backend.
 *
 * The frontend reaches the backend over the Docker network, so a call made
 * while rendering a page arrives from this container's address. Without the
 * visitor's address forwarded, the backend's per-IP rate limiters put every
 * visitor in one shared bucket, and a single client can use up the limit for
 * everyone. The middleware and the plugin server data context both need the
 * same rule, so it lives here once.
 */

/**
 * Read the visitor's address chain from the inbound request headers.
 *
 * Nginx sets `X-Forwarded-For` to the address it verified (on production,
 * the Cloudflare client address), overwriting anything the client sent, so
 * the value is safe to pass on. When no chain is present, such as a request
 * that reached the frontend without Nginx in front, `X-Real-IP` seeds it.
 * The backend's `trust proxy` setting skips this container's private-network
 * hop and resolves `req.ip` to the visitor.
 *
 * @param headers - The inbound request's headers: `NextRequest.headers` in the
 *   middleware, or the result of `headers()` in a server component. Only `get`
 *   is used, so either works.
 * @returns The value to send as `X-Forwarded-For`, or null when the request
 *   carried no visitor address, in which case the caller sends nothing.
 */
export function resolveVisitorForwardedFor(headers: Pick<Headers, 'get'>): string | null {
    const forwardedFor = headers.get('x-forwarded-for') || headers.get('x-real-ip');
    return forwardedFor || null;
}
