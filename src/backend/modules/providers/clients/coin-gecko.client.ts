/**
 * @fileoverview CoinGecko HTTP client — the transport for the CoinGecko REST
 * API, sibling to the TronScan client.
 *
 * Why a dedicated client: CoinGecko is a distinct vendor with its own base URL,
 * two different API-key headers depending on the key's tier, and a keyless
 * history wall that has to be recognised as "nothing here" rather than as a
 * failure. Centralizing those wire details here keeps the price-history adapter
 * a pure shape mapper.
 *
 * Configuration is read from {@link ProviderConfigService} on every call so an
 * operator's edit on the providers card takes effect immediately without a
 * restart. The key is sensitive and is only ever read here for the outbound
 * header.
 */

import type { ISystemLogService } from '@/types';
import { httpClient } from '../../../lib/http-client.js';
import { retry } from '../../../lib/retry.js';
import { ProviderConfigService } from '../services/provider-config.service.js';
import { ProviderDisabledError } from '../capabilities/ProviderDisabledError.js';
import { COINGECKO_DESCRIPTOR } from '../database/index.js';
import type { IProviderTestResult } from '../services/provider-registry.service.js';

/** The CoinGecko coin id for the native TRON coin. */
const TRON_COIN_ID = 'tron';

/** Header a Demo (free) key travels in. */
const DEMO_KEY_HEADER = 'x-cg-demo-api-key';

/** Header a Pro (paid) key travels in. */
const PRO_KEY_HEADER = 'x-cg-pro-api-key';

/** Per-request timeout; CoinGecko occasionally stalls and we would rather retry. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * CoinGecko's own error code for "this range is older than a public caller may
 * query". It arrives as HTTP 401, the same status as a bad key, so the body code
 * is what tells the two apart.
 */
const HISTORY_WALL_ERROR_CODE = 10012;

/** The `market_chart/range` response — `[unixMillis, priceUsd]` tuples. */
interface ICoinGeckoRangeResponse {
    prices?: Array<[number, number]>;
}

/** The `simple/price` response consumed by the connectivity test. */
interface ICoinGeckoSimplePriceResponse {
    tron?: { usd?: number };
}

/** The error envelope CoinGecko attaches to a refused request. */
interface ICoinGeckoErrorBody {
    status?: { error_code?: number; error_message?: string };
    error?: string;
}

/**
 * Singleton CoinGecko client. No construction-time config — every call resolves
 * the current config from {@link ProviderConfigService}.
 */
export class CoinGeckoClient {
    private static instance: CoinGeckoClient | null = null;

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
        if (!CoinGeckoClient.instance) {
            CoinGeckoClient.instance = new CoinGeckoClient(logger);
        }
    }

    /**
     * @returns The shared instance.
     * @throws If {@link setDependencies} has not run.
     */
    public static getInstance(): CoinGeckoClient {
        if (!CoinGeckoClient.instance) {
            throw new Error('CoinGeckoClient.setDependencies() must be called before getInstance()');
        }
        return CoinGeckoClient.instance;
    }

    /** Reset for tests. */
    public static resetInstance(): void {
        CoinGeckoClient.instance = null;
    }

    /**
     * Build the CoinGecko path prefix for an asset. TRX uses the coin id; any
     * other asset is treated as a TRC20 contract address on the `tron` platform.
     *
     * @param asset - `'TRX'` or a TRC20 contract address.
     * @returns The path prefix under the base URL, no trailing slash.
     */
    public static assetPathPrefix(asset: string): string {
        return asset === 'TRX'
            ? `/coins/${TRON_COIN_ID}`
            : `/coins/${TRON_COIN_ID}/contract/${asset}`;
    }

    /**
     * Build the outbound headers, attaching the key in the header its tier
     * expects. A keyless deployment sends none and gets the public limits.
     *
     * @param apiKey - The configured key, possibly empty.
     * @param tier - Which header the key belongs in.
     * @returns Headers for the request.
     */
    private static buildHeaders(apiKey: string | undefined, tier: 'demo' | 'pro'): Record<string, string> {
        const headers: Record<string, string> = {};
        if (apiKey) {
            headers[tier === 'pro' ? PRO_KEY_HEADER : DEMO_KEY_HEADER] = apiKey;
        }
        return headers;
    }

    /**
     * Read the HTTP status and CoinGecko error code off a failed request.
     *
     * @param error - The thrown axios error.
     * @returns The status and body code, either possibly undefined.
     */
    private static classify(error: unknown): { status?: number; code?: number } {
        const response = (error as { response?: { status?: number; data?: ICoinGeckoErrorBody } })?.response;
        return { status: response?.status, code: response?.data?.status?.error_code };
    }

    /**
     * Fetch an asset's `[unixMillis, priceUsd]` samples over an inclusive
     * epoch-second range. Returns an empty array for the two stable "nothing
     * here" answers — the asset is not listed (404) or the range lies beyond the
     * keyless history wall (401 with code 10012) — so the caller can fall
     * through to another vendor. Any other failure is retried and then thrown,
     * including a 401 without that code, which is a bad key the operator must
     * fix rather than something to route around.
     *
     * @param asset - `'TRX'` or a TRC20 contract address.
     * @param fromSeconds - Inclusive start epoch seconds.
     * @param toSeconds - Inclusive end epoch seconds.
     * @returns Ascending samples, or empty.
     * @throws ProviderDisabledError When the operator has the vendor switched off.
     */
    public async getMarketChartRange(
        asset: string,
        fromSeconds: number,
        toSeconds: number
    ): Promise<Array<[number, number]>> {
        const config = await ProviderConfigService.getInstance().getCoinGeckoConfig();
        if (!config.enabled) {
            throw new ProviderDisabledError(COINGECKO_DESCRIPTOR.id);
        }
        const url = `${config.baseUrl}${CoinGeckoClient.assetPathPrefix(asset)}/market_chart/range`;
        let samples: Array<[number, number]> = [];
        try {
            samples = await retry(
                async () => {
                    const response = await httpClient.get<ICoinGeckoRangeResponse>(url, {
                        params: { vs_currency: 'usd', from: fromSeconds, to: toSeconds },
                        headers: CoinGeckoClient.buildHeaders(config.apiKey, config.keyTier),
                        timeout: REQUEST_TIMEOUT_MS
                    });
                    return response.data?.prices ?? [];
                },
                {
                    retries: 2,
                    delayMs: 1500,
                    factor: 2,
                    onRetry: (attempt, error) => {
                        const { status, code } = CoinGeckoClient.classify(error);
                        // A 404 and the history wall are final answers; retrying
                        // them only spends rate budget on the same response.
                        if (status === 404 || (status === 401 && code === HISTORY_WALL_ERROR_CODE)) {
                            throw error;
                        }
                        this.logger.warn({ attempt, status, asset }, 'Retrying CoinGecko market_chart/range');
                    }
                }
            );
        } catch (error) {
            const { status, code } = CoinGeckoClient.classify(error);
            if (status === 404) {
                this.logger.info({ asset }, 'CoinGecko: asset not listed (404); treating as unavailable');
            } else if (status === 401 && code === HISTORY_WALL_ERROR_CODE) {
                this.logger.info({ asset, fromSeconds }, 'CoinGecko: range beyond the keyless history wall; treating as unavailable');
            } else {
                throw error;
            }
        }
        return samples;
    }

    /**
     * Probe CoinGecko for the admin Test button with one `simple/price` call
     * using the saved config. Turns any failure into a friendly message rather
     * than throwing, so the card can show the result inline.
     *
     * @returns The structured test outcome.
     */
    public async testConnection(): Promise<IProviderTestResult> {
        const config = await ProviderConfigService.getInstance().getCoinGeckoConfig();
        const startedAt = Date.now();
        let result: IProviderTestResult;
        try {
            const response = await httpClient.get<ICoinGeckoSimplePriceResponse>(`${config.baseUrl}/simple/price`, {
                params: { ids: TRON_COIN_ID, vs_currencies: 'usd' },
                headers: CoinGeckoClient.buildHeaders(config.apiKey, config.keyTier),
                timeout: REQUEST_TIMEOUT_MS
            });
            const latencyMs = Date.now() - startedAt;
            const price = response.data?.tron?.usd;
            if (typeof price !== 'number' || !Number.isFinite(price)) {
                result = { ok: false, message: 'CoinGecko responded but returned no usable price data.', latencyMs, usingKey: !!config.apiKey };
            } else {
                result = {
                    ok: true,
                    message: `Connected to CoinGecko — current TRX price $${price.toFixed(4)}.`,
                    latencyMs,
                    usingKey: !!config.apiKey
                };
            }
        } catch (error) {
            const { status } = CoinGeckoClient.classify(error);
            const detail = status ? ` (HTTP ${status})` : '';
            this.logger.warn({ error, usingKey: !!config.apiKey }, 'CoinGecko connectivity test failed');
            result = {
                ok: false,
                message: `CoinGecko request failed${detail}. ${config.apiKey ? 'Check the key, its tier, and that the base URL matches the tier.' : 'Check the base URL or add an API key.'}`,
                usingKey: !!config.apiKey
            };
        }
        return result;
    }
}
