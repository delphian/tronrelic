/**
 * @fileoverview Attaching approximate USD values to chain query amounts.
 *
 * Prices come from the core `'price-history'` service, which keeps one
 * closing price per asset per UTC day for TRX and the TRC-20 tokens it tracks.
 * A day's close is only stored once the day is over, so a transfer made today
 * is valued at the most recent close before it. Every value therefore names
 * the day whose close it used, and is described to the model as approximate.
 * TRC-10 tokens and untracked TRC-20 tokens have no price and get no value.
 *
 * Like the tag lookup, pricing is enrichment: when the service is absent or
 * fails, the response carries amounts without USD values and a note saying so.
 *
 * @module backend/modules/blockchain/chain-query/UsdPricer
 */

import type { IPriceHistoryService } from '@/types';
import { logger } from '../logger.js';
import type { ChainAssetType } from './chainQueryInput.js';
import { tokenKey } from './TokenCatalog.js';

/** A USD value as a response carries it. */
export interface IUsdValue {
    /** The amount times the closing price, rounded to cents. */
    usd: number;
    /** The UTC day whose closing price was used, `YYYY-MM-DD`. */
    priceDay: string;
}

/** One amount that needs a price: which asset, on which UTC day. */
export interface IUsdPriceRequest {
    /** Which kind of asset. */
    assetType: ChainAssetType;
    /** The `token` column value: empty for TRX. */
    token: string;
    /** The UTC day the amount moved, `YYYY-MM-DD`. The latest close on or before it is used. */
    day: string;
}

/** A closing price found for a request. */
export interface IUsdPrice {
    /** Closing USD price per whole token. */
    priceUsd: number;
    /** The UTC day of that close. */
    priceDay: string;
}

/** Prices found for a set of requests. */
export interface IUsdPricesResult {
    /** Prices keyed by {@link priceKey}. A request with no price is absent. */
    prices: Map<string, IUsdPrice>;
    /** False when the price service was absent or failed. */
    available: boolean;
}

/**
 * Days searched back from a request's day for a close. Two covers the gap
 * between a day ending and its close being fetched, which runs overnight.
 */
const LOOKBACK_DAYS = 2;

/** One day in milliseconds. */
const DAY_MS = 86_400_000;

/**
 * The key a price is stored under for one request.
 *
 * @param assetType - Which kind of asset.
 * @param token - The `token` column value.
 * @param day - The UTC day asked about.
 * @returns The key.
 */
export function priceKey(assetType: ChainAssetType, token: string, day: string): string {
    return `${tokenKey(assetType, token)}|${day}`;
}

/**
 * Value an amount at a price.
 *
 * @param value - The amount in whole units, or null when the token's decimals are unknown.
 * @param price - The price found for it, or undefined when there is none.
 * @returns The USD value, or null when either input is missing.
 */
export function toUsdValue(value: string | null, price: IUsdPrice | undefined): IUsdValue | null {
    return value === null || price === undefined
        ? null
        : { usd: Math.round(Number(value) * price.priceUsd * 100) / 100, priceDay: price.priceDay };
}

/**
 * The asset name price history uses: `TRX`, or the TRC-20 contract address.
 *
 * @param assetType - Which kind of asset.
 * @param token - The `token` column value.
 * @returns The price-history asset, or null for TRC-10, which it does not price.
 */
function priceAsset(assetType: ChainAssetType, token: string): string | null {
    return assetType === 'trx' ? 'TRX' : assetType === 'trc20' ? token : null;
}

/**
 * The UTC day `offset` days before `day`.
 *
 * @param day - A `YYYY-MM-DD` day.
 * @param offset - How many days earlier.
 * @returns The earlier day, `YYYY-MM-DD`.
 */
function dayBefore(day: string, offset: number): string {
    return new Date(Date.parse(`${day}T00:00:00Z`) - offset * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Finds closing prices for chain query amounts.
 *
 * A utility shared by every tool. The service is resolved on each call, for
 * the same boot-order reason as the tag lookup.
 */
export class UsdPricer {
    /**
     * @param resolveService - Returns the `'price-history'` service, or undefined when it is not registered.
     */
    constructor(private readonly resolveService: () => IPriceHistoryService | undefined) {}

    /**
     * Find the latest close on or before each request's day.
     *
     * One `getPricesForDays` call per asset covers every day asked about for
     * it, plus the lookback days, so the cost grows with the number of assets
     * in a response rather than the number of rows.
     *
     * @param requests - The amounts that need prices; duplicates are fine.
     * @returns Prices keyed by {@link priceKey}, and whether the service could be asked.
     */
    public async find(requests: readonly IUsdPriceRequest[]): Promise<IUsdPricesResult> {
        const service = this.resolveService();
        const result: IUsdPricesResult = { prices: new Map(), available: service !== undefined };
        const daysByAsset = new Map<string, { assetType: ChainAssetType; token: string; days: Set<string>; lookup: Set<string> }>();
        for (const request of requests) {
            const asset = priceAsset(request.assetType, request.token);
            if (asset) {
                const entry = daysByAsset.get(asset) ?? { assetType: request.assetType, token: request.token, days: new Set<string>(), lookup: new Set<string>() };
                entry.days.add(request.day);
                for (let offset = 0; offset <= LOOKBACK_DAYS; offset += 1) {
                    entry.lookup.add(dayBefore(request.day, offset));
                }
                daysByAsset.set(asset, entry);
            }
        }

        if (service) {
            try {
                for (const [asset, entry] of daysByAsset) {
                    const points = await service.getPricesForDays(asset, [...entry.lookup]);
                    const byDay = new Map(points.map(point => [point.day, point.priceUsd]));
                    for (const day of entry.days) {
                        for (let offset = 0; offset <= LOOKBACK_DAYS; offset += 1) {
                            const candidate = dayBefore(day, offset);
                            const priceUsd = byDay.get(candidate);
                            const key = priceKey(entry.assetType, entry.token, day);
                            if (priceUsd !== undefined && !result.prices.has(key)) {
                                result.prices.set(key, { priceUsd, priceDay: candidate });
                            }
                        }
                    }
                }
            } catch (error) {
                logger.warn({ error }, 'Price lookup failed for a chain query; answering without USD values');
                result.prices.clear();
                result.available = false;
            }
        }
        return result;
    }
}
