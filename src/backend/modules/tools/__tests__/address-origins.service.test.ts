/**
 * @fileoverview Tests for the Address Origins gating and pacing policy.
 *
 * The access tiers are the security boundary of the tool — anonymous callers must
 * not be able to climb the full ladder or fan out across many wallets no matter
 * what they submit. `resolvePlan` is where that rule is enforced, so it is tested
 * directly and independently of the SSE transport.
 *
 * The pacing rule is the tool's other self-imposed limit, and it is tested here
 * for the same reason: which steps are held back and which are let through is a
 * property of `climbSteps`, not of the transport, and the two exemptions (a
 * ladder's first rung and its closing step) are easy to lose in a refactor
 * without any other test noticing.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import type {
    IActivatingTransaction,
    IActivationAncestry,
    IBlockchainService,
    IServiceRegistry
} from '@/types';
import type { AddressService } from '../services/address.service.js';
import { CallPacer } from '../lib/CallPacer.js';
import {
    AddressOriginsService,
    ANONYMOUS_MAX_DEPTH,
    AUTHENTICATED_MAX_ADDRESSES,
    ORIGINS_UPWALK_INTERVAL_MS,
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

/**
 * Build a service whose climb is a fixed list of hops, why: the pacing tests
 * care only about *when* each hop reaches the consumer, so a stubbed climb that
 * resolves instantly makes every millisecond in the assertions attributable to
 * the pacer rather than to a simulated provider.
 *
 * @param hopCount - Number of rungs the stubbed ladder yields before ending.
 * @returns A service wired to that stubbed climb.
 */
function serviceWithClimb(hopCount: number): AddressOriginsService {
    /**
     * Yield `hopCount` synthetic rungs, then report the climb as exhausted.
     *
     * @returns Generator matching `IBlockchainService.climbActivationAncestrySteps`.
     */
    async function* climb(): AsyncGenerator<IActivatingTransaction, IActivationAncestry, void> {
        const chain: IActivatingTransaction[] = [];
        for (let depth = 0; depth < hopCount; depth += 1) {
            const hop = edge({ txId: `tx-${depth}` });
            chain.push(hop);
            yield hop;
        }
        return {
            address: validAddress('1'),
            chain,
            stopReason: 'unresolved',
            originReached: true,
            truncated: false
        };
    }

    const blockchain = { climbActivationAncestrySteps: () => climb() } as unknown as IBlockchainService;
    const registry = {
        get: (name: string) => (name === 'blockchain' ? blockchain : undefined)
    } as unknown as IServiceRegistry;

    return new AddressOriginsService(registry, stubAddressService);
}

/**
 * Drain a paced climb and record when each event reached the consumer.
 *
 * @param service - Service whose `climbSteps` is under test.
 * @param pacer - Pacer shared by the drain, standing in for the request's own.
 * @returns Millisecond offsets for each rung, plus a final entry for the moment
 *   the climb reported its ending.
 */
async function arrivalOffsets(service: AddressOriginsService, pacer: CallPacer): Promise<number[]> {
    const startedAt = Date.now();
    const offsets: number[] = [];

    const drain = (async () => {
        const steps = service.climbSteps(validAddress('1'), {}, pacer);
        let step = await steps.next();
        while (!step.done) {
            offsets.push(Date.now() - startedAt);
            step = await steps.next();
        }
        offsets.push(Date.now() - startedAt);
    })();

    await vi.advanceTimersByTimeAsync(ORIGINS_UPWALK_INTERVAL_MS * 10);
    await drain;
    return offsets;
}

describe('AddressOriginsService.climbSteps pacing', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('holds each rung after the first for the upwalk interval', async () => {
        vi.useFakeTimers();
        const offsets = await arrivalOffsets(serviceWithClimb(3), new CallPacer(ORIGINS_UPWALK_INTERVAL_MS));

        // First rung immediately (a trace that shows nothing for two seconds
        // reads as broken), then one every interval, and the closing step with
        // no extra wait because it carries no rung to show.
        expect(offsets).toEqual([0, 2000, 4000, 4000]);
    });

    it('shares one pacer across ladders, so a second wallet waits its turn', async () => {
        vi.useFakeTimers();
        const pacer = new CallPacer(ORIGINS_UPWALK_INTERVAL_MS);
        const startedAt = Date.now();
        const arrivals: string[] = [];

        // Two ladders advanced round-robin exactly as the SSE handler drives
        // them. Sharing the pacer is what keeps a multi-wallet request costing
        // the provider what a single-wallet one does.
        const first = serviceWithClimb(2).climbSteps(validAddress('1'), {}, pacer);
        const second = serviceWithClimb(2).climbSteps(validAddress('2'), {}, pacer);

        const drain = (async () => {
            for (let pass = 0; pass < 2; pass += 1) {
                await first.next();
                arrivals.push(`a@${Date.now() - startedAt}`);
                await second.next();
                arrivals.push(`b@${Date.now() - startedAt}`);
            }
        })();

        await vi.advanceTimersByTimeAsync(ORIGINS_UPWALK_INTERVAL_MS * 10);
        await drain;

        // Both first rungs are exempt, so they arrive together; every rung after
        // that takes a full slot of its own.
        expect(arrivals).toEqual(['a@0', 'b@0', 'a@2000', 'b@4000']);
    });

    it('paces nothing when the pacer is configured with no interval', async () => {
        vi.useFakeTimers();
        const offsets = await arrivalOffsets(serviceWithClimb(3), new CallPacer(0));
        expect(offsets).toEqual([0, 0, 0, 0]);
    });
});
