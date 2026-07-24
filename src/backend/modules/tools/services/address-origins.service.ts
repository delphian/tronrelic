/**
 * @fileoverview Address-origins climb policy and blockchain delegation.
 *
 * Backs the Address Origins tool, which traces a wallet back through its chain of
 * activator accounts toward a final originator. The heavy lifting — the bounded,
 * cycle-guarded activation climb — lives once on the core blockchain service
 * (`climbActivationAncestry`); this service adds the tool's two concerns on top:
 * validating/gating the request (anonymous callers get one address and only the
 * immediate parent; registered callers get the multi-wallet, full-ladder climb)
 * and resolving the blockchain service lazily from the registry so a boot-order
 * change can never leave the tool holding a stale reference.
 */

import type {
    IServiceRegistry,
    IBlockchainService,
    IActivationAncestry,
    IActivationClimbOptions
} from '@/types';
import type { AddressService } from './address.service.js';

/** Anonymous callers may submit a single address. */
export const ANONYMOUS_MAX_ADDRESSES = 1;

/** Anonymous callers see only the immediate parent — a one-hop climb. */
export const ANONYMOUS_MAX_DEPTH = 1;

/** Registered callers may compare up to this many wallets in one query. */
export const AUTHENTICATED_MAX_ADDRESSES = 10;

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
     * Climb one address's activation ancestry, forwarding the streaming callback
     * and shared edge cache straight through to the core service.
     *
     * @param address - Base58 address to climb.
     * @param options - Depth cap, per-hop `onHop` stream callback, and the batch's
     *   shared edge cache (see {@link IActivationClimbOptions}).
     * @returns The collected ancestry with origin/truncated flags.
     */
    public async climb(address: string, options: IActivationClimbOptions): Promise<IActivationAncestry> {
        return this.blockchain().climbActivationAncestry(address, options);
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
