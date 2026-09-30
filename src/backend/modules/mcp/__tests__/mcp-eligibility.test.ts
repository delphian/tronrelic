/**
 * @fileoverview Tests for the MCP eligibility floor and the capability
 * fingerprint it pairs with.
 */

import { describe, it, expect } from 'vitest';
import type { IAiToolCapability } from '@/types';
import { getMcpToolIneligibility } from '@/types';
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
