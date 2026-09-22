/**
 * @fileoverview Unit tests for the CoinGecko and GeckoTerminal price-history
 * adapters.
 *
 * Each adapter is a shape mapper over its vendor client, so the tests spy on
 * the client and lock the mapping: intraday samples and daily candles collapse
 * to one sourced point per UTC day, clipped to the asked range, with the vendor
 * id as `source` and the vendor's handle as `sourceRef`; a token with no usable
 * pool resolves to empty without a candle request; and a reset forgets the
 * chosen pool so it is discovered again. No live HTTP is made.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { ProviderConfigService, CoinGeckoClient, GeckoTerminalClient } from '../../providers/index.js';
import { CoinGeckoPriceHistoryProvider } from '../providers/coingecko-price-history.provider.js';
import { GeckoTerminalPriceHistoryProvider } from '../providers/geckoterminal-price-history.provider.js';

/** Stub logger matching the ISystemLogService shape the adapters touch. */
const stubLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => stubLogger };

const TOKEN = 'TKkeiboTkxXKJpbmVFbv4a8ov5rAfRDMf9';

// Epoch seconds at UTC midnight of 2024-01-01 and 2024-01-02.
const DAY1_SECONDS = 1704067200;
const DAY2_SECONDS = 1704153600;

describe('CoinGeckoPriceHistoryProvider', () => {
    let mockDb: ReturnType<typeof createMockDatabaseService>;

    beforeEach(() => {
        ProviderConfigService.resetInstance();
        CoinGeckoClient.resetInstance();
        mockDb = createMockDatabaseService();
        ProviderConfigService.setDependencies(mockDb, stubLogger as never);
        CoinGeckoClient.setDependencies(stubLogger as never);
    });

    afterEach(() => {
        ProviderConfigService.resetInstance();
        CoinGeckoClient.resetInstance();
        mockDb.clear();
        vi.restoreAllMocks();
    });

    it('supports TRX and tokens alike', () => {
        const provider = new CoinGeckoPriceHistoryProvider(stubLogger as never);
        expect(provider.supportsAsset('TRX')).toBe(true);
        expect(provider.supportsAsset(TOKEN)).toBe(true);
    });

    it('collapses intraday samples to the last price of each UTC day and tags the source', async () => {
        vi.spyOn(CoinGeckoClient.getInstance(), 'getMarketChartRange').mockResolvedValue([
            [DAY1_SECONDS * 1000 + 3_600_000, 0.10],
            [DAY1_SECONDS * 1000 + 7_200_000, 0.11],
            [DAY2_SECONDS * 1000 + 3_600_000, 0.12],
            [DAY2_SECONDS * 1000 + 90_000_000, 0.13] // spills into 2024-01-03, outside the range
        ]);
        const provider = new CoinGeckoPriceHistoryProvider(stubLogger as never);

        const points = await provider.fetchRange(TOKEN, '2024-01-01', '2024-01-02');

        expect(points).toEqual([
            { asset: TOKEN, day: '2024-01-01', priceUsd: 0.11, source: 'coingecko', sourceRef: `tron/contract/${TOKEN}` },
            { asset: TOKEN, day: '2024-01-02', priceUsd: 0.12, source: 'coingecko', sourceRef: `tron/contract/${TOKEN}` }
        ]);
    });

    it('uses the coin id as the handle for TRX', async () => {
        vi.spyOn(CoinGeckoClient.getInstance(), 'getMarketChartRange').mockResolvedValue([[DAY1_SECONDS * 1000, 0.1]]);
        const provider = new CoinGeckoPriceHistoryProvider(stubLogger as never);
        const points = await provider.fetchRange('TRX', '2024-01-01', '2024-01-01');
        expect(points[0].sourceRef).toBe('tron');
    });
});

describe('GeckoTerminalPriceHistoryProvider', () => {
    let mockDb: ReturnType<typeof createMockDatabaseService>;

    beforeEach(() => {
        ProviderConfigService.resetInstance();
        GeckoTerminalClient.resetInstance();
        mockDb = createMockDatabaseService();
        ProviderConfigService.setDependencies(mockDb, stubLogger as never);
        GeckoTerminalClient.setDependencies(stubLogger as never);
    });

    afterEach(() => {
        ProviderConfigService.resetInstance();
        GeckoTerminalClient.resetInstance();
        mockDb.clear();
        vi.restoreAllMocks();
    });

    it('supports tokens but not TRX', () => {
        const provider = new GeckoTerminalPriceHistoryProvider(stubLogger as never);
        expect(provider.supportsAsset('TRX')).toBe(false);
        expect(provider.supportsAsset(TOKEN)).toBe(true);
    });

    it('prices from the selected pool, remembers the pool, and forgets it on reset', async () => {
        const pool = { poolAddress: 'TPOOL', name: 'SUN / WTRX', side: 'base' as const, reserveUsd: 50_000 };
        const selectPool = vi.spyOn(GeckoTerminalClient.getInstance(), 'selectPool').mockResolvedValue(pool);
        vi.spyOn(GeckoTerminalClient.getInstance(), 'getDailyCandles').mockResolvedValue([
            { timestamp: DAY2_SECONDS, close: 0.02 },
            { timestamp: DAY1_SECONDS, close: 0.019 },
            { timestamp: DAY1_SECONDS - 86_400, close: 0.018 } // before the range
        ]);
        const provider = new GeckoTerminalPriceHistoryProvider(stubLogger as never);

        const points = await provider.fetchRange(TOKEN, '2024-01-01', '2024-01-02');
        expect(points).toEqual([
            { asset: TOKEN, day: '2024-01-01', priceUsd: 0.019, source: 'geckoterminal', sourceRef: 'TPOOL' },
            { asset: TOKEN, day: '2024-01-02', priceUsd: 0.02, source: 'geckoterminal', sourceRef: 'TPOOL' }
        ]);

        await provider.fetchRange(TOKEN, '2024-01-01', '2024-01-02');
        expect(selectPool).toHaveBeenCalledTimes(1);

        provider.forgetAsset(TOKEN);
        await provider.fetchRange(TOKEN, '2024-01-01', '2024-01-02');
        expect(selectPool).toHaveBeenCalledTimes(2);
    });

    it('returns empty without reading candles when no pool is usable, and looks the pool up again next time', async () => {
        const selectPool = vi.spyOn(GeckoTerminalClient.getInstance(), 'selectPool').mockResolvedValue(null);
        const candles = vi.spyOn(GeckoTerminalClient.getInstance(), 'getDailyCandles');
        const provider = new GeckoTerminalPriceHistoryProvider(stubLogger as never);

        await expect(provider.fetchRange(TOKEN, '2024-01-01', '2024-01-02')).resolves.toEqual([]);
        expect(candles).not.toHaveBeenCalled();

        // A missing pool is not remembered: a pool that appears later, or a
        // lowered reserve floor, is seen on the next fetch without a restart.
        await provider.fetchRange(TOKEN, '2024-01-01', '2024-01-02');
        expect(selectPool).toHaveBeenCalledTimes(2);
    });
});
