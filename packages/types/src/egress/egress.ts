/**
 * @file egress.ts
 *
 * Shared egress / SSRF guard for tools and services that accept a model- or
 * user-supplied URL. A URL the platform (or an upstream like Telegram) fetches
 * server-side is both an exfiltration vector and an SSRF risk: a secret in the
 * query string leaks to whatever host the URL names, and a private-range target
 * can reach internal infrastructure (cloud metadata endpoints, loopback
 * services, internal APIs).
 *
 * Promoted out of trp-x-poster so every URL-fetching tool (x-poster,
 * telegram-bot, and any future one) shares one implementation instead of
 * re-deriving the fiddly private-range tables. Kept pure — no `node:dns` /
 * `node:net` — so it stays browser-safe for the isomorphic types package.
 * Callers that can resolve DNS (e.g. before fetching bytes themselves) run the
 * lookup and pass each resolved address through {@link isPrivateIp}; this guard
 * covers the scheme, the special-hostname, and the IP-literal cases that need no
 * resolution.
 */

/** Outcome of {@link assertPublicHttpUrl}: the parsed URL, or a correctable reason. */
export type IEgressCheckResult =
    | { ok: true; url: URL }
    | { ok: false; error: string };

/** Options for {@link assertPublicHttpUrl}. */
export interface IEgressCheckOptions {
    /**
     * Permit `http:` in addition to `https:`. Defaults to false — https only,
     * the safer default for a server-side fetch. Enable only when a legitimate
     * source serves plaintext http.
     */
    allowHttp?: boolean;
}

/**
 * Extract the embedded IPv4 from an IPv4-mapped IPv6 literal and return it as a
 * dotted-quad, or null when `addr` is not such a literal. Handles both the
 * dotted form (`::ffff:127.0.0.1`) and the form `URL` normalizes to — the hex
 * tail (`::ffff:7f00:1`) — so a private IPv4 target cannot tunnel through the
 * IPv6 representation past {@link isPrivateIp}.
 *
 * @param addr - A lowercased, bracket-stripped address literal.
 * @returns The embedded IPv4 dotted-quad, or null.
 */
function ipv4FromMappedIpv6(addr: string): string | null {
    const prefix = addr.startsWith('::ffff:')
        ? '::ffff:'
        : addr.startsWith('0:0:0:0:0:ffff:') ? '0:0:0:0:0:ffff:' : null;
    let result: string | null = null;
    if (prefix !== null) {
        const tail = addr.slice(prefix.length);
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tail)) {
            result = tail;
        } else {
            const groups = tail.split(':');
            if (groups.length >= 1 && groups.length <= 2 && groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) {
                const value = groups.length === 2
                    ? ((parseInt(groups[0], 16) << 16) | parseInt(groups[1], 16))
                    : parseInt(groups[0], 16);
                result = [
                    (value >>> 24) & 0xff,
                    (value >>> 16) & 0xff,
                    (value >>> 8) & 0xff,
                    value & 0xff
                ].join('.');
            }
        }
    }
    return result;
}

/**
 * Whether an IP address literal belongs to a private, loopback, link-local, or
 * other non-public range — the set an SSRF guard must reject.
 *
 * Covers IPv4 (0/8, 10/8, 100.64/10 CGNAT, 127/8, 169.254/16 link-local,
 * 172.16/12, 192.168/16) plus the IANA special-purpose blocks that are not
 * publicly routable and so must not be a fetch target (192.0.0.0/24 protocol
 * assignments, 192.0.2.0/24 / 198.51.100.0/24 / 203.0.113.0/24 RFC5737
 * documentation, 198.18.0.0/15 benchmarking, 224.0.0.0/4 multicast, and
 * 240.0.0.0/4 reserved / limited broadcast) and IPv6 (`::` unspecified, ::1
 * loopback, fc00::/7 unique-local, fe80::/10 link-local, 2001:db8::/32
 * documentation). IPv4-mapped IPv6 literals
 * (`::ffff:a.b.c.d` and the hex form `URL` normalizes them to) are decoded to
 * their embedded IPv4 and tested against the IPv4 ranges, closing the
 * mapped-address SSRF bypass. A string that is not a recognizable IP literal
 * returns false — gate hostname inputs through {@link assertPublicHttpUrl} plus
 * DNS resolution, not this function.
 *
 * @param ip - An IP address literal (IPv4 dotted-quad or IPv6), case-insensitive.
 * @returns True when the address is in a non-public range.
 */
export function isPrivateIp(ip: string): boolean {
    const normalized = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
    const addr = ipv4FromMappedIpv6(normalized) ?? normalized;
    let result = false;

    if (
        addr === '::' || addr === '0:0:0:0:0:0:0:0'
        || addr === '::1' || addr === '0:0:0:0:0:0:0:1'
        || addr.startsWith('fc') || addr.startsWith('fd') || /^fe[89ab]/.test(addr)
        || addr.startsWith('2001:db8:') || addr.startsWith('2001:0db8:')
    ) {
        result = true;
    } else {
        const parts = addr.split('.');
        if (parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part))) {
            const a = Number(parts[0]);
            const b = Number(parts[1]);
            const c = Number(parts[2]);
            result =
                a === 0 || a === 10 || a === 127
                || (a === 100 && b >= 64 && b <= 127)
                || (a === 169 && b === 254)
                || (a === 172 && b >= 16 && b <= 31)
                || (a === 192 && b === 168)
                // IETF protocol assignments (192.0.0.0/24) + RFC5737 TEST-NET-1 (192.0.2.0/24).
                || (a === 192 && b === 0 && (c === 0 || c === 2))
                // Benchmarking (198.18.0.0/15) + RFC5737 TEST-NET-2 (198.51.100.0/24).
                || (a === 198 && (b === 18 || b === 19))
                || (a === 198 && b === 51 && c === 100)
                // RFC5737 TEST-NET-3 (203.0.113.0/24).
                || (a === 203 && b === 0 && c === 113)
                // Multicast (224.0.0.0/4) + reserved / limited broadcast (240.0.0.0/4–255.255.255.255).
                || a >= 224;
        }
    }
    return result;
}

/**
 * Validate that a model- or user-supplied URL is a safe public-fetch target:
 * an http(s) URL whose host is neither a special internal name nor a
 * private-range IP literal. This is the resolution-free half of an SSRF guard —
 * it cannot catch a public hostname that *resolves* to a private address, so a
 * caller that fetches the bytes itself should still resolve the host and run
 * each address through {@link isPrivateIp}.
 *
 * Public IP literals (v4 and v6) are permitted; bare single-label hostnames are
 * rejected because a legitimate public host is always fully qualified.
 *
 * @param raw - The candidate URL string.
 * @param options - Scheme options; https-only by default.
 * @returns `{ ok: true, url }` with the parsed URL, or `{ ok: false, error }`
 *          carrying a reason the model can correct from.
 */
export function assertPublicHttpUrl(raw: string, options: IEgressCheckOptions = {}): IEgressCheckResult {
    let url: URL | null = null;
    try {
        url = new URL(raw);
    } catch {
        url = null;
    }

    let result: IEgressCheckResult;
    if (!url) {
        result = { ok: false, error: 'URL must be a valid absolute URL.' };
    } else if (url.protocol !== 'https:' && !(options.allowHttp === true && url.protocol === 'http:')) {
        result = { ok: false, error: options.allowHttp ? 'URL must use http or https.' : 'URL must use https.' };
    } else {
        const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
        const isIpLiteral = host.includes(':') || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);

        if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
            result = { ok: false, error: 'URL host is not a permitted public host.' };
        } else if (isIpLiteral) {
            result = isPrivateIp(host)
                ? { ok: false, error: 'URL resolves to a non-public address.' }
                : { ok: true, url };
        } else if (!host.includes('.')) {
            result = { ok: false, error: 'URL host must be a fully-qualified public hostname.' };
        } else {
            result = { ok: true, url };
        }
    }
    return result;
}
