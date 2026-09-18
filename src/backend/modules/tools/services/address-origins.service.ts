/**
 * @fileoverview Address-origins climb policy and blockchain delegation.
 *
 * Backs the Address Origins tool, which traces a wallet back through its chain of
 * activator accounts toward a final originator. The heavy lifting — the bounded,
 * cycle-guarded activation climb — lives once on the core blockchain service
 * (`climbActivationAncestry`); this service adds the tool's two concerns on top:
 * validating/gating the request (anonymous callers get one address and only the
 * immediate parent; registered callers get the multi-wallet, full-ladder climb),
 * pacing the climb so one request cannot drain the shared provider queue, and
 * resolving the blockchain service lazily from the registry so a boot-order
 * change can never leave the tool holding a stale reference.
 */

import type {
    IServiceRegistry,
    IBlockchainService,
    IActivationAncestry,
    IActivationClimbOptions,
    IActivatingTransaction
} from '@/types';
import { CallPacer } from '../lib/CallPacer.js';
import type { AddressService } from './address.service.js';

/** Anonymous callers may submit a single address. */
export const ANONYMOUS_MAX_ADDRESSES = 1;

/** Anonymous callers see only the immediate parent — a one-hop climb. */
export const ANONYMOUS_MAX_DEPTH = 1;

/** Registered callers may compare up to this many wallets in one query. */
export const AUTHENTICATED_MAX_ADDRESSES = 10;

/**
 * Minimum wall-clock time one upward step of a ladder occupies.
 *
 * This is the tool's own rationing, and it is deliberately coarser than the
 * 200ms spacing core puts between individual TronGrid calls. Core's spacing
 * protects the provider from the process as a whole; this one stops a single
 * origins request from spending the whole of that allowance on itself while live
 * block sync waits behind it. A step costs two or three provider calls, so a
 * signed-in caller climbing ten wallets to the depth cap would otherwise
 * commission several hundred calls back to back.
 *
 * It is a property of the step, not of the call: the calls inside one step still
 * run at whatever rate core allows, and the interval is measured from when the
 * step starts, so a step that spends longer than this waiting on the queue is
 * never delayed on top of that.
 */
export const ORIGINS_UPWALK_INTERVAL_MS = 2000;

/**
 * A qualification that applies to one rung of a ladder.
 *
 * Why the stream carries these rather than leaving the UI to infer them: the
 * reasons a rung is weaker than it looks live in how the edge was resolved, and
 * that knowledge is here, not in the browser. A ladder rendered without them
 * reads as a chain of equally solid facts, which is the tool's central honesty
 * problem — a rung naming a contract, a rung naming a transaction signer, and a
 * rung whose timing nothing could verify all look identical otherwise.
 *
 * - `internal-transfer` — the activating value came out of a contract's balance.
 * - `climbed-caller` — the rung is the signer of that contract call, not the
 *   contract, because the signer is the party worth following.
 * - `caller-unresolved` — an internal activation whose signer could not be read,
 *   so the rung is the contract and everything above it is the contract's own
 *   history rather than this account's.
 * - `creation-time-unverified` — the subject carries no creation stamp, so the
 *   attribution rests on the transaction's type alone.
 */
export type ActivationHopCaveat =
    | 'internal-transfer'
    | 'climbed-caller'
    | 'caller-unresolved'
    | 'creation-time-unverified';

/**
 * List the qualifications that apply to one resolved edge.
 *
 * Kept a pure function of the edge so the wording in the UI and the reasoning
 * behind it cannot drift apart: whatever the stream says about a rung is derived
 * here, from the same object the rung was built from, and is unit-testable
 * without an HTTP round trip.
 *
 * @param edge - The resolved activation edge for one hop.
 * @returns Caveat codes for that hop, empty for an ordinary signed transfer
 *   whose timing checked out — the case that needs no qualification.
 */
export function resolveHopCaveats(edge: IActivatingTransaction): ActivationHopCaveat[] {
    const caveats: ActivationHopCaveat[] = [];
    const isInternal = edge.contractType === 'InternalTransaction';
    if (isInternal) {
        caveats.push('internal-transfer');
        caveats.push(edge.callerAddress ? 'climbed-caller' : 'caller-unresolved');
    }
    if (edge.creationTimeVerified === false) {
        caveats.push('creation-time-unverified');
    }
    return caveats;
}

/**
 * The gated, validated execution plan for one origins query. Separating this from
 * the streaming loop keeps the gating policy a pure, testable function of the raw
 * input and the caller's auth state.
 */
export interface IAddressOriginsPlan {
    /** Validated, de-duplicated, auth-capped addresses to climb, in input order. */
    addresses: string[];
    /**
     * Hop cap for each climb. `undefined` means the blockchain service's own
     * default (a full ladder); anonymous callers are pinned to one hop.
     */
    maxDepth?: number;
    /**
     * True when the caller's plan was narrowed by the anonymous gate (fewer
     * addresses and/or a shallower climb than a registered caller would get), so
     * the UI can surface a sign-in prompt rather than silently under-delivering.
     */
    limited: boolean;
}

/**
 * Resolves origins-query policy and delegates the climb to the core blockchain
 * service.
 */
export class AddressOriginsService {
    /**
     * @param serviceRegistry - Registry the `'blockchain'` service is published on;
     *   resolved lazily per request rather than cached at construction so the tool
     *   always uses the live singleton regardless of module init ordering.
     * @param addressService - Validates each candidate with a full Base58Check
     *   round trip, so a valid-alphabet typo (which a length/charset regex would
     *   wave through) is rejected before it becomes a bogus TronGrid lookup that
     *   would surface a nonexistent address as its own origin.
     */
    public constructor(
        private readonly serviceRegistry: IServiceRegistry,
        private readonly addressService: AddressService
    ) {}

    /**
     * Turn raw, untrusted input into a safe execution plan for the caller's tier.
     *
     * Why gate here rather than in the controller: the caps are the product rule
     * (anonymous = one wallet, immediate parent only), and enforcing them in one
     * pure method keeps the streaming handler free of policy and lets the rule be
     * unit-tested without an HTTP round trip. Invalid and duplicate addresses are
     * dropped so a single typo never aborts an otherwise-valid multi-wallet query.
     *
     * @param rawAddresses - Candidate addresses split from the request, unvalidated.
     * @param loggedIn - Whether the request carries an authenticated session.
     * @returns The validated, capped plan plus whether the anonymous gate narrowed it.
     */
    public resolvePlan(rawAddresses: string[], loggedIn: boolean): IAddressOriginsPlan {
        const seen = new Set<string>();
        const valid: string[] = [];
        for (const candidate of rawAddresses) {
            const address = candidate.trim();
            // Full Base58Check validation, not a charset regex — a mistyped address
            // that stays in the base58 alphabet must be rejected here, or it climbs
            // as a nonexistent account and renders as a spurious origin.
            const validation = this.addressService.validateAddress(address);
            if (validation.valid && validation.format === 'base58' && !seen.has(address)) {
                seen.add(address);
                valid.push(address);
            }
        }

        const maxAddresses = loggedIn ? AUTHENTICATED_MAX_ADDRESSES : ANONYMOUS_MAX_ADDRESSES;
        const addresses = valid.slice(0, maxAddresses);

        return {
            addresses,
            maxDepth: loggedIn ? undefined : ANONYMOUS_MAX_DEPTH,
            limited: !loggedIn
        };
    }

    /**
     * Build the pacer that rations one request's upward steps.
     *
     * Why the caller holds the pacer rather than the service owning one: this
     * service is a singleton shared by every request, and the interval is meant
     * to ration each request rather than to queue one caller behind another. A
     * fresh pacer per request gives each stream its own budget; every ladder
     * within that stream then shares it, which is what makes a multi-wallet
     * comparison cost the same in provider pressure as a single-wallet one.
     *
     * @param signal - Aborted when the request is over, so a step waiting out its
     *   interval stops waiting instead of holding a timer for a client that has
     *   already gone.
     * @returns A pacer scoped to one request, to hand to {@link climbSteps}.
     */
    public createUpwalkPacer(signal?: AbortSignal): CallPacer {
        return new CallPacer(ORIGINS_UPWALK_INTERVAL_MS, signal);
    }

    /**
     * Climb one address's activation ancestry, stepped one hop per `next()` and
     * paced so consecutive steps cannot run back to back.
     *
     * Why the streaming handler wants this shape rather than a whole-chain climb:
     * a per-wallet climb can only run to completion before the next wallet starts,
     * so the last wallet in a ten-wallet comparison shows nothing until the first
     * nine finish. Advancing one generator per wallet round-robin fills every
     * ladder together at the same total provider cost.
     *
     * Two steps are deliberately left unpaced. A ladder's first hop runs at once,
     * because a trace that shows nothing for two seconds reads as a page that
     * failed rather than one that is being careful. And the final call — the one
     * that reports how the climb ended rather than yielding a rung — is not
     * padded either, since delaying it would add the full interval to the end of
     * every ladder without a rung to show for it.
     *
     * @param address - Base58 address to climb.
     * @param options - Depth cap and the batch's shared edge cache; passing the
     *   same cache to every wallet is what keeps a converging tail to one lookup.
     * @param pacer - The request's pacer from {@link createUpwalkPacer}. Every
     *   ladder in one request must be given the same instance, or each ladder
     *   paces itself and a ten-wallet request runs ten times as hot.
     * @returns Generator yielding each hop, returning the completed ancestry.
     */
    public async *climbSteps(
        address: string,
        options: IActivationClimbOptions,
        pacer: CallPacer
    ): AsyncGenerator<IActivatingTransaction, IActivationAncestry, void> {
        const steps = this.blockchain().climbActivationAncestrySteps(address, options);
        let hopsYielded = 0;
        let step: IteratorResult<IActivatingTransaction, IActivationAncestry>;

        do {
            step = await pacer.run(
                () => steps.next(),
                { shouldPace: result => hopsYielded > 0 && !result.done }
            );
            if (!step.done) {
                hopsYielded += 1;
                yield step.value;
            }
        } while (!step.done);

        return step.value;
    }

    /**
     * Resolve the published blockchain service, failing loudly if it is absent —
     * which in a running app means a registration regression, not a normal state.
     *
     * @returns The live `IBlockchainService`.
     * @throws When no `'blockchain'` service is registered.
     */
    private blockchain(): IBlockchainService {
        const service = this.serviceRegistry.get<IBlockchainService>('blockchain');
        if (!service) {
            throw new Error('Blockchain service is not registered as "blockchain" on the service registry.');
        }
        return service;
    }
}
