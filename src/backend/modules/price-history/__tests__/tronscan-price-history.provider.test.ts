/**
 * @fileoverview Unit tests for the TronScan price-history provider.
 *
 * Locks the contract the price-history service relies on: TRX rows map to one
 * `IPricePoint` per UTC day keyed off the row's end-of-day `time` with `close` as
 * the price; token assets and a disabled provider resolve to empty/null without
 * touching TronScan (so the service degrades them gracefully); and `fetchDay`
 * yields the day's point or null at the listing floor. The TronScan client call is
 * spied so no live HTTP is made.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { ProviderConfigService, TronScanClient } from '../../providers/index.js';
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

// 2024-01-01T23:59:59.999Z and 2024-01-02T23:59:59.999Z — TronScan's end-of-day stamps.
const DAY1_MS = 1704153599999;
const DAY2_MS = 1704239999999;

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

    it('maps TRX daily closes to one price point per UTC day', async () => {
        vi.spyOn(TronScanClient.getInstance(), 'getTrxPriceVolume').mockResolvedValue([
            { time: DAY1_MS, close: '0.108' },
            { time: DAY2_MS, close: '0.110' }
        ]);
        const provider = new TronScanPriceHistoryProvider(stubLogger as never);

        const points = await provider.fetchRange('TRX', '2024-01-01', '2024-01-02');

        expect(points).toEqual([
            { asset: 'TRX', day: '2024-01-01', priceUsd: 0.108 },
            { asset: 'TRX', day: '2024-01-02', priceUsd: 0.110 }
        ]);
    });

    it('returns empty for a token asset without calling TronScan', async () => {
        const spy = vi.spyOn(TronScanClient.getInstance(), 'getTrxPriceVolume');
        const provider = new TronScanPriceHistoryProvider(stubLogger as never);

        const points = await provider.fetchRange('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', '2024-01-01', '2024-01-02');

        expect(points).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
    });

    it('returns empty when the provider is disabled in config', async () => {
        await mockDb.set(TRONSCAN_CONFIG_KEY, { enabled: false });
        const spy = vi.spyOn(TronScanClient.getInstance(), 'getTrxPriceVolume');
        const provider = new TronScanPriceHistoryProvider(stubLogger as never);

        const points = await provider.fetchRange('TRX', '2024-01-01', '2024-01-02');

        expect(points).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
    });

    it('fetchDay returns the day point, or null at the listing floor and for tokens', async () => {
        vi.spyOn(TronScanClient.getInstance(), 'getTrxPriceVolume')
            .mockResolvedValueOnce([{ time: DAY1_MS, close: '0.108' }])
            .mockResolvedValueOnce([]);
        const provider = new TronScanPriceHistoryProvider(stubLogger as never);

        await expect(provider.fetchDay('TRX', '2024-01-01')).resolves.toEqual({
            asset: 'TRX',
            day: '2024-01-01',
            priceUsd: 0.108
        });
        await expect(provider.fetchDay('TRX', '2017-01-01')).resolves.toBeNull();
        await expect(provider.fetchDay('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', '2024-01-01')).resolves.toBeNull();
    });
});
