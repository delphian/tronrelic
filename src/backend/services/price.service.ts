/**
 * @fileoverview Current TRX price in USD for block sync, which stamps it on each
 * block's transactions.
 *
 * Why it is careful about request volume: sync asks for the price on every
 * block, and several blocks can be processed back to back while sync catches
 * up. The price is cached for a minute in memory and in Redis, concurrent
 * callers share one request, and a failed request starts a backoff instead of
 * being repeated by the next block. Without that, one rate-limit response from
 * CoinGecko turned into a request per block, which kept the rate limit in force.
 *
 * The request goes through the providers module's CoinGecko client, so it uses
 * the base URL and API key the operator saved on the CoinGecko configuration card.
 */

import type { Redis as RedisClient } from 'ioredis';
import { getRedisClient } from '../loaders/redis.js';
import { logger } from '../lib/logger.js';
import { httpStatusOf, retryAfterMs } from '../lib/retry.js';
import { CoinGeckoClient } from '../modules/providers/clients/coin-gecko.client.js';
import { ProviderDisabledError } from '../modules/providers/capabilities/ProviderDisabledError.js';

/** A price and when it was obtained, so its age can be checked. */
interface IPriceCacheEntry {
    value: number;
    fetchedAt: number;
}

/** What the service needs from outside, passed in so tests can supply fakes. */
export interface IPriceServiceDependencies {
    /** Shared cache, so every backend process reuses one fetched price. */
    redis: RedisClient;
    /** Reads the live price from the vendor; throws on any failure. */
    fetchSpotPrice: () => Promise<number>;
}

const CACHE_KEY = 'prices:trx:usd';

/** How long a fetched price counts as current. */
const CACHE_TTL_SECONDS = 60;

/** Wait after the first failed fetch; doubles with each further failure. */
const FAILURE_BACKOFF_BASE_MS = 30_000;

/** Longest wait between fetch attempts while the vendor keeps failing. */
const FAILURE_BACKOFF_MAX_MS = 10 * 60_000;

/**
 * How often to re-read the configuration while CoinGecko is switched off. The
 * check is a local read rather than a vendor request, so it stays at a fixed
 * short interval, and a card the operator switches back on is used within this time.
 */
const DISABLED_RECHECK_MS = 30_000;

/**
 * Oldest last-known price served while fetches are failing. TRX moves little in
 * a quarter of an hour, so an older price is better than none for stamping
 * transactions; past this age the service returns null rather than a price that
 * may have drifted.
 */
const MAX_STALE_MS = 15 * 60_000;

/**
 * Shared TRX price source for block sync. One instance serves the process so
 * the cache, the in-flight request, and the backoff state are shared by every caller.
 */
export class PriceService {
    private static instance: PriceService | null = null;

    private readonly redis: RedisClient;
    private readonly fetchSpotPrice: () => Promise<number>;
    private lastGood: IPriceCacheEntry | null = null;
    private inFlight: Promise<number | null> | null = null;
    private consecutiveFailures = 0;
    private nextAttemptAt = 0;

    /**
     * Production code uses {@link getInstance}; tests construct directly with fakes.
     *
     * @param dependencies - The cache and the vendor read the service works through.
     */
    constructor(dependencies: IPriceServiceDependencies) {
        this.redis = dependencies.redis;
        this.fetchSpotPrice = dependencies.fetchSpotPrice;
    }

    /**
     * Return the shared instance, wired to Redis and the CoinGecko client. The
     * client is looked up on each fetch rather than here, because block sync
     * creates this service during bootstrap before the providers module has
     * set the client up.
     *
     * @returns The process-wide price service.
     */
    static getInstance(): PriceService {
        if (!PriceService.instance) {
            PriceService.instance = new PriceService({
                redis: getRedisClient(),
                fetchSpotPrice: () => CoinGeckoClient.getInstance().getSpotTrxPriceUsd()
            });
        }
        return PriceService.instance;
    }

    /**
     * Get the current TRX price in USD for stamping a block's transactions.
     * Serves a price younger than a minute from memory, and otherwise joins the
     * refresh already running or starts one, so a burst of blocks sends at most
     * one request.
     *
     * @returns The price, a recent last-known price while the vendor is failing, or null when neither is available.
     */
    async getTrxPriceUsd(): Promise<number | null> {
        const now = Date.now();
        let result: Promise<number | null>;
        if (this.lastGood && now - this.lastGood.fetchedAt < CACHE_TTL_SECONDS * 1000) {
            result = Promise.resolve(this.lastGood.value);
        } else {
            if (!this.inFlight) {
                this.inFlight = this.refresh().finally(() => {
                    this.inFlight = null;
                });
            }
            result = this.inFlight;
        }
        return result;
    }

    /**
     * Find a current price: first from Redis, where another process may have
     * stored one, then from the vendor unless a backoff is in force.
     *
     * @returns The price, or the stale fallback when no current price can be had.
     */
    private async refresh(): Promise<number | null> {
        const now = Date.now();
        let price = await this.readCache(now);
        if (price === null) {
            price = now < this.nextAttemptAt ? this.staleFallback(now) : await this.fetchAndStore(now);
        }
        return price;
    }

    /**
     * Read a price another process cached in Redis. A Redis failure is logged
     * and treated as a cache miss, so a cache outage does not stop pricing.
     *
     * @param now - The refresh's timestamp, recorded as when the price was obtained.
     * @returns The cached price, or null on a miss.
     */
    private async readCache(now: number): Promise<number | null> {
        let price: number | null = null;
        try {
            const cached = await this.redis.get(CACHE_KEY);
            const parsed = cached ? Number(cached) : NaN;
            if (Number.isFinite(parsed)) {
                this.lastGood = { value: parsed, fetchedAt: now };
                price = parsed;
            }
        } catch (error) {
            logger.warn({ error }, 'Failed to read price from redis');
        }
        return price;
    }

    /**
     * Ask the vendor for the price. On success the price is cached and the
     * backoff cleared. On a vendor failure the next attempt is pushed out,
     * doubling from 30 seconds to 10 minutes, or to the server's `Retry-After`
     * when that is longer, and the stale fallback is served meanwhile. When the
     * vendor is switched off, the configuration is re-read every
     * {@link DISABLED_RECHECK_MS} without growing the backoff, so switching it
     * back on takes effect quickly.
     *
     * @param now - The refresh's timestamp, used to schedule the next attempt.
     * @returns The fetched price, or the stale fallback after a failure.
     */
    private async fetchAndStore(now: number): Promise<number | null> {
        let price: number | null;
        try {
            price = await this.fetchSpotPrice();
            this.lastGood = { value: price, fetchedAt: now };
            this.consecutiveFailures = 0;
            this.nextAttemptAt = 0;
            try {
                await this.redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, price.toString());
            } catch (error) {
                logger.warn({ error }, 'Failed to persist TRX price to redis');
            }
        } catch (error) {
            // A disabled vendor made no request, so it does not climb the vendor
            // backoff; letting it climb would ignore a card the operator just
            // switched back on for up to ten minutes.
            const disabled = error instanceof ProviderDisabledError;
            this.consecutiveFailures = disabled ? 0 : this.consecutiveFailures + 1;
            const backoffMs = disabled
                ? DISABLED_RECHECK_MS
                : Math.min(FAILURE_BACKOFF_BASE_MS * 2 ** (this.consecutiveFailures - 1), FAILURE_BACKOFF_MAX_MS);
            const retryInMs = Math.max(backoffMs, retryAfterMs(error) ?? 0);
            this.nextAttemptAt = now + retryInMs;
            price = this.staleFallback(now);
            const detail = {
                error,
                status: httpStatusOf(error),
                consecutiveFailures: this.consecutiveFailures,
                retryInMs,
                servingStalePrice: price !== null
            };
            if (error instanceof ProviderDisabledError) {
                logger.warn(detail, 'TRX price not fetched: CoinGecko is disabled on its configuration card');
            } else {
                logger.error(detail, 'Failed to fetch TRX price from API; backing off');
            }
        }
        return price;
    }

    /**
     * Pick the price to serve while fetches are failing or backing off.
     *
     * @param now - The current time, to check the last price's age.
     * @returns The last-known price when it is under {@link MAX_STALE_MS} old, otherwise null.
     */
    private staleFallback(now: number): number | null {
        return this.lastGood && now - this.lastGood.fetchedAt <= MAX_STALE_MS ? this.lastGood.value : null;
    }
}
