/**
 * @fileoverview Unit tests for the ingestion layer: the ingestion service's
 * run/cursor/state semantics and settings surface, the OFAC streaming scanner,
 * the USDT event-delta source, and the Chainalysis lookup source. All sources
 * run against injected fakes — recorded fixtures, never the network — so the
 * suite spends neither Treasury bandwidth nor the Chainalysis rate limit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { AddressTagService, ADDRESS_TAGS_COLLECTION } from '../services/address-tag.service.js';
import { TagIngestionService } from '../services/tag-ingestion.service.js';
import type { ITagSource, ITagSourceResult } from '../sources/ITagSource.js';
import { OfacXmlScanner, OfacSdnSource } from '../sources/ofac-sdn.source.js';
import { UsdtBlacklistSource, type IUsdtBlacklistTransport } from '../sources/usdt-blacklist.source.js';
import { ChainalysisSource } from '../sources/chainalysis.source.js';

const ADDRESS_A = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ADDRESS_B = 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8';

/** Hex form of ADDRESS_A as TronGrid event payloads deliver addresses. */
const ADDRESS_A_HEX = '0xa614f803b6fd780986a42c78ec9c7f77e6ded13c';

/**
 * Wire a fresh tag service singleton plus an ingestion service over one mock
 * database, so reconciles and KV state land where the assertions can see them.
 *
 * @returns The ingestion service, the tag service, the mock database, and the logger.
 */
function createHarness() {
    const database = createMockDatabaseService();
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;
    AddressTagService.resetForTests();
    AddressTagService.setDependencies({ database, logger });
    const tags = AddressTagService.getInstance();
    const ingestion = new TagIngestionService({ tags, database, logger });
    return { ingestion, tags, database, logger };
}

/**
 * A controllable fake source for ingestion-service tests.
 *
 * @param overrides - Fields and behaviour to override on the default snapshot fake.
 * @returns The fake source.
 */
function fakeSource(overrides: Partial<ITagSource> & { result?: ITagSourceResult }): ITagSource {
    const result = overrides.result ?? { assertions: [] };
    return {
        id: overrides.id ?? 'fake-source',
        mode: overrides.mode ?? 'snapshot',
        publish: overrides.publish ?? 'direct',
        cron: overrides.cron,
        fetch: overrides.fetch ?? (async () => result)
    };
}

describe('TagIngestionService', () => {
    let harness: ReturnType<typeof createHarness>;

    beforeEach(() => {
        harness = createHarness();
    });

    it('runs a snapshot source and records the outcome', async () => {
        harness.ingestion.registerSource(fakeSource({
            id: 'ofac-sdn',
            result: { assertions: [{ address: ADDRESS_A, tag: 'ofac:sdn' }] }
        }));
        const result = await harness.ingestion.runSource('ofac-sdn');
        expect(result).toMatchObject({ added: 1, withdrawn: 0, rejected: 0 });
        const statuses = await harness.ingestion.getStatuses();
        expect(statuses[0].state.lastError).toBeNull();
        expect(statuses[0].state.lastResult).toMatchObject({ added: 1 });
        expect(statuses[0].state.lastSuccessAt).toBeDefined();
    });

    it('passes the stored cursor in and persists the returned one', async () => {
        const fetch = vi.fn(async (cursor?: string): Promise<ITagSourceResult> => ({
            assertions: [],
            withdrawn: [],
            cursor: cursor ? String(Number(cursor) + 1) : '100'
        }));
        harness.ingestion.registerSource(fakeSource({ id: 'usdt-blacklist', mode: 'delta', fetch }));
        await harness.ingestion.runSource('usdt-blacklist');
        expect(fetch).toHaveBeenLastCalledWith(undefined);
        await harness.ingestion.runSource('usdt-blacklist');
        expect(fetch).toHaveBeenLastCalledWith('100');
        const statuses = await harness.ingestion.getStatuses();
        expect(statuses[0].cursor).toBe('101');
    });

    it('a failing run keeps the previous cursor and records the error beside the last success', async () => {
        let calls = 0;
        const fetch = vi.fn(async (): Promise<ITagSourceResult> => {
            calls += 1;
            if (calls === 2) {
                throw new Error('feed unavailable');
            }
            return { assertions: [], cursor: String(calls) };
        });
        harness.ingestion.registerSource(fakeSource({ id: 'usdt-blacklist', mode: 'delta', fetch }));
        await harness.ingestion.runSource('usdt-blacklist');
        await expect(harness.ingestion.runSource('usdt-blacklist')).rejects.toThrow('feed unavailable');
        const statuses = await harness.ingestion.getStatuses();
        // The cursor still points at the last successful window, so the next
        // tick retries it rather than skipping past the failure.
        expect(statuses[0].cursor).toBe('1');
        expect(statuses[0].state.lastError).toBe('feed unavailable');
        expect(statuses[0].state.lastSuccessAt).toBeDefined();
    });

    it('refuses to run a lookup source in bulk and an unknown source at all', async () => {
        harness.ingestion.registerSource(fakeSource({ id: 'chainalysis', mode: 'lookup' }));
        await expect(harness.ingestion.runSource('chainalysis')).rejects.toThrow(/per-address lookup/);
        await expect(harness.ingestion.runSource('nope')).rejects.toThrow(/Unknown tag source/);
    });

    it('defaults feed sources on and chainalysis off, and honours stored switches', async () => {
        harness.ingestion.registerSource(fakeSource({ id: 'ofac-sdn' }));
        harness.ingestion.registerSource(fakeSource({ id: 'chainalysis', mode: 'lookup' }));
        expect(await harness.ingestion.isSourceEnabled('ofac-sdn')).toBe(true);
        expect(await harness.ingestion.isSourceEnabled('chainalysis')).toBe(false);
        await harness.ingestion.updateSettings({ sources: { 'ofac-sdn': { enabled: false } }, chainalysis: { enabled: true } });
        expect(await harness.ingestion.isSourceEnabled('ofac-sdn')).toBe(false);
        expect(await harness.ingestion.isSourceEnabled('chainalysis')).toBe(true);
    });

    it('settings never surface the stored key, only presence and its last four characters', async () => {
        harness.ingestion.registerSource(fakeSource({ id: 'chainalysis', mode: 'lookup' }));
        await harness.ingestion.updateSettings({ chainalysis: { apiKey: 'super-secret-key-9876' } });
        const settings = await harness.ingestion.getSettings();
        expect(settings.chainalysis.configured).toBe(true);
        expect(settings.chainalysis.keySuffix).toBe('9876');
        expect(JSON.stringify(settings)).not.toContain('super-secret-key');
        expect(await harness.ingestion.readChainalysisKey()).toBe('super-secret-key-9876');

        await harness.ingestion.updateSettings({ chainalysis: { apiKey: null } });
        expect((await harness.ingestion.getSettings()).chainalysis.configured).toBe(false);
        expect(await harness.ingestion.readChainalysisKey()).toBeNull();
    });

    it('screenAddress applies a lookup answer as a delta reconcile once the switch is on', async () => {
        const source = fakeSource({ id: 'chainalysis', mode: 'lookup' }) as any;
        source.screen = vi.fn(async (address: string): Promise<ITagSourceResult> => ({
            assertions: [{ address, tag: 'chainalysis:sanctioned', ref: 'ENTITY' }],
            withdrawn: []
        }));
        harness.ingestion.registerSource(source);
        await harness.ingestion.updateSettings({ chainalysis: { enabled: true } });
        const result = await harness.ingestion.screenAddress(ADDRESS_A);
        expect(result.added).toBe(1);
        const docs = harness.database.getCollectionData(ADDRESS_TAGS_COLLECTION);
        expect(docs[0]).toMatchObject({ address: ADDRESS_A, tag: 'chainalysis:sanctioned', manual: false, active: true });
    });

    it('screenAddress refuses while the chainalysis switch is off', async () => {
        // The switch defaults off, and screening is the only thing it gates —
        // a lookup source has no scheduled runs — so an un-enabled source
        // must refuse rather than quietly spend the API's rate limit.
        const source = fakeSource({ id: 'chainalysis', mode: 'lookup' }) as any;
        source.screen = vi.fn();
        harness.ingestion.registerSource(source);
        await expect(harness.ingestion.screenAddress(ADDRESS_A))
            .rejects.toThrow(/screening is disabled/);
        expect(source.screen).not.toHaveBeenCalled();
    });

    it('verifyHeld re-checks only live holdings and applies the answer', async () => {
        await harness.tags.syncSource('usdt-blacklist', [
            { address: ADDRESS_A, tag: 'usdt:frozen' },
            { address: ADDRESS_B, tag: 'usdt:frozen' }
        ], 'delta');
        const verify = vi.fn(async (addresses: string[]): Promise<ITagSourceResult> => ({
            assertions: addresses.filter((address) => address === ADDRESS_A).map((address) => ({ address, tag: 'usdt:frozen' })),
            withdrawn: addresses.filter((address) => address === ADDRESS_B).map((address) => ({ address, tag: 'usdt:frozen' }))
        }));
        const source = fakeSource({ id: 'usdt-blacklist', mode: 'delta' }) as any;
        source.verifiedTag = 'usdt:frozen';
        source.verify = verify;
        harness.ingestion.registerSource(source);

        const result = await harness.ingestion.verifyHeld('usdt-blacklist');
        expect(verify).toHaveBeenCalledWith(expect.arrayContaining([ADDRESS_A, ADDRESS_B]));
        expect(result.withdrawn).toBe(1);
        const docs = harness.database.getCollectionData(ADDRESS_TAGS_COLLECTION);
        expect(docs.find((doc: any) => doc.address === ADDRESS_B).active).toBe(false);
        expect(docs.find((doc: any) => doc.address === ADDRESS_A).active).toBe(true);
    });

    it('a run and a verify pass on the same source cannot interleave', async () => {
        // Both paths reconcile the same source id; overlap would have each
        // withdrawing against holdings the other just changed, so they share
        // one per-source lock and the collision throws.
        let releaseFetch!: () => void;
        const gate = new Promise<void>((resolve) => { releaseFetch = resolve; });
        const source = fakeSource({
            id: 'usdt-blacklist',
            mode: 'delta',
            fetch: async () => { await gate; return { assertions: [] }; }
        }) as any;
        source.verifiedTag = 'usdt:frozen';
        source.verify = vi.fn(async (): Promise<ITagSourceResult> => ({ assertions: [], withdrawn: [] }));
        harness.ingestion.registerSource(source);

        const run = harness.ingestion.runSource('usdt-blacklist');
        await expect(harness.ingestion.verifyHeld('usdt-blacklist')).rejects.toThrow(/already running/);
        expect(source.verify).not.toHaveBeenCalled();
        releaseFetch();
        await run;
        // The lock releases with the run, so the verify pass works afterwards.
        await expect(harness.ingestion.verifyHeld('usdt-blacklist')).resolves.toBeDefined();
    });
});

describe('OfacXmlScanner', () => {
    it('extracts typed TRON addresses from the classic sdnEntry shape with the entity uid as ref', () => {
        const xml = `
            <sdnList><sdnEntry><uid>5535</uid><lastName>EVIL CORP</lastName>
                <akaList><aka><uid>9999</uid></aka></akaList>
                <idList>
                    <id><uid>111</uid><idType>Digital Currency Address - TRX</idType><idNumber>${ADDRESS_A}</idNumber></id>
                    <id><uid>112</uid><idType>Digital Currency Address - XBT</idType><idNumber>1BitcoinAddressIgnored</idNumber></id>
                    <id><uid>113</uid><idType>Digital Currency Address - USDT</idType><idNumber>${ADDRESS_B}</idNumber></id>
                </idList>
            </sdnEntry></sdnList>`;
        const scanner = new OfacXmlScanner();
        scanner.push(xml);
        const assertions = scanner.assertions();
        expect(assertions).toHaveLength(2);
        // The aka uid (9999) sits between the entity uid and the id list, so
        // matching a bare <uid> would mis-cite the alias — the anchor is the
        // <sdnEntry><uid> pair.
        expect(assertions[0]).toMatchObject({
            address: ADDRESS_A,
            tag: 'ofac:sdn',
            ref: '5535',
            url: 'https://sanctionssearch.ofac.treas.gov/Details.aspx?id=5535'
        });
    });

    it('extracts addresses from the advanced Feature shape via the FeatureType table', () => {
        const xml = `
            <ReferenceValueSets><FeatureTypeValues>
                <FeatureType ID="345">Digital Currency Address - TRX</FeatureType>
                <FeatureType ID="271">Digital Currency Address - XBT</FeatureType>
            </FeatureTypeValues></ReferenceValueSets>
            <DistinctParty FixedRef="777"><Profile>
                <Feature ID="1" FeatureTypeID="345"><FeatureVersion><VersionDetail>${ADDRESS_A}</VersionDetail></FeatureVersion></Feature>
                <Feature ID="2" FeatureTypeID="271"><FeatureVersion><VersionDetail>bc1qignored</VersionDetail></FeatureVersion></Feature>
            </Profile></DistinctParty>`;
        const scanner = new OfacXmlScanner();
        scanner.push(xml);
        const assertions = scanner.assertions();
        expect(assertions).toHaveLength(1);
        expect(assertions[0]).toMatchObject({ address: ADDRESS_A, tag: 'ofac:sdn', ref: '777' });
    });

    it('reads the FeatureType id from the real tag, which also carries FeatureTypeGroupID', () => {
        // Treasury writes `<FeatureType ID="992" FeatureTypeGroupID="1">`. An
        // attribute scan that runs past the type id and settles on the trailing
        // group id learns the wrong number, no Feature ever matches a known TRON
        // type, and the run finishes with zero assertions while still looking
        // structurally sound. The earlier fixture omitted the second attribute,
        // so it could not see that.
        const xml = `
            <Sanctions><ReferenceValueSets><FeatureTypeValues>
                <FeatureType ID="992" FeatureTypeGroupID="1">Digital Currency Address - TRX</FeatureType>
                <FeatureType ID="887" FeatureTypeGroupID="1">Digital Currency Address - USDT</FeatureType>
            </FeatureTypeValues></ReferenceValueSets>
            <DistinctParty FixedRef="4632"><Profile>
                <Feature ID="1" FeatureTypeID="992"><FeatureVersion><VersionDetail DetailTypeID="1432">${ADDRESS_A}</VersionDetail></FeatureVersion></Feature>
                <Feature ID="2" FeatureTypeID="887"><FeatureVersion><VersionDetail DetailTypeID="1432">${ADDRESS_B}</VersionDetail></FeatureVersion></Feature>
            </Profile></DistinctParty></Sanctions>`;
        const scanner = new OfacXmlScanner();
        scanner.push(xml);
        expect(scanner.assertions().map((assertion) => assertion.address)).toEqual([ADDRESS_A, ADDRESS_B]);
    });

    it('still finds a TRON address in the Feature block that follows a non-TRON one', () => {
        // The blocks sit back to back in the export. Attributing an address by
        // one regex spanning from a Feature open tag to a VersionDetail lets the
        // XBT block reach across its own close tag, consume the TRX block's
        // address, and be discarded on the type check — so the TRX address is
        // never offered again and disappears without any error.
        const xml = `
            <Sanctions><ReferenceValueSets><FeatureTypeValues>
                <FeatureType ID="992" FeatureTypeGroupID="1">Digital Currency Address - TRX</FeatureType>
            </FeatureTypeValues></ReferenceValueSets>
            <DistinctParty FixedRef="4632"><Profile>
                <Feature ID="1" FeatureTypeID="344"><FeatureVersion><VersionDetail>1BitcoinAddressIgnored</VersionDetail></FeatureVersion></Feature>
                <Feature ID="2" FeatureTypeID="992"><FeatureVersion><VersionDetail>${ADDRESS_A}</VersionDetail></FeatureVersion></Feature>
            </Profile></DistinctParty></Sanctions>`;
        const scanner = new OfacXmlScanner();
        scanner.push(xml);
        expect(scanner.assertions()).toHaveLength(1);
        expect(scanner.assertions()[0]).toMatchObject({ address: ADDRESS_A, ref: '4632' });
    });

    it('ignores a TRON-shaped VersionDetail that belongs to no Feature type it recognises', () => {
        // Closing a Feature clears the open type, so text sitting between blocks
        // cannot inherit the previous block's classification and be asserted as
        // a sanctioned address on a citation that does not describe it.
        const xml = `
            <Sanctions><ReferenceValueSets><FeatureTypeValues>
                <FeatureType ID="992" FeatureTypeGroupID="1">Digital Currency Address - TRX</FeatureType>
            </FeatureTypeValues></ReferenceValueSets>
            <DistinctParty FixedRef="4632"><Profile>
                <Feature ID="1" FeatureTypeID="992"><FeatureVersion><VersionDetail>${ADDRESS_A}</VersionDetail></FeatureVersion></Feature>
                <Comment><VersionDetail>${ADDRESS_B}</VersionDetail></Comment>
            </Profile></DistinctParty></Sanctions>`;
        const scanner = new OfacXmlScanner();
        scanner.push(xml);
        expect(scanner.assertions().map((assertion) => assertion.address)).toEqual([ADDRESS_A]);
    });

    it('completes a match split across chunk boundaries without duplicating tail re-scans', () => {
        const xml = `<sdnEntry><uid>42</uid><idList><id><idType>Digital Currency Address - TRX</idType><idNumber>${ADDRESS_A}</idNumber></id></idList></sdnEntry>`;
        const scanner = new OfacXmlScanner();
        // Split mid-address so no single chunk contains a full match.
        const cut = xml.indexOf(ADDRESS_A) + 10;
        scanner.push(xml.slice(0, cut));
        scanner.push(xml.slice(cut));
        // Push more content so the retained tail (still holding the match) is
        // re-scanned — the address must not be emitted twice.
        scanner.push('<sdnEntry><uid>43</uid></sdnEntry>');
        const assertions = scanner.assertions();
        expect(assertions).toHaveLength(1);
        expect(assertions[0]).toMatchObject({ address: ADDRESS_A, ref: '42' });
    });
});

describe('OfacSdnSource', () => {
    it('streams the export through the scanner', async () => {
        const xml = `<sdnEntry><uid>7</uid><idList><id><idType>Digital Currency Address - USDT</idType><idNumber>${ADDRESS_B}</idNumber></id></idList></sdnEntry>`;
        const bytes = new TextEncoder().encode(xml);
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            body: (async function* () {
                // Two chunks to exercise the streaming path.
                yield bytes.slice(0, 40);
                yield bytes.slice(40);
            })()
        })) as unknown as typeof fetch;
        const source = new OfacSdnSource(fetchImpl);
        const result = await source.fetch();
        expect(result.assertions).toEqual([
            expect.objectContaining({ address: ADDRESS_B, tag: 'ofac:sdn', ref: '7' })
        ]);
    });

    it('throws on a non-OK response so the run records an error instead of reconciling nothing', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, body: null })) as unknown as typeof fetch;
        await expect(new OfacSdnSource(fetchImpl).fetch()).rejects.toThrow(/HTTP 503/);
    });

    it('throws on an HTTP 200 body with no entity records so a maintenance page never reconciles as an empty snapshot', async () => {
        const bytes = new TextEncoder().encode('<html><body>Scheduled maintenance</body></html>');
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            body: (async function* () {
                yield bytes;
            })()
        })) as unknown as typeof fetch;
        await expect(new OfacSdnSource(fetchImpl).fetch()).rejects.toThrow(/complete SDN document/);
    });

    it('throws when a recognised root element opens but never closes, so a truncated export is refused', async () => {
        const xml = `<sdnList><sdnEntry><uid>7</uid><idList><id><idType>Digital Currency Address - USDT</idType><idNumber>${ADDRESS_B}</idNumber></id></idList></sdnEntry>`;
        const bytes = new TextEncoder().encode(xml);
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            body: (async function* () {
                yield bytes;
            })()
        })) as unknown as typeof fetch;
        await expect(new OfacSdnSource(fetchImpl).fetch()).rejects.toThrow(/complete SDN document/);
    });

    it('throws when a well-formed export holds no TRON addresses, so a parse break cannot pass as a clean run', async () => {
        // The list has carried hundreds of TRON addresses for years, so an empty
        // TRON slice means the address markup moved rather than that everything
        // was delisted. `syncSource`'s floor would catch this against existing
        // holdings, but on a first run there is nothing to compare against and
        // the empty result would be stored as a successful sync.
        const xml = '<Sanctions><DistinctParty FixedRef="4632"><Profile /></DistinctParty></Sanctions>';
        const bytes = new TextEncoder().encode(xml);
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            body: (async function* () {
                yield bytes;
            })()
        })) as unknown as typeof fetch;
        await expect(new OfacSdnSource(fetchImpl).fetch()).rejects.toThrow(/held no TRON addresses/);
    });
});

describe('UsdtBlacklistSource', () => {
    /**
     * Build a fake transport returning canned event pages per event name.
     *
     * @param added - AddedBlackList rows to serve.
     * @param removed - RemovedBlackList rows to serve.
     * @returns The fake transport and its call log.
     */
    function fakeTransport(added: any[], removed: any[]) {
        const calls: Array<Record<string, string | number | boolean>> = [];
        const transport: IUsdtBlacklistTransport = {
            getContractEvents: vi.fn(async (_contract: string, params: Record<string, string | number | boolean>) => {
                calls.push(params);
                return { data: params.event_name === 'AddedBlackList' ? added : removed, meta: {} };
            }) as IUsdtBlacklistTransport['getContractEvents'],
            triggerConstantContract: vi.fn(async () => ({ result: { result: true }, constant_result: ['0'.repeat(64)] })) as IUsdtBlacklistTransport['triggerConstantContract']
        };
        return { transport, calls };
    }

    it('maps additions to assertions and removals to withdrawals, advancing the cursor', async () => {
        const { transport } = fakeTransport(
            [{ block_timestamp: 1000, transaction_id: 'tx-add', event_name: 'AddedBlackList', result: { _user: ADDRESS_A_HEX } }],
            []
        );
        const source = new UsdtBlacklistSource(transport);
        const result = await source.fetch();
        expect(result.assertions).toEqual([
            expect.objectContaining({ address: ADDRESS_A, tag: 'usdt:frozen', ref: 'tx-add' })
        ]);
        expect(result.withdrawn).toEqual([]);
        expect(result.cursor).toBe('1000');
    });

    it('lets the chronologically last event decide when the overlap replays both', async () => {
        // Removed at 1000, re-added at 2000: the final state is frozen even
        // though the removal arrives in a separate stream.
        const { transport } = fakeTransport(
            [{ block_timestamp: 2000, transaction_id: 'tx-re-add', result: { _user: ADDRESS_A_HEX } }],
            [{ block_timestamp: 1000, transaction_id: 'tx-remove', result: { _user: ADDRESS_A_HEX } }]
        );
        const result = await new UsdtBlacklistSource(transport).fetch();
        expect(result.assertions).toHaveLength(1);
        expect(result.withdrawn).toHaveLength(0);
        expect(result.cursor).toBe('2000');
    });

    it('holds the cursor back to a capped stream so unread events are not skipped', async () => {
        // AddedBlackList keeps returning a continuation fingerprint until the
        // page cap cuts it off at timestamp 1024, while RemovedBlackList
        // drains fully to 99999. Advancing the cursor to 99999 would skip the
        // unread adds forever — and a skipped add is unrepairable, because
        // the verify pass only re-checks addresses already held.
        let addedPage = 0;
        const transport: IUsdtBlacklistTransport = {
            getContractEvents: vi.fn(async (_contract: string, params: Record<string, string | number | boolean>) => {
                if (params.event_name === 'AddedBlackList') {
                    addedPage += 1;
                    return {
                        data: [{ block_timestamp: 999 + addedPage, result: { _user: ADDRESS_A_HEX } }],
                        meta: { fingerprint: `page-${addedPage}` }
                    };
                }
                return { data: [{ block_timestamp: 99999, result: { _user: ADDRESS_A_HEX } }], meta: {} };
            }) as IUsdtBlacklistTransport['getContractEvents'],
            triggerConstantContract: vi.fn() as IUsdtBlacklistTransport['triggerConstantContract']
        };
        const result = await new UsdtBlacklistSource(transport).fetch();
        expect(addedPage).toBe(25);
        expect(result.cursor).toBe('1024');
    });

    it('keeps the old cursor on a quiet window and overlaps one block on resume', async () => {
        const { transport, calls } = fakeTransport([], []);
        const source = new UsdtBlacklistSource(transport);
        const result = await source.fetch('50000');
        expect(result.cursor).toBe('50000');
        expect(calls.every((params) => params.min_block_timestamp === 47000)).toBe(true);
    });

    it('verify refreshes confirmed freezes, withdraws denials, and skips failed calls', async () => {
        const answers = new Map<string, string | Error>([
            // ADDRESS_A confirmed frozen, ADDRESS_B denied.
            [ADDRESS_A, `${'0'.repeat(63)}1`],
            [ADDRESS_B, '0'.repeat(64)]
        ]);
        const transport: IUsdtBlacklistTransport = {
            getContractEvents: vi.fn() as IUsdtBlacklistTransport['getContractEvents'],
            triggerConstantContract: vi.fn(async (payload: Record<string, unknown>) => {
                // Resolve the queried address by re-encoding each candidate the
                // way the source does, so the test also pins the ABI encoding.
                const parameter = String(payload.parameter);
                const { toHexAddress } = await import('../../../lib/tron-address.js');
                for (const [address, answer] of answers) {
                    const encoded = toHexAddress(address).slice(2).toLowerCase().padStart(64, '0');
                    if (encoded === parameter) {
                        if (answer instanceof Error) throw answer;
                        return { result: { result: true }, constant_result: [answer] };
                    }
                }
                throw new Error('unexpected parameter');
            }) as IUsdtBlacklistTransport['triggerConstantContract']
        };
        const source = new UsdtBlacklistSource(transport);
        const result = await source.verify([ADDRESS_A, ADDRESS_B]);
        expect(result.assertions).toEqual([expect.objectContaining({ address: ADDRESS_A })]);
        expect(result.withdrawn).toEqual([expect.objectContaining({ address: ADDRESS_B })]);
    });

    it('verify draws no conclusion from a failed contract call', async () => {
        const transport: IUsdtBlacklistTransport = {
            getContractEvents: vi.fn() as IUsdtBlacklistTransport['getContractEvents'],
            triggerConstantContract: vi.fn(async () => { throw new Error('node down'); }) as IUsdtBlacklistTransport['triggerConstantContract']
        };
        const result = await new UsdtBlacklistSource(transport).verify([ADDRESS_A]);
        // A transport error is not evidence of delisting: nothing withdrawn.
        expect(result.assertions).toEqual([]);
        expect(result.withdrawn).toEqual([]);
    });
});

describe('ChainalysisSource', () => {
    it('asserts on a sanctions identification and withdraws on a clean answer', async () => {
        const responses = [
            { identifications: [{ category: 'sanctions', name: 'SANCTIONED ENTITY', url: 'https://ofac.example/1' }] },
            { identifications: [] }
        ];
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => responses.shift()
        })) as unknown as typeof fetch;
        const source = new ChainalysisSource(async () => 'key-123', fetchImpl);

        const hit = await source.screen(ADDRESS_A);
        expect(hit.assertions).toEqual([
            expect.objectContaining({ address: ADDRESS_A, tag: 'chainalysis:sanctioned', ref: 'SANCTIONED ENTITY' })
        ]);
        const clean = await source.screen(ADDRESS_A);
        expect(clean.assertions).toEqual([]);
        expect(clean.withdrawn).toEqual([expect.objectContaining({ address: ADDRESS_A, tag: 'chainalysis:sanctioned' })]);
    });

    it('sends the configured key as X-API-Key and refuses to run without one', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ identifications: [] }) })) as any;
        await new ChainalysisSource(async () => 'key-abc', fetchImpl).screen(ADDRESS_A);
        expect(fetchImpl).toHaveBeenCalledWith(
            expect.stringContaining(ADDRESS_A),
            expect.objectContaining({ headers: expect.objectContaining({ 'X-API-Key': 'key-abc' }) })
        );
        await expect(new ChainalysisSource(async () => null, fetchImpl).screen(ADDRESS_A))
            .rejects.toThrow(/No Chainalysis API key/);
    });

    it('fetch() throws by contract — lookups run per address', async () => {
        await expect(new ChainalysisSource(async () => 'k').fetch()).rejects.toThrow(/per-address lookup/);
    });
});
