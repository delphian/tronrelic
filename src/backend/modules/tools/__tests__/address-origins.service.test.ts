/**
 * @fileoverview Tests for the Address Origins gating policy.
 *
 * The access tiers are the security boundary of the tool — anonymous callers must
 * not be able to climb the full ladder or fan out across many wallets no matter
 * what they submit. `resolvePlan` is where that rule is enforced, so it is tested
 * directly and independently of the SSE transport.
 */

import { describe, it, expect } from 'vitest';
import type { IServiceRegistry } from '@/types';
import {
    AddressOriginsService,
    ANONYMOUS_MAX_DEPTH,
    AUTHENTICATED_MAX_ADDRESSES
} from '../services/address-origins.service.js';

/** A valid base58 address is `T` + 33 base58 chars; build distinct fakes cheaply. */
const validAddress = (suffix: string): string => `T${'A'.repeat(33 - suffix.length)}${suffix}`;

/** resolvePlan does not touch the registry, so a no-op stub is sufficient. */
const service = new AddressOriginsService({ get: () => undefined } as unknown as IServiceRegistry);

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
