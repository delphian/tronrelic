/**
 * @fileoverview Tests for the MCP eligibility floor and the capability
 * fingerprint it pairs with.
 */

import { describe, it, expect } from 'vitest';
import type { IAiToolCapability } from '@/types';
import { getMcpAnonymousToolIneligibility, getMcpToolIneligibility } from '@/types';
import { capabilityFingerprint } from '../services/capabilityFingerprint.js';

/** A capability the floor accepts. */
const OK: IAiToolCapability = { sideEffect: 'read', reversible: true, sensitivity: 'internal' };

describe('getMcpToolIneligibility', () => {
    it('accepts a read-only, reversible, non-secret, free tool', () => {
        expect(getMcpToolIneligibility(OK)).toBeNull();
        expect(getMcpToolIneligibility({ ...OK, sensitivity: 'public', surfacesUntrustedContent: true })).toBeNull();
    });

    it.each<[string, IAiToolCapability | undefined]>([
        ['undeclared', undefined],
        ['write', { ...OK, sideEffect: 'write' }],
        ['external', { ...OK, sideEffect: 'external' }],
        ['secret', { ...OK, sensitivity: 'secret' }],
        ['paid', { ...OK, spendsMoney: true, costPerCallUsd: 0.01 }],
        ['irreversible', { ...OK, reversible: false }]
    ])('refuses a %s tool', (_label, capability) => {
        expect(getMcpToolIneligibility(capability)).toEqual(expect.any(String));
    });
});

describe('capabilityFingerprint', () => {
    it('is stable for equal declarations regardless of key order', () => {
        const reordered = { sensitivity: 'internal', reversible: true, sideEffect: 'read' } as IAiToolCapability;
        expect(capabilityFingerprint(OK)).toBe(capabilityFingerprint(reordered));
    });

    it('changes when any governing field changes', () => {
        const base = capabilityFingerprint(OK);
        expect(capabilityFingerprint({ ...OK, surfacesUntrustedContent: true })).not.toBe(base);
        expect(capabilityFingerprint({ ...OK, sensitivity: 'public' })).not.toBe(base);
        expect(capabilityFingerprint(undefined)).not.toBe(base);
    });
});

describe('getMcpAnonymousToolIneligibility', () => {
    it('accepts a tool that passes the MCP floor and returns only public data', () => {
        expect(getMcpAnonymousToolIneligibility({ ...OK, sensitivity: 'public', surfacesUntrustedContent: true })).toBeNull();
    });

    it('refuses internal data, which members may see but strangers may not', () => {
        expect(getMcpAnonymousToolIneligibility(OK)).toMatch(/public/);
    });

    it('refuses a tool that acts on a user\'s own objects', () => {
        expect(getMcpAnonymousToolIneligibility({ ...OK, sensitivity: 'public', operatesOnUserOwnedObjects: true })).toMatch(/account/);
    });

    it('keeps every refusal of the MCP floor', () => {
        expect(getMcpAnonymousToolIneligibility({ ...OK, sensitivity: 'public', sideEffect: 'write' })).toBe(getMcpToolIneligibility({ ...OK, sensitivity: 'public', sideEffect: 'write' }));
        expect(getMcpAnonymousToolIneligibility(undefined)).not.toBeNull();
    });
});
