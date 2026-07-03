/**
 * Salted IP-address hashing for traffic analytics.
 *
 * The traffic pipeline deliberately never stores raw IP addresses (privacy
 * design — see geo.service.ts). That left analytics unable to answer the
 * most basic abuse question: "are these probes coming from the same
 * source?" A distributed scanner burst and a single noisy client look
 * identical once the IP is discarded.
 *
 * These helpers restore source correlation without storing PII: a keyed
 * SHA-256 of the full address (`ip_hash`) links events from the same
 * client, and a hash of the containing network (`subnet_hash`, /24 for
 * IPv4, /48 for IPv6) links events from the same provider block even when
 * the client rotates addresses within it. The salt is a server-side
 * secret, so the stored value is an opaque correlation key that cannot be
 * reversed to an address or precomputed with a rainbow table by anyone
 * without the salt.
 *
 * The salt is `TRAFFIC_IP_HASH_SALT` when set, falling back to
 * `SESSION_SECRET` (enforced in production, dev-placeholder otherwise) so
 * no new required env wiring is introduced. Rotating the salt severs
 * correlation across the rotation boundary but breaks nothing.
 */

import { createHash } from 'node:crypto';
import { env } from '../../../config/env.js';

/**
 * Resolve the hashing salt once at module load.
 *
 * Why: hashing runs on every tracked request, so the salt lookup should not
 * re-read env per call. `SESSION_SECRET` is guaranteed non-empty after env
 * validation (production enforces it; dev gets a placeholder), so the
 * resolved salt is always usable in practice; the empty-string guard in the
 * helpers keeps behavior honest if that invariant ever changes.
 */
const SALT: string = env.TRAFFIC_IP_HASH_SALT || env.SESSION_SECRET || '';

/**
 * Compute the keyed hash of a full client IP address.
 *
 * Why: gives analytics a stable per-client correlation key without
 * persisting the address itself. Truncated to 16 hex chars (64 bits) — far
 * beyond collision risk at analytics cardinality while keeping the column
 * compact.
 *
 * @param ip - Client IP as extracted by `getClientIP` (may be undefined
 *   when the request carries no usable address).
 * @returns 16-char hex digest, or `null` when the IP or salt is missing.
 */
export function getIpHash(ip: string | undefined): string | null {
    let hash: string | null = null;
    if (ip && SALT) {
        const cleanIP = ip.replace(/^::ffff:/, '');
        hash = createHash('sha256').update(`${SALT}|ip|${cleanIP}`).digest('hex').slice(0, 16);
    }
    return hash;
}

/**
 * Compute the keyed hash of the network containing a client IP — /24 for
 * IPv4, /48 for IPv6.
 *
 * Why: scanners and botnets frequently rotate addresses inside one provider
 * allocation; the subnet hash groups those rotations into a single visible
 * source while remaining just as irreversible as the full hash.
 *
 * @param ip - Client IP as extracted by `getClientIP`.
 * @returns 16-char hex digest of the containing network, or `null` when the
 *   IP is malformed or the salt is missing.
 */
export function getSubnetHash(ip: string | undefined): string | null {
    let hash: string | null = null;
    if (ip && SALT) {
        const subnet = deriveSubnet(ip.replace(/^::ffff:/, ''));
        if (subnet) {
            hash = createHash('sha256').update(`${SALT}|subnet|${subnet}`).digest('hex').slice(0, 16);
        }
    }
    return hash;
}

/**
 * Reduce an IP address to its containing-network prefix string.
 *
 * Why: isolates the address-family parsing so both hash helpers share one
 * definition of "same network". IPv4 keeps the first three octets (/24);
 * IPv6 keeps the first three hextets (/48, the conventional per-site
 * allocation). Malformed input returns `null` rather than throwing so a
 * garbage header cannot fail an inbound request.
 *
 * @param ip - Address already stripped of any `::ffff:` IPv4-mapping prefix.
 * @returns Prefix string like `203.0.113` or `2001:db8:1`, or `null`.
 */
function deriveSubnet(ip: string): string | null {
    let subnet: string | null = null;
    if (ip.includes(':')) {
        const parts = ip.split(':');
        if (parts.length >= 3) {
            subnet = parts.slice(0, 3).join(':').toLowerCase();
        }
    } else {
        const octets = ip.split('.');
        if (octets.length === 4 && octets.every(o => /^\d{1,3}$/.test(o))) {
            subnet = octets.slice(0, 3).join('.');
        }
    }
    return subnet;
}
