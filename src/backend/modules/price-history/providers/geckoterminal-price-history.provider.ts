/**
 * @fileoverview GeckoTerminal implementation of the price-history capability.
 *
 * Why GeckoTerminal: it prices a token from its own on-chain liquidity pool, so
 * it covers the long tail of TRC20 tokens no aggregator lists. The cost is that
 * a pool only has a candle on a day it traded, so the series it returns can
 * have gaps; the service stores what exists and leaves the rest unpriced rather
 * than inventing a price for a day with no trade.
 *
 * Scope is tokens only. TRX has no pool of its own on GeckoTerminal (wrapped
 * TRX does, but pricing the native coin through a wrapper adds a step the
 * explorer and aggregator vendors do not need).
 */

import type { PriceAsset, ISystemLogService } from '@/types';
import { PRICE_ASSET_TRX } from '@/types';
import {
    GeckoTerminalClient,
    MAX_CANDLES_PER_CALL,
    type IGeckoTerminalPoolSelection,
    type IPriceHistoryProvider,
    type ISourcedPricePoint
} from '../../providers/index.js';
import { toUtcDay, utcDayEndSeconds, diffUtcDays } from '../lib/price-day.js';

/**
 * Fetches historical TRC20 token prices from their deepest SunSwap pool.
 */
export class GeckoTerminalPriceHistoryProvider implements IPriceHistoryProvider {
    public readonly id = 'geckoterminal';

    private readonly logger: ISystemLogService;

    /**
     * Pool chosen per token, remembered for the life of the process so a
     * multi-chunk backfill pays for pool discovery once. Only a usable pool is
     * remembered: a token with none is looked up again on its next fetch, so a
     * pool that gains liquidity, or a lowered reserve floor, is picked up at
     * the service's next seed retry instead of after a restart. That retry is
     * a day out, so the repeated lookup costs one call per parked token per day.
     */
    private readonly pools = new Map<string, IGeckoTerminalPoolSelection>();

    /**
     * @param logger - Child logger for provider diagnostics.
     */
    constructor(logger: ISystemLogService) {
        this.logger = logger;
    }

    /** @inheritdoc */
    supportsAsset(asset: PriceAsset): boolean {
        return typeof asset === 'string' && asset.length > 0 && asset !== PRICE_ASSET_TRX;
    }

    /**
     * Resolve the pool a token is priced from, discovering it on first use.
     *
     * @param asset - The token contract.
     * @returns The pool, or null when the token has none worth trusting.
     */
    private async poolFor(asset: PriceAsset): Promise<IGeckoTerminalPoolSelection | null> {
        const remembered = this.pools.get(asset);
        if (remembered) {
            return remembered;
        }
        const selection = await GeckoTerminalClient.getInstance().selectPool(asset);
        if (selection) {
            this.pools.set(asset, selection);
            this.logger.info({ asset, pool: selection.poolAddress, pair: selection.name, reserveUsd: selection.reserveUsd }, 'GeckoTerminal pool selected');
        }
        return selection;
    }

    /**
     * Forget a token's chosen pool so the next fetch discovers it again. The
     * service calls this when an operator resets an asset, since a reset is the
     * signal that something about the asset's pricing should be reconsidered.
     *
     * @param asset - The token contract.
     */
    forgetAsset(asset: PriceAsset): void {
        this.pools.delete(asset);
    }

    /**
     * Read the pool's daily candles ending at the range's last day and keep the
     * ones inside the range. One call returns at most `MAX_CANDLES_PER_CALL`
     * traded days, so the request asks for the range width plus one and the
     * caller's chunk width keeps that inside the cap. Empty for a token with no
     * pool or a range before the pool existed; a disabled vendor or transport
     * failure propagates from the client.
     *
     * @param asset - The token to price.
     * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
     * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
     * @returns Daily points in the range, oldest first; empty when GeckoTerminal has nothing.
     */
    async fetchRange(asset: PriceAsset, fromDay: string, toDay: string): Promise<ISourcedPricePoint[]> {
        if (!this.supportsAsset(asset)) {
            return [];
        }
        const pool = await this.poolFor(asset);
        if (!pool) {
            return [];
        }
        // `before_timestamp` is exclusive, so one past the range end includes the last day.
        const beforeSeconds = utcDayEndSeconds(toDay) + 1;
        const limit = Math.min(MAX_CANDLES_PER_CALL, diffUtcDays(fromDay, toDay) + 1);
        const candles = await GeckoTerminalClient.getInstance().getDailyCandles(pool, beforeSeconds, limit);
        const byDay = new Map<string, number>();
        for (const candle of candles) {
            byDay.set(toUtcDay(new Date(candle.timestamp * 1000)), candle.close);
        }
        const points = Array.from(byDay.entries())
            .filter(([day]) => day >= fromDay && day <= toDay)
            .map(([day, priceUsd]) => ({ asset, day, priceUsd, source: this.id, sourceRef: pool.poolAddress }))
            .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
        this.logger.debug({ asset, pool: pool.poolAddress, fromDay, toDay, points: points.length }, 'GeckoTerminal range fetched');
        return points;
    }
}
