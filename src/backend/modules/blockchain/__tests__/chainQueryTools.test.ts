/**
 * Unit tests for the chain query AI tools, run against a fake ClickHouse reader.
 *
 * The tools are the boundary between a model and the chain data, so these
 * tests pin what the model is promised: arguments reach ClickHouse only as
 * query parameters, each read is charged to the calling run's quota key,
 * amounts arrive converted and priced, limit errors come back as instructions
 * rather than failures, and the trace search respects time order and keeps
 * its partial graph when a hop is stopped.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IAddressTagService, IClickHouseReader, IPriceHistoryService, IToolHandlerContext } from '@/types';
import { formatClickHouseDateTime64Utc } from '../../../lib/formatClickHouseDateTime64Utc.js';
import { AddressTagLookup } from '../chain-query/AddressTagLookup.js';
import { ChainCoverageReader, summarizeCoverage, type ICoverageRow } from '../chain-query/ChainCoverageReader.js';
import type { IChainWindow } from '../chain-query/chainQueryInput.js';
import { ChainQuerySession } from '../chain-query/ChainQuerySession.js';
import type { IChainQueryToolkit } from '../chain-query/ChainQueryToolkit.js';
import { buildChainQueryTools } from '../chain-query/registerChainQueryAiTools.js';
import { TokenCatalog } from '../chain-query/TokenCatalog.js';
import { UsdPricer } from '../chain-query/UsdPricer.js';
import { buildAddressCounterpartiesTool } from '../chain-query/tools/buildAddressCounterpartiesTool.js';
import { buildAddressTransfersTool } from '../chain-query/tools/buildAddressTransfersTool.js';
import { buildTraceFlowTool } from '../chain-query/tools/buildTraceFlowTool.js';
import { AI_TOOL_NAMES } from '../chain-query/tools/chainQueryToolShared.js';

/** Real, checksum-valid addresses, so the tools' own validation accepts them. */
const WALLET = 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ';
const PEER = 'TAUN6FwrnwwmaEqYcckffC7wYmbaS6cBiX';
const OTHER = 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** A fixed "now", so every window is predictable. */
const NOW = new Date(Date.UTC(2026, 8, 24, 12, 0, 0));

/** The run identity the governor would pass. */
const CONTEXT: IToolHandlerContext = { triggerPath: 'interactive', queryId: 'run-1' };

/** Answers one `tron._transfer` query. */
type TransferHandler = (sql: string, params: Record<string, unknown>) => unknown[] | Promise<unknown[]>;

/** One read the fake reader received. */
interface IRecordedRead {
    sql: string;
    params: Record<string, unknown>;
    quotaKey?: string;
}

/**
 * Build a toolkit whose ClickHouse reader is a fake.
 *
 * Coverage and token metadata queries get fixed answers describing a complete
 * window and a resolved USDT; every `tron._transfer` query goes to the test's
 * handler. Tags mark PEER as sanctioned, and prices give USDT a $1 close on
 * the day before NOW.
 *
 * @param onTransfers - The test's answer to transfer queries.
 * @returns The toolkit and the list of reads it recorded.
 */
function buildToolkit(onTransfers: TransferHandler): { toolkit: IChainQueryToolkit; reads: IRecordedRead[] } {
    const reads: IRecordedRead[] = [];
    const reader: IClickHouseReader = {
        accountId: 'ai-agent',
        query: async <T>(sql: string, params?: Record<string, unknown>, options?: { quotaKey?: string }) => {
            reads.push({ sql, params: params ?? {}, quotaKey: options?.quotaKey });
            let rows: unknown[];
            if (sql.includes('tron.block FINAL')) {
                rows = [{
                    first_block: '1000',
                    last_block: '29799',
                    present: '28800',
                    without_receipts: '0',
                    first_at: formatClickHouseDateTime64Utc(new Date(params?.from ? Date.parse(`${String(params.from).replace(' ', 'T')}Z`) : 0)),
                    last_at: formatClickHouseDateTime64Utc(NOW)
                }];
            } else if (sql.includes('tron._token')) {
                rows = [{ token: USDT, status: 'resolved', decimals: '6', symbol: 'USDT', name: 'Tether USD' }];
            } else {
                rows = await onTransfers(sql, params ?? {});
            }
            return { rows: rows as T[], queryId: `q-${reads.length}`, readRows: 10, readBytes: 100, elapsedMs: 1 };
        }
    };
    const tagService = {
        getTagsByAddresses: vi.fn(async (addresses: string[]) => addresses.includes(PEER) ? [{ address: PEER, tag: 'ofac:sdn', active: true }] : [])
    } as unknown as IAddressTagService;
    const priceService = {
        getPricesForDays: vi.fn(async (asset: string) => asset === USDT ? [{ asset, day: '2026-09-23', priceUsd: 1 }] : [])
    } as unknown as IPriceHistoryService;
    const toolkit: IChainQueryToolkit = {
        openSession: (context) => new ChainQuerySession(reader, context),
        coverage: new ChainCoverageReader(() => NOW.getTime()),
        tokens: new TokenCatalog(),
        tags: new AddressTagLookup(() => tagService),
        prices: new UsdPricer(() => priceService),
        retentionDays: 7,
        now: () => NOW
    };
    return { toolkit, reads };
}

/**
 * A `tron._transfer` row as the transfers query returns it.
 *
 * @param overrides - Fields that differ from a 1.5 USDT transfer out to PEER.
 * @returns The row.
 */
function transferRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        block_number: '29000',
        block_timestamp: '2026-09-24 11:00:00.000',
        tx_id: 'aa'.repeat(32),
        source: 'log',
        event_index: 0,
        direction: 'out',
        counterparty: PEER,
        asset_type: 'trc20',
        token: USDT,
        amount_text: '1500000',
        ...overrides
    };
}

describe('chain query tools', () => {
    it('registers every tool under its owner-prefixed name, classified as a read of untrusted content', () => {
        const { toolkit } = buildToolkit(() => []);
        const tools = buildChainQueryTools(toolkit);

        expect(tools.map(tool => tool.name).sort()).toEqual(Object.values(AI_TOOL_NAMES).sort());
        for (const tool of tools) {
            expect(tool.capability).toEqual(expect.objectContaining({ sideEffect: 'read', surfacesUntrustedContent: true }));
        }
    });
});

describe(AI_TOOL_NAMES.addressTransfers, () => {
    it('charges reads to the run, converts and prices amounts, and attaches tags', async () => {
        const { toolkit, reads } = buildToolkit(() => [transferRow()]);
        const tool = buildAddressTransfersTool(toolkit);

        const result = await tool.handler({ address: WALLET, token: USDT }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result.success).toBe(true);
        const transferRead = reads.find(read => read.sql.includes('tron._transfer'));
        expect(transferRead?.params).toEqual(expect.objectContaining({ address: WALLET, assetType: 'trc20', token: USDT }));
        // The model's values reach ClickHouse only as parameters.
        expect(transferRead?.sql).not.toContain(WALLET);
        expect(reads.every(read => read.quotaKey === 'run-1')).toBe(true);
        expect(result.transfers).toEqual([expect.objectContaining({
            time: '2026-09-24T11:00:00.000Z',
            counterparty: PEER,
            token: USDT,
            amount: { raw: '1500000', value: '1.5' },
            // Today has no close yet, so yesterday's is used and named.
            usd: { usd: 1.5, priceDay: '2026-09-23' }
        })]);
        expect(result.addressTags).toEqual({ [PEER]: ['ofac:sdn'] });
        expect(result.tokens).toEqual({ [USDT]: expect.objectContaining({ decimals: 6, status: 'resolved' }) });
        expect(result.cost).toEqual(expect.objectContaining({ queries: reads.length }));
    });

    it('reports truncation with a cursor that continues after the last row', async () => {
        const { toolkit, reads } = buildToolkit(() => [transferRow(), transferRow({ tx_id: 'bb'.repeat(32) })]);
        const tool = buildAddressTransfersTool(toolkit);

        const first = await tool.handler({ address: WALLET, limit: 1 }, undefined, CONTEXT) as Record<string, unknown>;
        expect(first.truncated).toBe(true);
        expect(first.returned).toBe(1);

        await tool.handler({ address: WALLET, limit: 1, cursor: first.nextCursor }, undefined, CONTEXT);
        const secondRead = reads.filter(read => read.sql.includes('tron._transfer')).pop();
        expect(secondRead?.params).toEqual(expect.objectContaining({ cTx: 'aa'.repeat(32), cTime: '2026-09-24 11:00:00.000' }));
    });

    it('answers a bad argument with an input error and runs no query', async () => {
        const { toolkit, reads } = buildToolkit(() => []);
        const tool = buildAddressTransfersTool(toolkit);

        const badAddress = await tool.handler({ address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u' }, undefined, CONTEXT) as Record<string, unknown>;
        const minWithoutToken = await tool.handler({ address: WALLET, minAmount: '10' }, undefined, CONTEXT) as Record<string, unknown>;

        expect(badAddress).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
        expect(minWithoutToken).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
        expect(reads).toHaveLength(0);
    });

    it('turns a ClickHouse limit error into advice the model can act on', async () => {
        const { toolkit } = buildToolkit(() => {
            throw Object.assign(new Error('Limit for rows to read exceeded'), { code: '158' });
        });
        const tool = buildAddressTransfersTool(toolkit);

        const result = await tool.handler({ address: WALLET }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ success: false, errorKind: 'limit' }));
        expect(String(result.error)).toContain('TOO_MANY_ROWS');
        expect(String(result.error)).toContain('shorten the window');
        expect(result.cost).toEqual(expect.objectContaining({ queries: 1 }));
    });
});

describe(AI_TOOL_NAMES.addressCounterparties, () => {
    it('flags a counterparty that shares its first and last characters with another', async () => {
        const lookalike = 'TAUN6FwrnwwmaEqYcckffC7wYmbaS6cBiX'.slice(0, 4) + 'xxxxxxxxxxxxxxxxxxxxxxxxxx' + 'cBiX';
        const { toolkit } = buildToolkit(() => [{
            counterparty: PEER,
            direction: 'out',
            asset_type: 'trc20',
            token: USDT,
            transfers: '3',
            transactions: '3',
            total: '3000000',
            first_at: '2026-09-24 01:00:00.000',
            last_at: '2026-09-24 11:00:00.000',
            total_groups: '1',
            lookalike_group: [PEER, lookalike]
        }]);
        const tool = buildAddressCounterpartiesTool(toolkit);

        const result = await tool.handler({ address: WALLET }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result.counterparties).toEqual([expect.objectContaining({
            counterparty: PEER,
            total: { raw: '3000000', value: '3' },
            resemblesCounterparties: [lookalike]
        })]);
        expect((result.notes as string[]).some(note => note.includes('address poisoning'))).toBe(true);
    });

    it('refuses to sort by amount across tokens', async () => {
        const { toolkit } = buildToolkit(() => []);
        const result = await buildAddressCounterpartiesTool(toolkit).handler({ address: WALLET, sortBy: 'amount' }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
    });
});

describe(AI_TOOL_NAMES.traceFlow, () => {
    /**
     * An edge row as the hop query returns it.
     *
     * @param address - The frontier address the edge leaves.
     * @param counterparty - Where it goes.
     * @param firstAt - When funds first moved along it.
     * @returns The row.
     */
    function edgeRow(address: string, counterparty: string, firstAt: string): Record<string, unknown> {
        return {
            address,
            counterparty,
            transfers: '1',
            total: '2000000',
            first_at: firstAt,
            last_at: firstAt,
            branches_available: '1'
        };
    }

    it('expands hop by hop, carrying each address\'s arrival time forward', async () => {
        const hopParams: Record<string, unknown>[] = [];
        const { toolkit } = buildToolkit((_sql, params) => {
            hopParams.push(params);
            return hopParams.length === 1
                ? [edgeRow(WALLET, PEER, '2026-09-24 02:00:00.000')]
                : [edgeRow(PEER, OTHER, '2026-09-24 05:00:00.000')];
        });

        const result = await buildTraceFlowTool(toolkit).handler({ address: WALLET, token: USDT }, undefined, CONTEXT) as Record<string, unknown>;

        expect(hopParams[1]).toEqual(expect.objectContaining({
            frontier: [PEER],
            // PEER's outgoing transfers count only from when funds reached it.
            bounds: ['2026-09-24 02:00:00.000'],
            visited: [WALLET, PEER],
            direction: 'out'
        }));
        expect(result.hopsCompleted).toBe(2);
        expect(result.edges).toEqual([
            expect.objectContaining({ from: WALLET, to: PEER, hop: 1, amount: { raw: '2000000', value: '2' } }),
            expect.objectContaining({ from: PEER, to: OTHER, hop: 2 })
        ]);
        expect(result.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ address: WALLET, expanded: true }),
            expect.objectContaining({ address: OTHER, expanded: false, notExpandedBecause: 'hop limit reached' })
        ]));
    });

    it('keeps the graph built so far when a later hop hits a limit', async () => {
        let hop = 0;
        const { toolkit } = buildToolkit(() => {
            hop += 1;
            if (hop === 2) {
                throw Object.assign(new Error('timeout'), { code: '159' });
            }
            return [edgeRow(WALLET, PEER, '2026-09-24 02:00:00.000')];
        });

        const result = await buildTraceFlowTool(toolkit).handler({ address: WALLET, token: USDT, hops: 3 }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result.success).toBe(true);
        expect(result.hopsCompleted).toBe(1);
        expect(String(result.stoppedReason)).toContain('Hop 2 was not completed');
        expect(result.edges).toHaveLength(1);
        expect(result.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ address: PEER, expanded: false, notExpandedBecause: 'trace stopped early' })
        ]));
    });
});

describe('summarizeCoverage', () => {
    /**
     * Build a coverage row whose stored data stops short of the window's end,
     * which is the shape a missing tail of blocks produces: the block counts
     * agree, and only the newest stored time shows anything is absent.
     *
     * @param window - The window being summarized, whose start the row echoes.
     * @param shortByMs - How far before the window's end the newest stored block sits.
     * @returns The row the coverage query would return for that window.
     */
    function rowEndingShort(window: IChainWindow, shortByMs: number): ICoverageRow {
        return {
            first_block: '1000',
            last_block: '1199',
            present: '200',
            without_receipts: '0',
            first_at: formatClickHouseDateTime64Utc(window.from),
            last_at: formatClickHouseDateTime64Utc(new Date(window.to.getTime() - shortByMs))
        };
    }

    it('allows the emit buffer lead at the live head but not in a settled window', () => {
        const live: IChainWindow = { from: new Date(NOW.getTime() - 3_600_000), to: NOW, clampedToRetention: false };
        const historical: IChainWindow = {
            from: new Date(NOW.getTime() - 7_200_000),
            to: new Date(NOW.getTime() - 3_600_000),
            clampedToRetention: false
        };

        expect(summarizeCoverage(rowEndingShort(live, 120_000), live, NOW.getTime()).complete).toBe(true);
        expect(summarizeCoverage(rowEndingShort(historical, 120_000), historical, NOW.getTime()).complete).toBe(false);
    });
});
