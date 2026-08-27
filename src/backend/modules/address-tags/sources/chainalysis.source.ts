/**
 * @fileoverview Chainalysis screening source — an admin-requested point lookup
 * asserting `chainalysis:sanctioned` on addresses Chainalysis's free sanctions
 * screening API identifies.
 *
 * Lookup mode by design: no scheduled job, no queue, no cache worker, and no
 * ambient rate-limit spend. An admin screens one address at a time from the
 * `/system/address-tags` surface, which is what adds EU and UN coverage on top
 * of the bulk OFAC feed without a licensing decision.
 *
 * The API key is module key-value config edited from the Settings tab — not an
 * environment variable — so an operator can paste a key and have the next
 * screen use it without a redeploy. The key reaches this source through an
 * injected reader callback; the source never stores it, and the HTTP settings
 * surface never returns it.
 */

import type { IAddressTagAssertion } from '@/types';
import type { ILookupTagSource, ITagSourceResult } from './ITagSource.js';

/** The source id written into `sources[].id` on tagged documents. */
export const CHAINALYSIS_SOURCE_ID = 'chainalysis';

/** The reserved tag this source asserts. */
export const CHAINALYSIS_TAG = 'chainalysis:sanctioned';

/** Chainalysis free sanctions screening endpoint; the address is appended. */
const CHAINALYSIS_API_URL = 'https://public.chainalysis.com/api/v1/address/';

/** One identification row as the screening API returns it. */
interface IChainalysisIdentification {
    category?: string;
    name?: string;
    description?: string;
    url?: string;
}

/** The screening API's response envelope. */
interface IChainalysisResponse {
    identifications?: IChainalysisIdentification[];
}

/**
 * The Chainalysis lookup source. `fetch` throws by contract — a point lookup
 * has no bulk state to hand over — and all work happens in {@link screen}.
 */
export class ChainalysisSource implements ILookupTagSource {
    public readonly id = CHAINALYSIS_SOURCE_ID;
    public readonly mode = 'lookup' as const;
    public readonly publish = 'direct' as const;

    /**
     * @param readApiKey - Callback returning the currently configured API key,
     *                     or null when none is set. A callback rather than a
     *                     value because the key is runtime-editable config: the
     *                     screen that runs after an operator pastes a new key
     *                     must use it without rewiring the source.
     * @param fetchImpl - HTTP implementation, injectable so tests feed recorded
     *                    responses instead of spending the API's rate limit.
     */
    constructor(
        private readonly readApiKey: () => Promise<string | null>,
        private readonly fetchImpl: typeof fetch = fetch
    ) {}

    /** @inheritdoc */
    public async fetch(): Promise<ITagSourceResult> {
        throw new Error('The chainalysis source is a per-address lookup; use screen(address) instead of fetch()');
    }

    /** @inheritdoc */
    public async screen(address: string): Promise<ITagSourceResult> {
        const apiKey = await this.readApiKey();
        if (!apiKey) {
            throw new Error('No Chainalysis API key is configured; set one on the Settings tab first');
        }
        const response = await this.fetchImpl(`${CHAINALYSIS_API_URL}${encodeURIComponent(address)}`, {
            headers: { 'X-API-Key': apiKey, Accept: 'application/json' }
        });
        if (!response.ok) {
            throw new Error(`Chainalysis screen failed: HTTP ${response.status}`);
        }
        const body = await response.json() as IChainalysisResponse;
        const sanction = (body.identifications ?? []).find((item) => item.category === 'sanctions');

        const pair: IAddressTagAssertion = { address, tag: CHAINALYSIS_TAG };
        if (!sanction) {
            // A clean answer withdraws any prior flag: a screen that only ever
            // added would leave a delisted address marked forever.
            return { assertions: [], withdrawn: [pair] };
        }
        if (sanction.name) {
            pair.ref = sanction.name;
        }
        if (sanction.url) {
            pair.url = sanction.url;
        }
        return { assertions: [pair], withdrawn: [] };
    }
}
