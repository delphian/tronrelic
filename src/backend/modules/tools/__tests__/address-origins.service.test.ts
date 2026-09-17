/**
 * @fileoverview Tests for the Address Origins gating policy.
 *
 * The access tiers are the security boundary of the tool — anonymous callers must
 * not be able to climb the full ladder or fan out across many wallets no matter
 * what they submit. `resolvePlan` is where that rule is enforced, so it is tested
 * directly and independently of the SSE transport.
 */

import { describe, it, expect } from 'vitest';
import type { IActivatingTransaction, IServiceRegistry } from '@/types';
import type { AddressService } from '../services/address.service.js';
import {
    AddressOriginsService,
    ANONYMOUS_MAX_DEPTH,
    AUTHENTICATED_MAX_ADDRESSES,
    resolveHopCaveats
} from '../services/address-origins.service.js';

/**
 * Synthetic `T…` fixtures that satisfy the base58 charset but not a real
 * Base58Check round trip, so the gating tests need a stub validator — the real
 * checksum path is AddressService's own test's concern. This suite covers only
 * the caps/dedup policy, which sits downstream of validity.
 */
const CHARSET = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const validAddress = (suffix: string): string => `T${'A'.repeat(33 - suffix.length)}${suffix}`;

/** Stub validator: treats any charset-valid `T…` string as a base58 address. */
const stubAddressService = {
    validateAddress: (input: string) => {
        const ok = CHARSET.test(input.trim());
        return { valid: ok, format: ok ? 'base58' : null };
    }
} as unknown as AddressService;

/** resolvePlan does not touch the registry, so a no-op stub is sufficient. */
const service = new AddressOriginsService(
    { get: () => undefined } as unknown as IServiceRegistry,
    stubAddressService
);

describe('AddressOriginsService.resolvePlan', () => {
    it('caps anonymous callers to one address and a single hop', () => {
        const plan = service.resolvePlan([validAddress('1'), validAddress('2'), validAddress('3')], false);
        expect(plan.addresses).toEqual([validAddress('1')]);
        expect(plan.maxDepth).toBe(ANONYMOUS_MAX_DEPTH);
        expect(plan.limited).toBe(true);
    });

    it('lets registered callers climb the full ladder across many wallets', () => {
        const plan = service.resolvePlan([validAddress('1'), validAddress('2')], true);
        expect(plan.addresses).toEqual([validAddress('1'), validAddress('2')]);
        expect(plan.maxDepth).toBeUndefined();
        expect(plan.limited).toBe(false);
    });

    it('caps registered callers at the multi-wallet limit', () => {
        const many = Array.from({ length: AUTHENTICATED_MAX_ADDRESSES + 5 }, (_, i) => validAddress(String(i).padStart(2, '9')));
        const plan = service.resolvePlan(many, true);
        expect(plan.addresses).toHaveLength(AUTHENTICATED_MAX_ADDRESSES);
    });

    it('drops invalid addresses and de-duplicates', () => {
        const plan = service.resolvePlan([validAddress('1'), 'not-an-address', validAddress('1'), '0x1234', validAddress('2')], true);
        expect(plan.addresses).toEqual([validAddress('1'), validAddress('2')]);
    });

    it('yields no addresses when none are valid', () => {
        const plan = service.resolvePlan(['', 'garbage', '   '], true);
        expect(plan.addresses).toEqual([]);
    });
});

/**
 * Build an activation edge with only the fields the caveat rules read, why: the
 * rules are a pure function of the edge, so a fixture carrying the whole shape
 * would obscure which field drove each outcome.
 *
 * @param overrides - The fields under test.
 * @returns An edge sufficient for {@link resolveHopCaveats}.
 */
function edge(overrides: Partial<IActivatingTransaction>): IActivatingTransaction {
    return {
        activatorAddress: validAddress('1'),
        txId: 'tx',
        blockTimestamp: 1_700_000_000_000,
        contractType: 'TransferContract',
        creationTimeVerified: true,
        ...overrides
    };
}

describe('resolveHopCaveats', () => {
    it('qualifies nothing on an ordinary verified transfer', () => {
        expect(resolveHopCaveats(edge({}))).toEqual([]);
    });

    it('reports a contract-funded hop and says the signer was followed', () => {
        const caveats = resolveHopCaveats(edge({
            contractType: 'InternalTransaction',
            callerAddress: validAddress('2')
        }));
        expect(caveats).toEqual(['internal-transfer', 'climbed-caller']);
    });

    it('warns when an internal hop has no signer, because the ladder then follows code', () => {
        const caveats = resolveHopCaveats(edge({ contractType: 'InternalTransaction' }));
        expect(caveats).toEqual(['internal-transfer', 'caller-unresolved']);
    });

    it('flags an edge the account\'s own record could not confirm', () => {
        expect(resolveHopCaveats(edge({ creationTimeVerified: false }))).toEqual(['creation-time-unverified']);
    });

    it('stays quiet when the verification flag is absent rather than false', () => {
        // An edge read from a cache written before the flag existed must not be
        // presented as unverified when nothing is known either way.
        expect(resolveHopCaveats(edge({ creationTimeVerified: undefined }))).toEqual([]);
    });
});
