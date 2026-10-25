/**
 * Unit tests for the tag meanings the chain query tools attach to their responses.
 *
 * Models read `market:catfee:pool-wallet` as "CatFee's pool wallet" unless the
 * source's own meaning travels with the tag. These tests pin when a meaning is
 * given: only from a source asserting the tag on one of the response's
 * addresses, never for a tag only a human typed, and never at the cost of the
 * tags themselves when the definition read fails.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IAddressTag, IAddressTagService, IAddressTagSourceDefinition } from '@/types';
import { AddressTagLookup } from '../chain-query/AddressTagLookup.js';
import { summarizeCoverage } from '../chain-query/ChainCoverageReader.js';
import type { IChainWindow } from '../chain-query/chainQueryInput.js';
import { buildChainResponse } from '../chain-query/chainQueryResponse.js';
import { NOW, PEER, WALLET } from './chainQueryTestToolkit.js';

/** The meaning the fake rental-markets source gives its tag. */
const POOL_MEANING = 'Observed taking part in the catfee market in the pool-wallet role.';

/**
 * A live tag assignment.
 *
 * @param address - The tagged address.
 * @param tag - The tag text.
 * @param sources - The machine sources asserting it; empty for a human-typed tag.
 * @returns The record.
 */
function assignment(address: string, tag: string, sources: string[]): IAddressTag {
    return {
        address,
        tag,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        updatedAt: new Date('2026-10-01T00:00:00Z'),
        manual: sources.length === 0,
        active: true,
        sources: sources.map(id => ({ id, observedAt: new Date('2026-10-01T00:00:00Z') }))
    };
}

/**
 * Build a lookup over a fake tag service.
 *
 * @param records - What `getTagsByAddresses` answers.
 * @param definitions - What `getTagDefinitions` answers, or an error it throws.
 * @returns The lookup and the fake's definition read, for call assertions.
 */
function buildLookup(records: IAddressTag[], definitions: IAddressTagSourceDefinition[] | Error) {
    const getTagDefinitions = vi.fn(async () => {
        if (definitions instanceof Error) {
            throw definitions;
        }
        return definitions;
    });
    const service = {
        getTagsByAddresses: vi.fn(async () => records),
        getTagDefinitions
    } as unknown as IAddressTagService;
    return { lookup: new AddressTagLookup(() => service), getTagDefinitions };
}

describe('AddressTagLookup meanings', () => {
    it('gives each tag one meaning from a source asserting it, and none to a tag only a human typed', async () => {
        const { lookup, getTagDefinitions } = buildLookup(
            [
                assignment(WALLET, 'market:catfee:pool-wallet', ['rental-markets']),
                assignment(PEER, 'market:catfee:pool-wallet', ['rental-markets']),
                assignment(PEER, 'exchange', [])
            ],
            [{ source: 'rental-markets', tag: 'market:catfee:pool-wallet', meaning: POOL_MEANING, updatedAt: new Date() }]
        );

        const result = await lookup.lookup([WALLET, PEER]);

        // The human-typed tag has no source, so its definition is not even asked for.
        expect(getTagDefinitions).toHaveBeenCalledWith(['market:catfee:pool-wallet']);
        expect(result.meanings).toEqual({ 'market:catfee:pool-wallet': POOL_MEANING });
        expect(result.tags).toEqual({ [WALLET]: ['market:catfee:pool-wallet'], [PEER]: ['market:catfee:pool-wallet', 'exchange'] });
    });

    it('ignores a definition written by a source that does not assert the tag here', async () => {
        const { lookup } = buildLookup(
            [assignment(WALLET, 'market:catfee', ['rental-markets'])],
            [{ source: 'some-other-source', tag: 'market:catfee', meaning: 'Not this source\'s claim.', updatedAt: new Date() }]
        );

        const result = await lookup.lookup([WALLET]);

        expect(result.meanings).toBeUndefined();
    });

    it('keeps the tags when the definition read fails', async () => {
        const { lookup } = buildLookup([assignment(WALLET, 'market:catfee', ['rental-markets'])], new Error('definitions unavailable'));

        const result = await lookup.lookup([WALLET]);

        expect(result).toEqual({ tags: { [WALLET]: ['market:catfee'] }, available: true });
    });

    it('puts meanings in the response as tagMeanings, and leaves the field out when there are none', () => {
        const window: IChainWindow = { from: new Date(NOW.getTime() - 3_600_000), to: NOW, clampedToRetention: false };
        const coverage = summarizeCoverage({
            first_block: '1000',
            last_block: '1199',
            present: '200',
            without_receipts: '0',
            first_at: '2026-09-24 11:00:00.000',
            last_at: '2026-09-24 12:00:00.000'
        }, window, NOW.getTime());

        const withMeanings = buildChainResponse(
            { window, coverage, tokens: new Map(), tags: { tags: {}, available: true, meanings: { 'market:catfee': 'Observed in catfee.' } } },
            {}
        );
        const without = buildChainResponse({ window, coverage, tokens: new Map(), tags: { tags: {}, available: true } }, {});

        expect(withMeanings.tagMeanings).toEqual({ 'market:catfee': 'Observed in catfee.' });
        expect(without).not.toHaveProperty('tagMeanings');
    });
});
