/**
 * @file egress.test.ts
 *
 * Security tests for the shared egress / SSRF guard exported from `@/types`
 * (`packages/types/src/egress`). The guard backs every URL-fetching tool
 * (trp-x-poster, trp-telegram-bot, and future ones), so a regression here is a
 * cross-plugin SSRF hole — it is exercised once, centrally, rather than
 * re-tested per consumer.
 */

import { describe, it, expect } from 'vitest';
import { isPrivateIp, assertPublicHttpUrl } from '@/types';

describe('isPrivateIp', () => {
    it('flags loopback, private, link-local, and CGNAT IPv4 ranges', () => {
        for (const ip of ['127.0.0.1', '0.0.0.0', '10.1.2.3', '172.16.5.5', '172.31.255.255', '192.168.0.1', '169.254.1.1', '100.64.0.1', '100.127.255.255']) {
            expect(isPrivateIp(ip), ip).toBe(true);
        }
    });

    it('flags IPv6 unspecified, loopback, unique-local, and the full fe80::/10 link-local range', () => {
        for (const ip of ['::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe90::1', 'fea0::1', 'febf::1']) {
            expect(isPrivateIp(ip), ip).toBe(true);
        }
    });

    it('flags IPv4-mapped IPv6 literals in both dotted and URL-normalized hex forms', () => {
        for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.5', '::ffff:0a00:5', '0:0:0:0:0:ffff:127.0.0.1']) {
            expect(isPrivateIp(ip), ip).toBe(true);
        }
    });

    it('does not flag public addresses, including public IPv4-mapped literals', () => {
        for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '::ffff:0808:0808']) {
            expect(isPrivateIp(ip), ip).toBe(false);
        }
    });
});

describe('assertPublicHttpUrl', () => {
    it('rejects an unparseable URL', () => {
        expect(assertPublicHttpUrl('not a url').ok).toBe(false);
    });

    it('rejects http by default but accepts it with allowHttp', () => {
        expect(assertPublicHttpUrl('http://example.com/a.png').ok).toBe(false);
        expect(assertPublicHttpUrl('http://example.com/a.png', { allowHttp: true }).ok).toBe(true);
    });

    it('rejects special internal hostnames and bare single-label hosts', () => {
        for (const url of ['https://localhost/x', 'https://api.internal/x', 'https://printer.local/x', 'https://intranet/x']) {
            expect(assertPublicHttpUrl(url).ok, url).toBe(false);
        }
    });

    it('rejects private IP literals but allows public ones', () => {
        expect(assertPublicHttpUrl('https://169.254.169.254/latest/meta-data').ok).toBe(false);
        expect(assertPublicHttpUrl('https://10.0.0.5/x').ok).toBe(false);
        expect(assertPublicHttpUrl('https://[::1]/x').ok).toBe(false);
        expect(assertPublicHttpUrl('https://[::ffff:127.0.0.1]/x').ok).toBe(false);
        expect(assertPublicHttpUrl('https://8.8.8.8/x').ok).toBe(true);
    });

    it('accepts a public https hostname and returns the parsed URL', () => {
        const result = assertPublicHttpUrl('https://pbs.twimg.com/media/abc.jpg');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.url.hostname).toBe('pbs.twimg.com');
        }
    });
});
