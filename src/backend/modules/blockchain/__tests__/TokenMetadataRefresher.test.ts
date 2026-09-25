/**
 * Unit tests for resolving TRC-20 token metadata into `tron._token`.
 *
 * The refresher spends calls on the TronGrid queue that block sync shares, so
 * the tests pin the two things that keep that cost bounded: the limits reach
 * the candidate query, and a token that answers no `decimals()` is still
 * recorded, so it is not looked up again on every run.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IClickHouseService, ITrc20TokenInfo } from '@/types';
import { TokenMetadataRefresher, type ITrc20TokenInfoReader } from '../chain-data/TokenMetadataRefresher.js';

/** The USDT contract in base58. */
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** A contract that answers no `decimals()`, standing in for a spam token. */
const SPAM = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';

/** A fixed clock, so every stamped time is predictable. */
const NOW = new Date(Date.UTC(2026, 8, 24, 3, 17, 0, 0));

/**
 * Build a ClickHouse fake whose candidate query answers the given tokens.
 *
 * @param tokens - The token addresses the candidate query returns, busiest first.
 * @returns The fake, with spies on `query` and `insert` for assertions.
 */
function buildClickHouse(tokens: string[]): { clickhouse: IClickHouseService; query: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> } {
    const query = vi.fn().mockResolvedValue(tokens.map(token => ({ token, transfers: '100' })));
    const insert = vi.fn().mockResolvedValue(undefined);
    return { clickhouse: { query, insert } as unknown as IClickHouseService, query, insert };
}

/**
 * Build a token reader that knows only USDT.
 *
 * @returns The reader, with a spy on `getTrc20TokenInfo`.
 */
function buildReader(): ITrc20TokenInfoReader & { getTrc20TokenInfo: ReturnType<typeof vi.fn> } {
    const usdt: ITrc20TokenInfo = { contractAddress: USDT, symbol: 'USDT', name: 'Tether USD', decimals: 6 };
    return {
        getTrc20TokenInfo: vi.fn(async (address: string) => (address === USDT ? usdt : null))
    };
}

describe('TokenMetadataRefresher', () => {
    it('passes its limits to the candidate query', async () => {
        const { clickhouse, query } = buildClickHouse([]);
        const refresher = new TokenMetadataRefresher(clickhouse, buildReader(), {
            provider: 'trongrid',
            minTransfers: 5,
            windowHours: 12,
            maxLookups: 3,
            retryUnreadableHours: 6
        });

        await refresher.refresh();

        expect(query).toHaveBeenCalledWith(expect.stringContaining('tron._transfer'), {
            windowHours: 12,
            retryHours: 6,
            minTransfers: 5,
            maxLookups: 3
        });
    });

    it('records resolved tokens with their metadata and unreadable ones so they are not retried every run', async () => {
        const { clickhouse, insert } = buildClickHouse([USDT, SPAM]);
        const refresher = new TokenMetadataRefresher(clickhouse, buildReader(), { provider: 'trongrid', now: () => NOW });

        const result = await refresher.refresh();

        expect(result).toEqual({ candidates: 2, resolved: 1, unreadable: 1 });
        expect(insert).toHaveBeenCalledTimes(1);
        expect(insert).toHaveBeenCalledWith('tron._token', [
            expect.objectContaining({ asset_type: 'trc20', token: USDT, status: 'resolved', decimals: 6, symbol: 'USDT', name: 'Tether USD', checked_at: '2026-09-24 03:17:00.000', _provider: 'trongrid' }),
            expect.objectContaining({ asset_type: 'trc20', token: SPAM, status: 'unreadable', decimals: 0, symbol: '', name: '' })
        ], { synchronous: true });
    });

    it('cuts a contract-chosen symbol or name down to a bounded length', async () => {
        const { clickhouse, insert } = buildClickHouse([USDT]);
        const reader: ITrc20TokenInfoReader = {
            getTrc20TokenInfo: async () => ({ contractAddress: USDT, symbol: 'S'.repeat(500), name: 'N'.repeat(500), decimals: 6 })
        };

        await new TokenMetadataRefresher(clickhouse, reader, { provider: 'trongrid' }).refresh();

        const [row] = insert.mock.calls[0][1] as Array<{ symbol: string; name: string }>;
        expect(row.symbol).toHaveLength(128);
        expect(row.name).toHaveLength(128);
    });

    it('makes no lookups and no insert when no token qualifies', async () => {
        const { clickhouse, insert } = buildClickHouse([]);
        const reader = buildReader();

        const result = await new TokenMetadataRefresher(clickhouse, reader, { provider: 'trongrid' }).refresh();

        expect(result).toEqual({ candidates: 0, resolved: 0, unreadable: 0 });
        expect(reader.getTrc20TokenInfo).not.toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
    });

    it('lets a ClickHouse failure reach the scheduler', async () => {
        const { clickhouse, query } = buildClickHouse([]);
        query.mockRejectedValueOnce(new Error('ClickHouse unreachable'));

        await expect(new TokenMetadataRefresher(clickhouse, buildReader(), { provider: 'trongrid' }).refresh())
            .rejects.toThrow('ClickHouse unreachable');
    });
});
