/**
 * @fileoverview CoinGecko implementation of the price-history capability.
 *
 * Why CoinGecko: it is the one vendor here that prices both TRX (by coin id) and
 * the TRC20 tokens it lists (by contract address), through a single ranged
 * endpoint. The keyless tier caps a range at 365 days of age and the client
 * reports anything older as empty, so this adapter naturally falls through to
 * the next vendor for deep history until a paid key is configured.
 */

import type { PriceAsset, ISystemLogService } from '@/types';
import { PRICE_ASSET_TRX } from '@/types';
import { CoinGeckoClient, type IPriceHistoryProvider, type ISourcedPricePoint } from '../../providers/index.js';
import { toUtcDay, utcDayStartSeconds, utcDayEndSeconds } from '../lib/price-day.js';

/**
 * Fetches historical TRX and TRC20 prices from CoinGecko.
 */
export class CoinGeckoPriceHistoryProvider implements IPriceHistoryProvider {
    public readonly id = 'coingecko';

    private readonly logger: ISystemLogService;

    /**
     * @param logger - Child logger for provider diagnostics.
     */
    constructor(logger: ISystemLogService) {
        this.logger = logger;
    }

    /**
     * CoinGecko can attempt any asset: TRX by coin id, a token by contract. An
     * unlisted token comes back empty from the client rather than being refused
     * here, because listing status is only known by asking.
     *
     * @param asset - The asset to price.
     * @returns Always true.
     */
    supportsAsset(asset: PriceAsset): boolean {
        return typeof asset === 'string' && asset.length > 0;
    }

    /**
     * Fetch a range through the client and collapse its intraday samples to one
     * closing point per UTC day. Because the samples arrive in ascending time
     * order, the last value written for a day is that day's close — the daily
     * reference price cost-basis math wants. Empty for an unlisted asset or a
     * range beyond the keyless wall; a disabled vendor or transport failure
     * propagates from the client.
     *
     * @param asset - The asset to price.
     * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
     * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
     * @returns Daily points in the range, oldest first; empty when CoinGecko has nothing.
     */
    async fetchRange(asset: PriceAsset, fromDay: string, toDay: string): Promise<ISourcedPricePoint[]> {
        const samples = await CoinGeckoClient.getInstance().getMarketChartRange(
            asset,
            utcDayStartSeconds(fromDay),
            utcDayEndSeconds(toDay)
        );
        const sourceRef = asset === PRICE_ASSET_TRX ? 'tron' : `tron/contract/${asset}`;
        const byDay = new Map<string, number>();
        for (const sample of samples) {
            const millis = Number(sample?.[0]);
            const priceUsd = Number(sample?.[1]);
            if (!Number.isFinite(millis) || !Number.isFinite(priceUsd) || priceUsd <= 0) {
                continue;
            }
            byDay.set(toUtcDay(new Date(millis)), priceUsd);
        }
        const points = Array.from(byDay.entries())
            .filter(([day]) => day >= fromDay && day <= toDay)
            .map(([day, priceUsd]) => ({ asset, day, priceUsd, source: this.id, sourceRef }))
            .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
        this.logger.debug({ asset, fromDay, toDay, points: points.length }, 'CoinGecko range fetched');
        return points;
    }
}
