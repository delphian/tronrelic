/**
 * @fileoverview Recognise a request sent by the frontend server itself.
 *
 * The frontend server reports the translation keys it renders by calling the
 * backend directly over the private container network. Visitors can reach the
 * same backend route through Nginx and the Next.js `/api` proxy, and must not
 * be able to write keys or change the English source text translators see.
 * There is no shared secret between the two containers, so this check relies
 * on two facts about the deployment instead: traffic from the internet always
 * passes through a proxy that adds a forwarding header, and the direct call
 * from the frontend container never carries one and always arrives from a
 * private address.
 */

import type { Request } from 'express';

/** Headers a proxy in front of the backend adds to every request it forwards. */
const FORWARDING_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'forwarded'] as const;

/** IPv4 ranges reserved for private networks and loopback. */
const PRIVATE_IPV4 = [/^10\./, /^127\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/**
 * Decide whether a socket address belongs to a private network.
 *
 * @param address - The socket's remote address, possibly IPv4 mapped into IPv6.
 * @returns True for loopback, RFC 1918, and IPv6 unique-local addresses.
 */
function isPrivateAddress(address: string | undefined): boolean {
    const value = (address ?? '').replace(/^::ffff:/, '');
    return value === '::1'
        || PRIVATE_IPV4.some(range => range.test(value))
        || /^f[cd][0-9a-f]{2}:/i.test(value);
}

/**
 * Test whether a request came straight from another container rather than
 * through a public proxy.
 *
 * @param req - The incoming request.
 * @returns True when no forwarding header is present and the peer address is private.
 */
export function isInternalServiceRequest(req: Request): boolean {
    const forwarded = FORWARDING_HEADERS.some(header => req.headers[header] !== undefined);
    return !forwarded && isPrivateAddress(req.socket?.remoteAddress);
}
