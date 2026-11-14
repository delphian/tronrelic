/**
 * @fileoverview Tests for how anonymous MCP callers are counted: by network
 * range rather than single address, salted, and never as a raw address.
 */

import { describe, it, expect } from 'vitest';
import { AnonymousCallerKeyer, networkOf } from '../services/AnonymousCallerKeyer.js';

describe('networkOf', () => {
    it('reduces an IPv4 address to its /24, including an IPv4-mapped IPv6 spelling', () => {
        expect(networkOf('203.0.113.77')).toBe('203.0.113.0/24');
        expect(networkOf('::ffff:203.0.113.77')).toBe('203.0.113.0/24');
    });

    it('reduces an IPv6 address to its /64, whatever the spelling', () => {
        expect(networkOf('2001:db8:0:1::5')).toBe('2001:0db8:0000:0001::/64');
        expect(networkOf('2001:0DB8:0000:0001:ffff:0:0:9')).toBe('2001:0db8:0000:0001::/64');
    });

    it('returns null for something that is not an address', () => {
        expect(networkOf(undefined)).toBeNull();
        expect(networkOf('not-an-ip')).toBeNull();
    });
});

describe('AnonymousCallerKeyer', () => {
    it('gives every address in one range the same id, so rotating addresses does not reset a limit', () => {
        const keyer = new AnonymousCallerKeyer('salt');
        expect(keyer.keyFor('2001:db8:0:1::5')).toBe(keyer.keyFor('2001:db8:0:1:aaaa::9'));
        expect(keyer.keyFor('203.0.113.1')).toBe(keyer.keyFor('203.0.113.250'));
        expect(keyer.keyFor('203.0.113.1')).not.toBe(keyer.keyFor('203.0.114.1'));
    });

    it('returns a salted hash that does not contain the address', () => {
        const id = new AnonymousCallerKeyer('salt').keyFor('203.0.113.1');
        expect(id).toMatch(/^[0-9a-f]{16}$/);
        expect(id).not.toBe(new AnonymousCallerKeyer('other-salt').keyFor('203.0.113.1'));
    });

    it('puts every caller without a readable address in one shared bucket', () => {
        expect(new AnonymousCallerKeyer('salt').keyFor(undefined)).toBe('unknown');
    });
});
