/**
 * @fileoverview GeckoTerminal HTTP client — the transport for the GeckoTerminal
 * decentralized-exchange (DEX) data API.
 *
 * Why a dedicated client: GeckoTerminal prices a token through a specific
 * liquidity pool rather than by asset, so the transport has two jobs the other
 * vendors do not — find a token's pools and pick one deep enough to trust, then
 * read that pool's daily candles with the token on the right side of the pair.
 * Keeping pool selection here means the price-history adapter never learns what
 * a pool is.
 *
 * Configuration is read from {@link ProviderConfigService} on every call so an
 * operator's edit on the providers card takes effect immediately. The API is
 * keyless.
 */

import type { ISystemLogService } from '@/types';
import { httpClient } from '../../../lib/http-client.js';
import { retry } from '../../../lib/retry.js';
import { ProviderConfigService } from '../services/provider-config.service.js';
import { ProviderDisabledError } from '../capabilities/ProviderDisabledError.js';
import { GECKOTERMINAL_DESCRIPTOR } from '../database/index.js';
import type { IProviderTestResult } from '../services/provider-registry.service.js';

/** GeckoTerminal's network id for TRON. */
const NETWORK = 'tron';

/** Per-request timeout. */
const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Status GeckoTerminal's public API returns for candles older than it serves to
 * keyless callers (180 days, "You can only access data from the past 180 days
 * with Public API"). The API takes no key, so a 401 cannot mean a rejected
 * credential and always means that history wall.
 */
const HISTORY_WALL_STATUS = 401;

/** Most daily candles one OHLCV call returns. */
export const MAX_CANDLES_PER_CALL = 1000;

/**
 * Quote tokens a price is trusted against, in preference order: the stablecoins
 * first, then wrapped TRX. A pool quoted in another long-tail token gives a
 * price that is only as good as that token's own, so it is used only when
 * nothing better exists.
 */
const PREFERRED_QUOTES: ReadonlyArray<string> = [
    'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT
    'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', // USDC
    'TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn', // USDD
    'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR' // WTRX
];

/** Contract used by the connectivity test — USDT, which always has a price. */
const TEST_TOKEN = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** One pool as returned by the token-pools listing. Only consumed fields are typed. */
interface IGeckoTerminalPoolResource {
    attributes?: {
        name?: string;
        address?: string;
        reserve_in_usd?: string;
    };
    relationships?: {
        base_token?: { data?: { id?: string } };
        quote_token?: { data?: { id?: string } };
    };
}

/** Envelope of the token-pools listing. */
interface IGeckoTerminalPoolsResponse {
    data?: IGeckoTerminalPoolResource[];
}

/** Envelope of the pool OHLCV endpoint. */
interface IGeckoTerminalOhlcvResponse {
    data?: {
        attributes?: {
            /** `[unixSeconds, open, high, low, close, volume]`, newest first. */
            ohlcv_list?: Array<[number, number, number, number, number, number]>;
        };
    };
}

/** Envelope of the token-info endpoint consumed by the connectivity test. */
interface IGeckoTerminalTokenResponse {
    data?: { attributes?: { symbol?: string; price_usd?: string } };
}

/**
 * The pool chosen to price a token, plus which side of the pair the token is
 * on, which the OHLCV endpoint needs to return the right series.
 */
export interface IGeckoTerminalPoolSelection {
    /** The pool's contract address. */
    poolAddress: string;
    /** Pair name for logs and the admin surface, e.g. `SUN / WTRX`. */
    name: string;
    /** Whether the priced token is the pool's base or quote token. */
    side: 'base' | 'quote';
    /** The pool's USD reserve at selection time. */
    reserveUsd: number;
}

/** One daily candle, as the price-history adapter consumes it. */
export interface IGeckoTerminalDailyCandle {
    /** Epoch seconds at the candle's UTC day start. */
    timestamp: number;
    /** Closing USD price of the priced token. */
    close: number;
}

/**
 * Singleton GeckoTerminal client. No construction-time config — every call
 * resolves the current config from {@link ProviderConfigService}.
 */
export class GeckoTerminalClient {
    private static instance: GeckoTerminalClient | null = null;

    private readonly logger: ISystemLogService;

    /**
     * @param logger - Child logger for diagnostics.
     */
    private constructor(logger: ISystemLogService) {
        this.logger = logger;
    }

    /**
     * Wire the logger on first call; idempotent.
     *
     * @param logger - Child logger.
     */
    public static setDependencies(logger: ISystemLogService): void {
        if (!GeckoTerminalClient.instance) {
            GeckoTerminalClient.instance = new GeckoTerminalClient(logger);
        }
    }

    /**
     * @returns The shared instance.
     * @throws If {@link setDependencies} has not run.
     */
    public static getInstance(): GeckoTerminalClient {
        if (!GeckoTerminalClient.instance) {
            throw new Error('GeckoTerminalClient.setDependencies() must be called before getInstance()');
        }
        return GeckoTerminalClient.instance;
    }

    /** Reset for tests. */
    public static resetInstance(): void {
        GeckoTerminalClient.instance = null;
    }

    /**
     * Strip GeckoTerminal's `tron_` network prefix off a token resource id so it
     * compares to a bare contract address.
     *
     * @param resourceId - A relationship id such as `tron_TR7NHq…`.
     * @returns The contract address, or empty when the id is absent.
     */
    private static addressFromResourceId(resourceId: string | undefined): string {
        return resourceId ? resourceId.replace(`${NETWORK}_`, '') : '';
    }

    /**
     * Read the HTTP status off a failed request.
     *
     * @param error - The thrown axios error.
     * @returns The status, when the request reached the server.
     */
    private static statusOf(error: unknown): number | undefined {
        return (error as { response?: { status?: number } })?.response?.status;
    }

    /**
     * Choose the pool a token's price is read from: the deepest pool by USD
     * reserve among those quoted in a preferred token, falling back to the
     * deepest pool of any kind, and refusing anything under the configured
     * reserve floor. Returns null when the token has no pool worth trusting,
     * which the adapter reports as "no prices here".
     *
     * @param tokenAddress - The TRC20 contract to price.
     * @returns The chosen pool, or null.
     * @throws ProviderDisabledError When the operator has the vendor switched off.
     */
    public async selectPool(tokenAddress: string): Promise<IGeckoTerminalPoolSelection | null> {
        const config = await ProviderConfigService.getInstance().getGeckoTerminalConfig();
        if (!config.enabled) {
            throw new ProviderDisabledError(GECKOTERMINAL_DESCRIPTOR.id);
        }
        let pools: IGeckoTerminalPoolResource[] = [];
        try {
            pools = await retry(
                async () => {
                    const response = await httpClient.get<IGeckoTerminalPoolsResponse>(
                        `${config.baseUrl}/networks/${NETWORK}/tokens/${tokenAddress}/pools`,
                        { params: { page: 1 }, timeout: REQUEST_TIMEOUT_MS }
                    );
                    return response.data?.data ?? [];
                },
                {
                    retries: 2,
                    delayMs: 2000,
                    factor: 2,
                    // The default filter already stops on a 404, which is final here.
                    onRetry: (attempt) => this.logger.warn({ attempt, tokenAddress }, 'Retrying GeckoTerminal token pools')
                }
            );
        } catch (error) {
            if (GeckoTerminalClient.statusOf(error) === 404) {
                this.logger.info({ tokenAddress }, 'GeckoTerminal: token unknown (404); treating as unavailable');
                return null;
            }
            throw error;
        }

        const candidates: Array<IGeckoTerminalPoolSelection & { preferred: boolean }> = [];
        for (const pool of pools) {
            const address = pool.attributes?.address;
            const reserveUsd = Number(pool.attributes?.reserve_in_usd);
            if (!address || !Number.isFinite(reserveUsd)) {
                continue;
            }
            const base = GeckoTerminalClient.addressFromResourceId(pool.relationships?.base_token?.data?.id);
            const quote = GeckoTerminalClient.addressFromResourceId(pool.relationships?.quote_token?.data?.id);
            let side: 'base' | 'quote';
            let other: string;
            if (base === tokenAddress) {
                side = 'base';
                other = quote;
            } else if (quote === tokenAddress) {
                side = 'quote';
                other = base;
            } else {
                continue;
            }
            candidates.push({
                poolAddress: address,
                name: pool.attributes?.name ?? address,
                side,
                reserveUsd,
                preferred: PREFERRED_QUOTES.includes(other)
            });
        }
        // Preferred quotes first, then deepest reserve.
        candidates.sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.reserveUsd - a.reserveUsd);
        const chosen = candidates[0];
        if (!chosen || chosen.reserveUsd < config.minPoolReserveUsd) {
            this.logger.info(
                { tokenAddress, deepestReserveUsd: chosen?.reserveUsd ?? null, floor: config.minPoolReserveUsd },
                'GeckoTerminal: no pool above the reserve floor; leaving token unpriced'
            );
            return null;
        }
        const { preferred: _preferred, ...selection } = chosen;
        return selection;
    }

    /**
     * Read a pool's daily USD candles for the priced token, newest first as the
     * API returns them, ending at or before `beforeSeconds`. One call returns at
     * most {@link MAX_CANDLES_PER_CALL} candles and only the days the pool
     * traded, so a caller asking for a wide range gets gaps rather than zeros.
     * A range beyond the keyless history wall answers empty rather than
     * throwing, so the deep backfill reads it as the end of what this vendor
     * holds instead of failing and retrying the same range every tick.
     *
     * @param pool - The pool and side chosen by {@link selectPool}.
     * @param beforeSeconds - Exclusive upper bound, epoch seconds.
     * @param limit - Max candles to request.
     * @returns Candles with a finite positive close, newest first; empty past the history wall.
     * @throws ProviderDisabledError When the operator has the vendor switched off.
     */
    public async getDailyCandles(
        pool: IGeckoTerminalPoolSelection,
        beforeSeconds: number,
        limit: number
    ): Promise<IGeckoTerminalDailyCandle[]> {
        const config = await ProviderConfigService.getInstance().getGeckoTerminalConfig();
        if (!config.enabled) {
            throw new ProviderDisabledError(GECKOTERMINAL_DESCRIPTOR.id);
        }
        let rows: Array<[number, number, number, number, number, number]> = [];
        try {
            rows = await retry(
                async () => {
                    const response = await httpClient.get<IGeckoTerminalOhlcvResponse>(
                        `${config.baseUrl}/networks/${NETWORK}/pools/${pool.poolAddress}/ohlcv/day`,
                        {
                            params: {
                                aggregate: 1,
                                before_timestamp: beforeSeconds,
                                limit: Math.min(Math.max(1, limit), MAX_CANDLES_PER_CALL),
                                currency: 'usd',
                                token: pool.side
                            },
                            timeout: REQUEST_TIMEOUT_MS
                        }
                    );
                    return response.data?.data?.attributes?.ohlcv_list ?? [];
                },
                {
                    retries: 2,
                    delayMs: 2000,
                    factor: 2,
                    onRetry: (attempt) => this.logger.warn({ attempt, pool: pool.poolAddress }, 'Retrying GeckoTerminal OHLCV')
                }
            );
        } catch (error) {
            if (GeckoTerminalClient.statusOf(error) !== HISTORY_WALL_STATUS) {
                throw error;
            }
            this.logger.info(
                { pool: pool.poolAddress, beforeSeconds },
                'GeckoTerminal: range beyond the keyless history wall; treating as unavailable'
            );
        }
        const candles: IGeckoTerminalDailyCandle[] = [];
        for (const row of rows) {
            const timestamp = Number(row?.[0]);
            const close = Number(row?.[4]);
            if (!Number.isFinite(timestamp) || !Number.isFinite(close) || close <= 0) {
                continue;
            }
            candles.push({ timestamp, close });
        }
        return candles;
    }

    /**
     * Probe GeckoTerminal for the admin Test button by reading USDT's token info
     * with the saved base URL. Turns any failure into a friendly message rather
     * than throwing, so the card can show the result inline.
     *
     * @returns The structured test outcome.
     */
    public async testConnection(): Promise<IProviderTestResult> {
        const config = await ProviderConfigService.getInstance().getGeckoTerminalConfig();
        const startedAt = Date.now();
        let result: IProviderTestResult;
        try {
            const response = await httpClient.get<IGeckoTerminalTokenResponse>(
                `${config.baseUrl}/networks/${NETWORK}/tokens/${TEST_TOKEN}`,
                { timeout: REQUEST_TIMEOUT_MS }
            );
            const latencyMs = Date.now() - startedAt;
            const price = Number(response.data?.data?.attributes?.price_usd);
            if (!Number.isFinite(price)) {
                result = { ok: false, message: 'GeckoTerminal responded but returned no usable price data.', latencyMs, usingKey: false };
            } else {
                result = {
                    ok: true,
                    message: `Connected to GeckoTerminal — current USDT price $${price.toFixed(4)}.`,
                    latencyMs,
                    usingKey: false
                };
            }
        } catch (error) {
            const status = GeckoTerminalClient.statusOf(error);
            const detail = status ? ` (HTTP ${status})` : '';
            this.logger.warn({ error }, 'GeckoTerminal connectivity test failed');
            result = { ok: false, message: `GeckoTerminal request failed${detail}. Check the base URL.`, usingKey: false };
        }
        return result;
    }
}
