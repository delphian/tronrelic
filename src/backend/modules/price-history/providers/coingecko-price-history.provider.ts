/**
 * @fileoverview CoinGecko implementation of the price-history provider seam.
 *
 * Why two endpoints: CoinGecko's free tier serves a dense recent window cheaply
 * through `market_chart/range` but caps how far back that reaches, so the deep
 * past must be walked one day at a time through `/coins/{id}/history`. This class
 * hides that split behind `fetchRange` (seed) and `fetchDay` (deep walk). It also
 * maps an asset to the right CoinGecko address: `'TRX'` to the `tron` coin id,
 * any other asset to the `coins/tron/contract/{address}` token path. Unknown or
 * unlisted assets resolve to empty/null rather than throwing, so an untracked
 * long-tail token degrades to "unpriced" instead of failing the ingestion tick.
 */

import type { IPricePoint, PriceAsset, ISystemLogService } from '@/types';
import { PRICE_ASSET_TRX } from '@/types';
import { httpClient } from '../../../lib/http-client.js';
import { toUtcDay, utcDayStartSeconds, utcDayEndSeconds, toCoinGeckoHistoryDate } from '../lib/price-day.js';
import type { IPriceHistoryProvider } from './IPriceHistoryProvider.js';

/** Base URL for the CoinGecko public API. */
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/** The CoinGecko coin id for the native TRON coin. */
const TRON_COIN_ID = 'tron';

/** Per-request timeout; CoinGecko occasionally stalls and we would rather retry. */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * Shape of the `market_chart/range` response we consume — an array of
 * `[unixMillis, priceUsd]` tuples. Other fields (market caps, volumes) are
 * ignored.
 */
interface ICoinGeckoRangeResponse {
    prices?: Array<[number, number]>;
}

/**
 * Shape of the `/history` response we consume — the single-day spot price lives
 * under `market_data.current_price.usd`. Its absence means the coin had no market
 * on that date (i.e. before listing).
 */
interface ICoinGeckoHistoryResponse {
    market_data?: {
        current_price?: {
            usd?: number;
        };
    };
}

/**
 * Fetches historical TRX and TRC20 prices from CoinGecko.
 */
export class CoinGeckoPriceHistoryProvider implements IPriceHistoryProvider {
    public readonly id = 'coingecko';

    private readonly logger: ISystemLogService;

    /**
     * @param logger - Child logger for provider diagnostics; injected so the
     *   provider stays testable and consistent with the module's logging.
     */
    constructor(logger: ISystemLogService) {
        this.logger = logger;
    }

    /**
     * Build the CoinGecko path prefix for an asset. TRX uses the coin id; any
     * other asset is treated as a TRC20 contract address on the `tron` platform.
     *
     * @param asset - The asset to resolve.
     * @returns The path prefix under {@link COINGECKO_BASE}, no trailing slash.
     */
    private assetPathPrefix(asset: PriceAsset): string {
        const prefix = asset === PRICE_ASSET_TRX
            ? `/coins/${TRON_COIN_ID}`
            : `/coins/${TRON_COIN_ID}/contract/${asset}`;
        return prefix;
    }

    /**
     * Collapse CoinGecko's intraday `[ms, price]` samples to one closing point per
     * UTC day. Because the samples arrive in ascending time order, the last value
     * written for a day is that day's close — exactly the daily reference price
     * cost-basis math wants.
     *
     * @param asset - The asset the points belong to.
     * @param prices - Raw `[unixMillis, priceUsd]` tuples, ascending.
     * @returns One point per UTC day, oldest first.
     */
    private collapseToDaily(asset: PriceAsset, prices: Array<[number, number]>): IPricePoint[] {
        const byDay = new Map<string, number>();
        for (const [millis, priceUsd] of prices) {
            if (typeof priceUsd !== 'number' || !Number.isFinite(priceUsd)) {
                continue;
            }
            byDay.set(toUtcDay(new Date(millis)), priceUsd);
        }
        const points = Array.from(byDay.entries())
            .map(([day, priceUsd]) => ({ asset, day, priceUsd }))
            .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
        return points;
    }

    /**
     * Seed a dense recent window via the ranged endpoint. Returns empty (never
     * throws) on any failure so one unpriceable asset cannot abort a tick.
     *
     * @param asset - The asset to price.
     * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
     * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
     * @returns Daily points in the range, oldest first; empty when unavailable.
     */
    async fetchRange(asset: PriceAsset, fromDay: string, toDay: string): Promise<IPricePoint[]> {
        let points: IPricePoint[] = [];
        try {
            const response = await httpClient.get<ICoinGeckoRangeResponse>(
                `${COINGECKO_BASE}${this.assetPathPrefix(asset)}/market_chart/range`,
                {
                    params: {
                        vs_currency: 'usd',
                        from: utcDayStartSeconds(fromDay),
                        to: utcDayEndSeconds(toDay)
                    },
                    timeout: REQUEST_TIMEOUT_MS
                }
            );
            points = this.collapseToDaily(asset, response.data?.prices ?? []);
        } catch (error) {
            this.logger.warn({ error, asset, fromDay, toDay }, 'CoinGecko range fetch failed; treating as unavailable');
        }
        return points;
    }

    /**
     * Fetch one day's close. TRX uses the deep-history `/history` endpoint; a
     * token (no contract-addressable history endpoint exists) falls back to a
     * single-day ranged query. A genuine transport failure throws so the service
     * can retry; a "no market on that date" answer returns null to signal the
     * listing floor.
     *
     * @param asset - The asset to price.
     * @param day - UTC `YYYY-MM-DD`.
     * @returns The day's point, or null when the source has no price for it.
     */
    async fetchDay(asset: PriceAsset, day: string): Promise<IPricePoint | null> {
        let point: IPricePoint | null = null;
        if (asset === PRICE_ASSET_TRX) {
            const response = await httpClient.get<ICoinGeckoHistoryResponse>(
                `${COINGECKO_BASE}${this.assetPathPrefix(asset)}/history`,
                {
                    params: { date: toCoinGeckoHistoryDate(day), localization: false },
                    timeout: REQUEST_TIMEOUT_MS
                }
            );
            const priceUsd = response.data?.market_data?.current_price?.usd;
            if (typeof priceUsd === 'number' && Number.isFinite(priceUsd)) {
                point = { asset, day, priceUsd };
            }
        } else {
            const dayPoints = await this.fetchRange(asset, day, day);
            point = dayPoints.length > 0 ? dayPoints[dayPoints.length - 1] : null;
        }
        return point;
    }
}
