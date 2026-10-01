/**
 * @fileoverview Parsing and matching for the per-group MCP IP allowlist.
 *
 * An admin can limit the tools a user group grants to requests from listed
 * addresses, so a stolen token used from anywhere else reaches nothing that
 * group grants. Entries are single addresses or CIDR ranges, IPv4 or IPv6.
 * Matching uses Node's `net.BlockList`, which handles both families and
 * prefix arithmetic, rather than hand-written range code.
 */

import { BlockList, isIP } from 'node:net';

/** Most entries one group may list. Generous for office and VPN ranges, small enough to keep matching cheap. */
export const MAX_IP_ALLOWLIST_ENTRIES = 100;

/** A parsed allowlist entry, ready to add to a `BlockList`. */
interface IParsedEntry {
    address: string;
    family: 'ipv4' | 'ipv6';
    prefix: number | null;
}

/**
 * Parse one allowlist entry, or explain why it is not valid.
 *
 * Kept separate from validation so the matcher and the validator read entries
 * the same way, and a list the validator accepted can never fail to build.
 *
 * @param entry - One address or CIDR range as the admin typed it, already trimmed.
 * @returns The parsed entry, or a sentence naming the problem.
 */
function parseEntry(entry: string): IParsedEntry | string {
    let result: IParsedEntry | string;
    const [address, prefixText, extra] = entry.split('/');
    const version = isIP(address ?? '');
    if (extra !== undefined || version === 0) {
        result = `"${entry}" is not an IP address or CIDR range.`;
    } else {
        const family = version === 4 ? 'ipv4' : 'ipv6';
        const maxPrefix = version === 4 ? 32 : 128;
        if (prefixText === undefined) {
            result = { address, family, prefix: null };
        } else if (!/^\d{1,3}$/.test(prefixText) || Number(prefixText) > maxPrefix) {
            result = `"${entry}" has a prefix length outside 0–${maxPrefix}.`;
        } else {
            result = { address, family, prefix: Number(prefixText) };
        }
    }
    return result;
}

/**
 * Check an allowlist an admin submitted.
 *
 * Every problem is reported at once, so an admin pasting a long list can fix
 * it in one edit rather than one round trip per bad line.
 *
 * @param entries - The submitted entries, trimmed, with blank lines removed.
 * @returns One sentence per problem; empty when the list is valid.
 */
export function validateIpAllowlist(entries: readonly string[]): string[] {
    const problems: string[] = [];
    if (entries.length > MAX_IP_ALLOWLIST_ENTRIES) {
        problems.push(`At most ${MAX_IP_ALLOWLIST_ENTRIES} entries are allowed.`);
    }
    for (const entry of entries) {
        const parsed = parseEntry(entry);
        if (typeof parsed === 'string') {
            problems.push(parsed);
        }
    }
    return problems;
}

/**
 * Normalise a request address for matching.
 *
 * Node reports an IPv4 client on a dual-stack socket as an IPv4-mapped IPv6
 * address (`::ffff:203.0.113.7`). An admin lists the plain IPv4 form, so the
 * mapped form is unwrapped first; without this an IPv4 range would never match.
 *
 * @param ip - The request address as Express resolved it.
 * @returns The address to match, and its family.
 */
function normaliseAddress(ip: string): { address: string; family: 'ipv4' | 'ipv6' } | null {
    const unwrapped = ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
    const version = isIP(unwrapped);
    return version === 0 ? null : { address: unwrapped, family: version === 4 ? 'ipv4' : 'ipv6' };
}

/**
 * Matches request addresses against one group's allowlist.
 *
 * Built once per distinct list and reused, because the served tool list is
 * computed on every MCP request.
 */
export class IpAllowlistMatcher {
    private readonly blockList = new BlockList();

    /**
     * @param entries - The group's allowlist. Entries that do not parse are
     *   skipped; the admin API refuses to store them, so this only guards
     *   against a document edited by hand.
     */
    constructor(entries: readonly string[]) {
        for (const entry of entries) {
            const parsed = parseEntry(entry.trim());
            if (typeof parsed !== 'string') {
                if (parsed.prefix === null) {
                    this.blockList.addAddress(parsed.address, parsed.family);
                } else {
                    this.blockList.addSubnet(parsed.address, parsed.prefix, parsed.family);
                }
            }
        }
    }

    /**
     * Decide whether a request address is on the list.
     *
     * A request whose address is unknown is refused, because the allowlist
     * exists to prove where a request came from.
     *
     * @param ip - The request address, or undefined when Express could not resolve one.
     * @returns True when the address matches an entry.
     */
    allows(ip: string | undefined): boolean {
        const normalised = ip ? normaliseAddress(ip) : null;
        return normalised !== null && this.blockList.check(normalised.address, normalised.family);
    }
}
