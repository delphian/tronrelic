/**
 * @fileoverview Turns an anonymous caller's address into the id their limits
 * are counted under.
 *
 * An anonymous caller has no account, so the network they call from is the
 * only thing to count calls against. Counting by single address would let a
 * caller with an IPv6 allocation (billions of addresses per customer) dodge
 * every limit by rotating, so the id is the network range: a /24 for IPv4 and
 * a /64 for IPv6, the smallest range one customer is normally given. The range
 * is hashed with a server-side salt, so the stored id cannot be turned back
 * into an address, and the accounting table never holds one.
 */

import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

/** Id shared by every caller whose address could not be read. */
const UNKNOWN_NETWORK = 'unknown';

/**
 * Hashes anonymous callers' network ranges with a fixed salt.
 */
export class AnonymousCallerKeyer {
    /**
     * @param salt - Server-side secret mixed into every hash. Supplied by the
     *   bootstrap from `TRAFFIC_IP_HASH_SALT`, falling back to `SESSION_SECRET`,
     *   the same salt the traffic module hashes addresses with. Rotating it
     *   resets every anonymous caller's day count.
     */
    constructor(private readonly salt: string) {}

    /**
     * Return the id an anonymous caller from this address is counted under.
     *
     * @param ip - The request address from the trusted proxy chain, possibly
     *   an IPv4-mapped IPv6 address, or undefined when it could not be read.
     * @returns A 16-character hex hash of the caller's network range, or
     *   `unknown` when the address is missing or unparseable. Every such caller
     *   shares one budget, which errs towards refusing rather than admitting.
     */
    keyFor(ip: string | undefined): string {
        const network = networkOf(ip);
        return network === null
            ? UNKNOWN_NETWORK
            : createHash('sha256').update(`${this.salt}|mcp-network|${network}`).digest('hex').slice(0, 16);
    }
}

/**
 * Reduce an address to the network range anonymous limits count by.
 *
 * @param ip - The request address.
 * @returns The range as text, such as `203.0.113.0/24` or
 *   `2001:0db8:0000:0001::/64`, or null when the address cannot be parsed.
 */
export function networkOf(ip: string | undefined): string | null {
    const address = (ip ?? '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
    let network: string | null = null;
    if (isIPv4(address)) {
        network = `${address.split('.').slice(0, 3).join('.')}.0/24`;
    } else if (isIPv6(address)) {
        const groups = expandIpv6(address);
        network = groups ? `${groups.slice(0, 4).join(':')}::/64` : null;
    }
    return network;
}

/**
 * Expand an IPv6 address into its eight four-digit groups, so two spellings of
 * the same address (`2001:db8::1` and `2001:0db8:0:0::1`) share one range.
 *
 * @param address - An address `isIPv6` accepted, without a zone index.
 * @returns The eight groups, lowercased and zero-padded, or null when the
 *   address carries an embedded IPv4 tail or a zone, which this does not expand.
 */
function expandIpv6(address: string): string[] | null {
    let groups: string[] | null = null;
    if (!address.includes('.') && !address.includes('%')) {
        const [head, tail] = address.toLowerCase().split('::');
        const left = head ? head.split(':') : [];
        const right = tail !== undefined && tail.length > 0 ? tail.split(':') : [];
        const missing = 8 - left.length - right.length;
        const middle = address.includes('::') ? Array.from({ length: missing }, () => '0') : [];
        const all = [...left, ...middle, ...right];
        groups = all.length === 8 ? all.map(group => group.padStart(4, '0')) : null;
    }
    return groups;
}
