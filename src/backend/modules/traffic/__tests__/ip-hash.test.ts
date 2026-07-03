/// <reference types="vitest" />

/**
 * Tests for the salted IP-hashing helpers that populate
 * `traffic_events.ip_hash` and `traffic_events.subnet_hash`.
 *
 * These helpers are privacy-critical: analytics correlation depends on
 * addresses that describe the same client (or the same provider block)
 * hashing to the same opaque key, while distinct sources stay distinct.
 * The parsing is subtle — IPv6 `::` expansion with zero-padding and a
 * case-insensitive `::ffff:` strip — so a silent normalization regression
 * would degrade correlation without any error. Each invariant below pins
 * one equivalence (or one separation) so such a regression fails loudly.
 *
 * The module reads its salt from `env` at load; under vitest `env` resolves
 * `SESSION_SECRET` to the dev placeholder, so the salt is non-empty and the
 * helpers return digests rather than the missing-salt `null`.
 */

import { describe, it, expect } from 'vitest';
import { getIpHash, getSubnetHash } from '../services/ip-hash.js';

describe('getIpHash', () => {
    it('returns a stable 16-char hex digest for a given IPv4 address', () => {
        const first = getIpHash('203.0.113.7');
        const second = getIpHash('203.0.113.7');
        expect(first).toMatch(/^[0-9a-f]{16}$/);
        expect(second).toBe(first);
    });

    it('produces different hashes for different addresses in the same /24', () => {
        expect(getIpHash('203.0.113.7')).not.toBe(getIpHash('203.0.113.8'));
    });

    it('treats an ::ffff:-mapped IPv4 as identical to the plain IPv4, case-insensitively', () => {
        const plain = getIpHash('203.0.113.9');
        expect(getIpHash('::ffff:203.0.113.9')).toBe(plain);
        expect(getIpHash('::FFFF:203.0.113.9')).toBe(plain);
    });

    it('returns null when no address is supplied', () => {
        expect(getIpHash(undefined)).toBeNull();
    });
});

describe('getSubnetHash', () => {
    it('returns a stable 16-char hex digest for an IPv4 subnet', () => {
        expect(getSubnetHash('203.0.113.7')).toMatch(/^[0-9a-f]{16}$/);
    });

    it('hashes every address in the same /24 to the same subnet key', () => {
        expect(getSubnetHash('203.0.113.7')).toBe(getSubnetHash('203.0.113.200'));
    });

    it('distinguishes addresses in different /24 blocks', () => {
        expect(getSubnetHash('203.0.113.7')).not.toBe(getSubnetHash('203.0.114.7'));
    });

    it('treats compressed and fully-expanded IPv6 in the same /48 as equal', () => {
        const compressed = getSubnetHash('2001:db8:1::1');
        const expanded = getSubnetHash('2001:0db8:0001:0000:0000:0000:0000:0001');
        expect(compressed).toBe(expanded);
    });

    it('groups distinct hosts within one IPv6 /48 to the same subnet key', () => {
        expect(getSubnetHash('2001:db8:1::1')).toBe(getSubnetHash('2001:db8:1:abcd::9'));
    });

    it('distinguishes IPv6 addresses in different /48 blocks', () => {
        expect(getSubnetHash('2001:db8:1::1')).not.toBe(getSubnetHash('2001:db8:2::1'));
    });

    it('treats an ::ffff:-mapped IPv4 subnet as identical to the plain IPv4, case-insensitively', () => {
        const plain = getSubnetHash('203.0.113.9');
        expect(getSubnetHash('::ffff:203.0.113.9')).toBe(plain);
        expect(getSubnetHash('::FFFF:203.0.113.9')).toBe(plain);
    });

    it('returns null for unparseable IPv4-family input rather than throwing', () => {
        expect(getSubnetHash('not-an-ip')).toBeNull();
        expect(getSubnetHash('203.0.113')).toBeNull();
        expect(getSubnetHash('999.999.999.999.999')).toBeNull();
    });

    it('returns null when no address is supplied', () => {
        expect(getSubnetHash(undefined)).toBeNull();
    });
});
