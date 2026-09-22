/**
 * @fileoverview TronScan implementation of the price-history capability.
 *
 * Why TronScan for TRX: its `/api/trx/volume` endpoint returns clean daily TRX
 * OHLC over an arbitrary range in a single call, with no keyless history wall.
 * One call therefore serves the seed, every deep-backfill chunk, and the daily
 * forward append, mapping each row's `close` to that day's reference price.
 *
 * Scope is TRX-only. TronScan has no per-contract historical token series, so
 * `supportsAsset` answers false for every token and the router never asks it.
 */

import type { PriceAsset, ISystemLogService } from '@/types';
import { PRICE_ASSET_TRX } from '@/types';
import {
    TronScanClient,
    ProviderConfigService,
    ProviderDisabledError,
    type IPriceHistoryProvider,
    type ISourcedPricePoint
} from '../../providers/index.js';
import { toUtcDay, utcDayStartSeconds, utcDayEndSeconds } from '../lib/price-day.js';

/** Milliseconds per second, for the seconds→ms conversion TronScan expects. */
const MS_PER_SECOND = 1000;

/**
 * Fetches historical TRX prices from TronScan.
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

    /** @inheritdoc */
    supportsAsset(asset: PriceAsset): boolean {
        return asset === PRICE_ASSET_TRX;
    }

    /**
     * Fetch a daily TRX price range from TronScan, collapsed to one close per UTC
     * day and clipped to the requested range. Returns empty for a non-TRX asset
     * or for a range TronScan has no rows for (the pre-listing floor). A disabled
     * vendor throws `ProviderDisabledError` so the router skips it, and a
     * transport failure throws so the calling tick retries rather than recording
     * the asset as unpriceable.
     *
     * The clip matters because TronScan's end bound is loose: a range query can
     * return an adjacent day past the bound (confirmed against the live API), and
     * booking that day would move the cursor past a day that was never asked for.
     *
     * @param asset - The asset to price.
     * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
     * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
     * @returns Daily points in the range, oldest first; empty for tokens or an unpriced range.
     */
    async fetchRange(asset: PriceAsset, fromDay: string, toDay: string): Promise<ISourcedPricePoint[]> {
        if (!this.supportsAsset(asset)) {
            return [];
        }
        const config = await ProviderConfigService.getInstance().getTronScanConfig();
        if (!config.enabled) {
            throw new ProviderDisabledError(this.id);
        }
        const startMs = utcDayStartSeconds(fromDay) * MS_PER_SECOND;
        const endMs = utcDayEndSeconds(toDay) * MS_PER_SECOND;
        const rows = await TronScanClient.getInstance().getTrxPriceVolume(startMs, endMs, config.priceSource);
        const points = this.collapseToDaily(asset, rows).filter((point) => point.day >= fromDay && point.day <= toDay);
        this.logger.debug({ asset, fromDay, toDay, points: points.length }, 'TronScan range fetched');
        return points;
    }

    /**
     * Collapse TronScan's daily rows to one point per UTC day, keyed by the row's
     * end-of-day `time`. Rows are already daily; the map dedupes defensively and
     * the sort guarantees oldest-first regardless of upstream order. Rows that
     * are missing, carry a non-numeric `time`, or whose `close` is not a positive
     * finite number are skipped — the client casts the upstream shape without
     * runtime validation, and an unguarded bad `time` would throw via
     * `toUtcDay`→`toISOString` (or silently book a `1970-01-01` price for `null`),
     * stalling the backward backfill on that asset since its cursor only advances
     * on a clean write.
     *
     * @param asset - The asset the points belong to (always TRX here).
     * @param rows - Raw TronScan volume rows.
     * @returns One point per UTC day, oldest first.
     */
    private collapseToDaily(
        asset: PriceAsset,
        rows: Array<{ time: number; close: string }>
    ): ISourcedPricePoint[] {
        const byDay = new Map<string, number>();
        for (const row of rows) {
            if (!row || typeof row.time !== 'number' || !Number.isFinite(row.time)) {
                continue;
            }
            const priceUsd = Number(row.close);
            if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
                continue;
            }
            byDay.set(toUtcDay(new Date(row.time)), priceUsd);
        }
        const points = Array.from(byDay.entries())
            .map(([day, priceUsd]) => ({ asset, day, priceUsd, source: this.id }))
            .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
        return points;
    }
}
