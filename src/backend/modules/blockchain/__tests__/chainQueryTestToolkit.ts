/**
 * @fileoverview A chain query toolkit backed by a fake ClickHouse reader, shared by the chain query tool tests.
 *
 * Every chain query tool reads coverage from `tron.block` and token metadata
 * from `tron._token` besides its own tables. Giving those two fixed answers in
 * one place lets each test describe only the query it is about, and keeps the
 * test files from each carrying their own copy of the fake.
 *
 * @module backend/modules/blockchain/__tests__/chainQueryTestToolkit
 */

import { vi } from 'vitest';
import type { IAddressTagService, IClickHouseReader, IPriceHistoryService, IToolHandlerContext } from '@/types';
import { formatClickHouseDateTime64Utc } from '../../../lib/formatClickHouseDateTime64Utc.js';
import { AddressTagLookup } from '../chain-query/AddressTagLookup.js';
import { ChainCoverageReader } from '../chain-query/ChainCoverageReader.js';
import { ChainQuerySession } from '../chain-query/ChainQuerySession.js';
import type { IChainQueryToolkit } from '../chain-query/ChainQueryToolkit.js';
import { TokenCatalog } from '../chain-query/TokenCatalog.js';
import { UsdPricer } from '../chain-query/UsdPricer.js';

/** Real, checksum-valid addresses, so the tools' own validation accepts them. */
export const WALLET = 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ';
export const PEER = 'TAUN6FwrnwwmaEqYcckffC7wYmbaS6cBiX';
export const OTHER = 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G';
export const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** A fixed "now", so every window is predictable. */
export const NOW = new Date(Date.UTC(2026, 8, 24, 12, 0, 0));

/** The run identity the governor would pass. */
export const CONTEXT: IToolHandlerContext = { triggerPath: 'interactive', queryId: 'run-1' };

/** Answers one query that is not a coverage or token metadata lookup. */
export type QueryHandler = (sql: string, params: Record<string, unknown>) => unknown[] | Promise<unknown[]>;

/** One read the fake reader received. */
export interface IRecordedRead {
    sql: string;
    params: Record<string, unknown>;
    quotaKey?: string;
}

/**
 * Build a toolkit whose ClickHouse reader is a fake.
 *
 * Coverage queries get a complete window and token metadata queries a resolved
 * USDT; every other query goes to the test's handler. Tags mark PEER as
 * sanctioned and USDT's contract as the verified `token:usdt`, and prices give
 * USDT a $1 close on the day before NOW.
 *
 * @param onQuery - The test's answer to its own queries.
 * @returns The toolkit and the list of reads it recorded.
 */
export function buildToolkit(onQuery: QueryHandler): { toolkit: IChainQueryToolkit; reads: IRecordedRead[] } {
    const reads: IRecordedRead[] = [];
    const reader: IClickHouseReader = {
        accountId: 'ai-agent',
        query: async <T>(sql: string, params?: Record<string, unknown>, options?: { quotaKey?: string }) => {
            reads.push({ sql, params: params ?? {}, quotaKey: options?.quotaKey });
            let rows: unknown[];
            if (sql.includes('tron.block FINAL') && sql.includes('min(block_number)')) {
                rows = [{
                    first_block: '1000',
                    last_block: '29799',
                    present: '28800',
                    without_receipts: '0',
                    first_at: formatClickHouseDateTime64Utc(new Date(params?.from ? Date.parse(`${String(params.from).replace(' ', 'T')}Z`) : 0)),
                    last_at: formatClickHouseDateTime64Utc(NOW)
                }];
            } else if (sql.includes('tron._token') && sql.includes('token IN {tokens')) {
                rows = [{ token: USDT, status: 'resolved', decimals: '6', symbol: 'USDT', name: 'Tether USD' }];
            } else {
                rows = await onQuery(sql, params ?? {});
            }
            return { rows: rows as T[], queryId: `q-${reads.length}`, readRows: 10, readBytes: 100, elapsedMs: 1 };
        }
    };
    const tagService = {
        getTagsByAddresses: vi.fn(async (addresses: string[]) => [
            ...(addresses.includes(PEER) ? [{ address: PEER, tag: 'ofac:sdn', active: true }] : []),
            ...(addresses.includes(USDT) ? [{ address: USDT, tag: 'token:usdt', active: true }] : [])
        ]),
        getAddressesByTags: vi.fn(async (tags: string[]) => tags.includes('token:usdt') ? [{ address: USDT, tag: 'token:usdt', active: true }] : [])
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
