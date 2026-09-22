/**
 * @fileoverview Unit tests for how the CoinGecko and GeckoTerminal clients read
 * each vendor's keyless history wall.
 *
 * Both vendors refuse a range older than they serve keyless callers with HTTP
 * 401. When a client misread that refusal as a failure, the price-history deep
 * backfill threw on the same chunk every tick and never finished. These tests
 * lock the reading against the response bodies the vendors actually send: the
 * wall answers empty after a single request, and a CoinGecko 401 without the
 * wall's code still throws, because that one is a rejected key. No live HTTP is made.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { httpClient } from '../../../lib/http-client.js';
import { ProviderConfigService, CoinGeckoClient, GeckoTerminalClient } from '../index.js';

/** Stub logger matching the ISystemLogService shape the clients touch. */
const stubLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => stubLogger };

/**
 * Build an error shaped like the one axios throws for a refused request.
 *
 * @param status - The HTTP status the vendor returned.
 * @param data - The response body the vendor sent with it.
 * @returns An error carrying `response.status` and `response.data`.
 */
function httpError(status: number, data: unknown): Error {
    return Object.assign(new Error(`HTTP ${status}`), { response: { status, data, headers: {} } });
}

describe('vendor history walls', () => {
    let mockDb: ReturnType<typeof createMockDatabaseService>;

    beforeEach(() => {
        ProviderConfigService.resetInstance();
        CoinGeckoClient.resetInstance();
        GeckoTerminalClient.resetInstance();
        mockDb = createMockDatabaseService();
        ProviderConfigService.setDependencies(mockDb, stubLogger as never);
        CoinGeckoClient.setDependencies(stubLogger as never);
        GeckoTerminalClient.setDependencies(stubLogger as never);
    });

    afterEach(() => {
        ProviderConfigService.resetInstance();
        CoinGeckoClient.resetInstance();
        GeckoTerminalClient.resetInstance();
        mockDb.clear();
        vi.restoreAllMocks();
    });

    it('CoinGecko reads the nested 10012 code as the wall and answers empty after one request', async () => {
        const get = vi.spyOn(httpClient, 'get').mockRejectedValue(
            httpError(401, { error: { status: { error_code: 10012, error_message: 'Your request exceeds the allowed time range.' } } })
        );
        await expect(CoinGeckoClient.getInstance().getMarketChartRange('TRX', 0, 86_400)).resolves.toEqual([]);
        expect(get).toHaveBeenCalledTimes(1);
    });

    it('CoinGecko still throws a 401 without the wall code, after one request', async () => {
        const get = vi.spyOn(httpClient, 'get').mockRejectedValue(
            httpError(401, { status: { error_code: 10002, error_message: 'Invalid API key' } })
        );
        await expect(CoinGeckoClient.getInstance().getMarketChartRange('TRX', 0, 86_400)).rejects.toThrow('HTTP 401');
        expect(get).toHaveBeenCalledTimes(1);
    });

    it('GeckoTerminal reads a 401 on candles as the wall and answers empty after one request', async () => {
        const get = vi.spyOn(httpClient, 'get').mockRejectedValue(
            httpError(401, { errors: [{ status: '401', title: 'You can only access data from the past 180 days with Public API.' }] })
        );
        const pool = { poolAddress: 'TPOOL', name: 'X / USDT', side: 'base' as const, reserveUsd: 1_000_000 };
        await expect(GeckoTerminalClient.getInstance().getDailyCandles(pool, 1_600_000_000, 30)).resolves.toEqual([]);
        expect(get).toHaveBeenCalledTimes(1);
    });

    it('GeckoTerminal still throws a 401 that is not the wall, after one request', async () => {
        const get = vi.spyOn(httpClient, 'get').mockRejectedValue(httpError(401, { message: 'proxy authorization required' }));
        const pool = { poolAddress: 'TPOOL', name: 'X / USDT', side: 'base' as const, reserveUsd: 1_000_000 };
        await expect(GeckoTerminalClient.getInstance().getDailyCandles(pool, 1_600_000_000, 30)).rejects.toThrow('HTTP 401');
        expect(get).toHaveBeenCalledTimes(1);
    });
});
