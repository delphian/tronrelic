/**
 * @fileoverview TronScan implementation of the price-history provider seam.
 *
 * Why TronScan for TRX: its `/api/trx/volume` endpoint returns clean daily TRX
 * OHLC over an arbitrary range in a single call, with no keyless 365-day history
 * wall — the limitation that made the CoinGecko deep-backfill 401 and stall. It
 * therefore serves the seed, the deep backward walk, and the daily forward append
 * from one endpoint, mapping each row's `close` to that day's reference price.
 *
 * Scope is deliberately TRX-only. TronScan has no per-contract historical token
 * series, so token assets resolve to empty/null here; the price-history service
 * degrades those gracefully (seeded-but-empty), leaving token holdings unpriced
 * until a dedicated token-history source (e.g. on-chain SunSwap) is added. The
 * `enabled` flag on the provider config pauses TRX ingestion without code changes.
 */

import type { IPricePoint, PriceAsset, ISystemLogService } from '@/types';
import { PRICE_ASSET_TRX } from '@/types';
import { TronScanClient, ProviderConfigService } from '../../providers/index.js';
import { toUtcDay, utcDayStartSeconds, utcDayEndSeconds } from '../lib/price-day.js';
import type { IPriceHistoryProvider } from './IPriceHistoryProvider.js';

/** Milliseconds per second, for the seconds→ms conversion TronScan expects. */
const MS_PER_SECOND = 1000;

/**
 * Fetches historical TRX prices from TronScan; returns nothing for token assets.
 */
export class TronScanPriceHistoryProvider implements IPriceHistoryProvider {
    public readonly id = 'tronscan';

    private readonly logger: ISystemLogService;

    /**
     * @param logger - Child logger for provider diagnostics.
     */
    constructor(logger: ISystemLogService) {
        this.logger = logger;
    }

    /**
     * Fetch a daily TRX price range from TronScan, collapsed to one close per UTC
     * day. Returns empty for any non-TRX asset (TronScan has no token history) and
     * when the provider is disabled in config. A transport failure propagates so
     * the calling tick retries rather than flipping an asset to seeded-but-empty on
     * a transient error.
     *
     * @param asset - The asset to price.
     * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
     * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
     * @returns Daily points in the range, oldest first; empty for tokens/disabled.
     */
    async fetchRange(asset: PriceAsset, fromDay: string, toDay: string): Promise<IPricePoint[]> {
        if (asset !== PRICE_ASSET_TRX) {
            return [];
        }
        const config = await ProviderConfigService.getInstance().getTronScanConfig();
        if (!config.enabled) {
            return [];
        }
        const startMs = utcDayStartSeconds(fromDay) * MS_PER_SECOND;
        const endMs = utcDayEndSeconds(toDay) * MS_PER_SECOND;
        const rows = await TronScanClient.getInstance().getTrxPriceVolume(startMs, endMs, config.priceSource);
        return this.collapseToDaily(asset, rows);
    }

    /**
     * Fetch a single day's TRX close. Implemented as a one-day range so deep-walk
     * and forward callers share one mapping path. Returns null for tokens, when
     * disabled, or when TronScan has no row for the day (the pre-listing floor that
     * signals the backfill to complete).
     *
     * Selects the row whose mapped day equals the requested day rather than taking
     * the last point: TronScan's end bound is loose (a one-day range query can
     * return an adjacent day past the bound — confirmed against the live API), so
     * picking by day keeps the deep walk from booking an off-by-one day's price or
     * mistaking an extra trailing row for "the day exists."
     *
     * @param asset - The asset to price.
     * @param day - UTC `YYYY-MM-DD`.
     * @returns The day's point, or null.
     */
    async fetchDay(asset: PriceAsset, day: string): Promise<IPricePoint | null> {
        if (asset !== PRICE_ASSET_TRX) {
            return null;
        }
        const points = await this.fetchRange(asset, day, day);
        return points.find((point) => point.day === day) ?? null;
    }

    /**
     * Collapse TronScan's daily rows to one `IPricePoint` per UTC day, keyed by the
     * row's end-of-day `time`. Rows are already daily; the map dedupes defensively
     * and the sort guarantees oldest-first regardless of upstream order. Rows whose
     * `close` is not a finite number are skipped.
     *
     * @param asset - The asset the points belong to (always TRX here).
     * @param rows - Raw TronScan volume rows.
     * @returns One point per UTC day, oldest first.
     */
    private collapseToDaily(
        asset: PriceAsset,
        rows: Array<{ time: number; close: string }>
    ): IPricePoint[] {
        const byDay = new Map<string, number>();
        for (const row of rows) {
            const priceUsd = Number(row.close);
            if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
                continue;
            }
            byDay.set(toUtcDay(new Date(row.time)), priceUsd);
        }
        const points = Array.from(byDay.entries())
            .map(([day, priceUsd]) => ({ asset, day, priceUsd }))
            .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
        return points;
    }
}
