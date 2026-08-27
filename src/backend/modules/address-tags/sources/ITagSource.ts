/**
 * @fileoverview The contract a machine tag source implements so the ingestion
 * service can run any of them the same way.
 *
 * A source is one external authority (a sanctions list, a freeze feed, a
 * screening API) turned into `IAddressTagAssertion` batches that
 * `AddressTagService.syncSource` can reconcile. Keeping the contract here
 * rather than in `@/types` is deliberate: sources are module-internal plumbing
 * the ingestion service owns, not a surface other components consume through
 * the service registry.
 *
 * Three modes exist because an on-demand point lookup behaves as neither a
 * snapshot nor a delta: `snapshot` hands over the source's complete current
 * state each run, `delta` reports only changes since a stored cursor, and
 * `lookup` answers for one address when asked. `publish` is designed in now
 * and unused in the first release — every shipping source is authoritative
 * (`direct`); `quarantined` routes through the curation queue when the entity
 * sources arrive in phase 6.
 */

import type { IAddressTagAssertion } from '@/types';

/** What one fetch (or screen) run of a source produced. */
export interface ITagSourceResult {
    /** Everything the source asserts (snapshot) or newly asserts (delta/lookup). */
    assertions: IAddressTagAssertion[];
    /** Delta and lookup sources only: assertions the source explicitly revoked. */
    withdrawn?: IAddressTagAssertion[];
    /**
     * Opaque resume position for delta sources; stored per source and replayed
     * verbatim into the next `fetch`. Absent when the source has no notion of
     * position (snapshot, lookup).
     */
    cursor?: string;
}

/** One external tag authority the ingestion service can run. */
export interface ITagSource {
    /** Stable source id — the `sources[].id` value written into documents. */
    id: string;
    /** How the source reports: complete state, changes only, or per-address. */
    mode: 'snapshot' | 'delta' | 'lookup';
    /** Whether assertions publish directly or via the curation queue (phase 6). */
    publish: 'direct' | 'quarantined';
    /** Default cron for scheduled sources; absent for lookup sources. */
    cron?: string;

    /**
     * Retrieve the source's current assertions. Snapshot sources ignore the
     * cursor and return everything; delta sources resume from it and return
     * the changes plus a new cursor. Lookup sources do not implement a bulk
     * fetch and throw here — they are driven per address through
     * {@link ILookupTagSource.screen}.
     *
     * @param cursor - The stored resume position from the previous run, if any.
     * @returns The assertions (and withdrawals/cursor where the mode has them).
     */
    fetch(cursor?: string): Promise<ITagSourceResult>;
}

/**
 * A source that can re-verify its own held assertions against the authority's
 * current state — the drift repair a delta source needs, because an event feed
 * that misses one event stays wrong forever without it. The ingestion service
 * loads the addresses currently held live under `verifiedTag` and hands them
 * to `verify`; confirmations refresh, denials withdraw.
 */
export interface IVerifiableTagSource extends ITagSource {
    /** The tag whose live holdings the verify pass re-checks. */
    verifiedTag: string;

    /**
     * Re-check the given held addresses against the authority. An address the
     * check cannot reach must be omitted from both lists — a transport failure
     * is not evidence of delisting.
     *
     * @param addresses - Addresses currently held live under `verifiedTag`.
     * @returns Confirmations as assertions and denials as withdrawals.
     */
    verify(addresses: string[]): Promise<ITagSourceResult>;
}

/**
 * Type guard for {@link IVerifiableTagSource}, so the ingestion service can
 * offer the verify pass only for sources that implement it.
 *
 * @param source - Any registered source.
 * @returns True when the source carries the verify capability.
 */
export function isVerifiableTagSource(source: ITagSource): source is IVerifiableTagSource {
    return typeof (source as IVerifiableTagSource).verify === 'function'
        && typeof (source as IVerifiableTagSource).verifiedTag === 'string';
}

/**
 * A lookup-mode source, extended with the per-address entry point the bulk
 * `fetch` contract cannot express.
 */
export interface ILookupTagSource extends ITagSource {
    mode: 'lookup';

    /**
     * Screen one address against the source. A positive answer arrives as an
     * assertion; a clean answer arrives as a withdrawal of the same pair so a
     * previously flagged address that has been delisted stops showing.
     *
     * @param address - Base58 TRON address to screen.
     * @returns Assertion or withdrawal for exactly this address.
     */
    screen(address: string): Promise<ITagSourceResult>;
}
