/**
 * @fileoverview Tests for the per-group MCP IP allowlist: validation of what
 * an admin submits, and matching of request addresses.
 */

import { describe, it, expect } from 'vitest';
import { IpAllowlistMatcher, MAX_IP_ALLOWLIST_ENTRIES, validateIpAllowlist } from '../services/IpAllowlistMatcher.js';

describe('validateIpAllowlist', () => {
    it('accepts single addresses and CIDR ranges in both families', () => {
        expect(validateIpAllowlist(['203.0.113.7', '198.51.100.0/24', '2001:db8::1', '2001:db8::/32'])).toEqual([]);
    });

    it('reports every bad entry at once', () => {
        const problems = validateIpAllowlist(['not-an-ip', '10.0.0.0/33', '2001:db8::/129', '10.0.0.1/8/2']);
        expect(problems).toHaveLength(4);
    });

    it('refuses an over-long list', () => {
        const entries = Array.from({ length: MAX_IP_ALLOWLIST_ENTRIES + 1 }, (_unused, index) => `10.0.${Math.floor(index / 250)}.${index % 250}`);
        expect(validateIpAllowlist(entries)).toEqual([expect.stringContaining(`At most ${MAX_IP_ALLOWLIST_ENTRIES}`)]);
    });
});

describe('IpAllowlistMatcher', () => {
    const matcher = new IpAllowlistMatcher(['203.0.113.7', '198.51.100.0/24', '2001:db8::/32']);

    it('matches a listed address and an address inside a listed range', () => {
        expect(matcher.allows('203.0.113.7')).toBe(true);
        expect(matcher.allows('198.51.100.200')).toBe(true);
        expect(matcher.allows('2001:db8:1::5')).toBe(true);
    });

    it('matches an IPv4 client reported as an IPv4-mapped IPv6 address', () => {
        expect(matcher.allows('::ffff:198.51.100.9')).toBe(true);
    });

    it('refuses an address outside the list, and an unknown address', () => {
        expect(matcher.allows('203.0.113.8')).toBe(false);
        expect(matcher.allows('2001:db9::1')).toBe(false);
        expect(matcher.allows(undefined)).toBe(false);
        expect(matcher.allows('garbage')).toBe(false);
    });
});
