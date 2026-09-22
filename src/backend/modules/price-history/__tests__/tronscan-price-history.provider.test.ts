/**
 * @fileoverview Unit tests for the TronScan price-history adapter.
 *
 * Locks the contract the routing provider relies on: TRX rows map to one
 * sourced point per UTC day keyed off the row's end-of-day `time` with `close`
 * as the price and the vendor id as the source; rows outside the asked range
 * are clipped; token assets are refused by `supportsAsset` and resolve to empty
 * without touching TronScan; and a disabled vendor throws the disabled error so
 * the router skips it rather than the tick recording the asset as unpriceable.
 * The TronScan client call is spied so no live HTTP is made.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { ProviderConfigService, TronScanClient, ProviderDisabledError } from '../../providers/index.js';
import { TRONSCAN_CONFIG_KEY } from '../../providers/database/index.js';
import { TronScanPriceHistoryProvider } from '../providers/tronscan-price-history.provider.js';

/** Stub logger matching the ISystemLogService shape the provider touches. */
const stubLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => stubLogger
};

// 2024-01-01T23:59:59.999Z, 2024-01-02T23:59:59.999Z, 2024-01-03T23:59:59.999Z — TronScan's end-of-day stamps.
const DAY1_MS = 1704153599999;
const DAY2_MS = 1704239999999;
const DAY3_MS = 1704326399999;

describe('TronScanPriceHistoryProvider', () => {
    let mockDb: ReturnType<typeof createMockDatabaseService>;

    beforeEach(() => {
        ProviderConfigService.resetInstance();
        TronScanClient.resetInstance();
        mockDb = createMockDatabaseService();
        ProviderConfigService.setDependencies(mockDb, stubLogger as never);
        TronScanClient.setDependencies(stubLogger as never);
    });

    afterEach(() => {
        ProviderConfigService.resetInstance();
        TronScanClient.resetInstance();
        mockDb.clear();
        vi.restoreAllMocks();
    });

    it('supports TRX and no token', () => {
        const provider = new TronScanPriceHistoryProvider(stubLogger as never);
        expect(provider.supportsAsset('TRX')).toBe(true);
        expect(provider.supportsAsset('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(false);
    });

    it('maps TRX daily closes to one sourced point per UTC day, clipped to the range', async () => {
        vi.spyOn(TronScanClient.getInstance(), 'getTrxPriceVolume').mockResolvedValue([
            { time: DAY1_MS, close: '0.108' },
            { time: DAY2_MS, close: '0.110' },
            { time: DAY3_MS, close: '0.112' } // TronScan's loose end bound returned an extra day
        ]);
        const provider = new TronScanPriceHistoryProvider(stubLogger as never);

        const points = await provider.fetchRange('TRX', '2024-01-01', '2024-01-02');

        expect(points).toEqual([
            { asset: 'TRX', day: '2024-01-01', priceUsd: 0.108, source: 'tronscan' },
            { asset: 'TRX', day: '2024-01-02', priceUsd: 0.110, source: 'tronscan' }
        ]);
    });

    it('returns empty for a token asset without calling TronScan', async () => {
        const spy = vi.spyOn(TronScanClient.getInstance(), 'getTrxPriceVolume');
        const provider = new TronScanPriceHistoryProvider(stubLogger as never);

        const points = await provider.fetchRange('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', '2024-01-01', '2024-01-02');

        expect(points).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
    });

    it('throws the disabled error when the vendor is switched off in config', async () => {
        await mockDb.set(TRONSCAN_CONFIG_KEY, { enabled: false });
        const spy = vi.spyOn(TronScanClient.getInstance(), 'getTrxPriceVolume');
        const provider = new TronScanPriceHistoryProvider(stubLogger as never);

        await expect(provider.fetchRange('TRX', '2024-01-01', '2024-01-02')).rejects.toBeInstanceOf(ProviderDisabledError);
        expect(spy).not.toHaveBeenCalled();
    });

    it('returns empty at the listing floor', async () => {
        vi.spyOn(TronScanClient.getInstance(), 'getTrxPriceVolume').mockResolvedValue([]);
        const provider = new TronScanPriceHistoryProvider(stubLogger as never);

        await expect(provider.fetchRange('TRX', '2017-01-01', '2017-01-31')).resolves.toEqual([]);
    });
});
