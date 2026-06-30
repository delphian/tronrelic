/**
 * @fileoverview TronScan HTTP client — the transport for the TronScan explorer
 * API, sibling to the TronGrid client.
 *
 * Why a dedicated client: TronScan is a distinct provider with its own base URL,
 * its own API-key header, and its own response shapes. Centralizing them here
 * keeps callers (currently the price-history TronScan provider) free of wire
 * details and gives the provider a single place to grow more TronScan methods.
 *
 * Configuration is read from {@link ProviderConfigService} on every call rather
 * than captured at construction, so an operator's edit on the admin Providers tab
 * (key, base URL, source, enable flag) takes effect immediately without a
 * restart. The key is sensitive and is only ever read here for the outbound
 * header — it is never returned to a caller.
 */

import type { ISystemLogService } from '@/types';
import { httpClient } from '../../../lib/http-client.js';
import { retry } from '../../../lib/retry.js';
import { ProviderConfigService } from '../services/provider-config.service.js';
import type { TronScanPriceSource } from '../database/index.js';

/** Path of the historical TRX price/volume endpoint. */
const TRX_VOLUME_PATH = '/api/trx/volume';

/** Header TronScan uses for an API key (shared TRON-ecosystem convention). */
const API_KEY_HEADER = 'TRON-PRO-API-KEY';

/** Per-request timeout; TronScan occasionally stalls and we would rather retry. */
const REQUEST_TIMEOUT_MS = 12_000;

/** Days of history a connectivity test asks for — small but non-empty. */
const TEST_RANGE_DAYS = 3;

/**
 * Row cap requested per call. TronScan caps returned rows when no limit is given,
 * which would truncate a wide seed window; this comfortably exceeds the widest
 * range any caller asks for (a 360-day seed) with daily granularity.
 */
const DEFAULT_ROW_LIMIT = 4000;

/**
 * One daily row from `/api/trx/volume`. Prices arrive as decimal strings; `time`
 * is the end-of-day epoch in milliseconds. Only the fields we consume are typed.
 */
export interface ITronScanTrxVolumePoint {
    /** End-of-day epoch milliseconds for the row. */
    time: number;
    /** Daily close price in USD (decimal string). */
    close: string;
    /** Daily open price in USD (decimal string). */
    open?: string;
    /** Source the row was sampled from. */
    source?: string;
}

/** Envelope of the `/api/trx/volume` response. */
interface ITronScanTrxVolumeResponse {
    code?: number;
    total?: number;
    data?: ITronScanTrxVolumePoint[];
}

/** Outcome of a connectivity/credential test, surfaced to the admin UI. */
export interface ITronScanTestResult {
    /** Whether the test call succeeded and returned at least one priced day. */
    ok: boolean;
    /** Human-readable result for the admin UI. */
    message: string;
    /** A sample close price from the test window, when available. */
    sampleClose?: number;
    /** Round-trip latency of the test call in milliseconds. */
    latencyMs?: number;
    /** Whether an API key was sent with the test (vs keyless). */
    usingKey?: boolean;
}

/**
 * Singleton TronScan client. No construction-time config — every call resolves the
 * current config from {@link ProviderConfigService}.
 */
export class TronScanClient {
    private static instance: TronScanClient | null = null;

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
        if (!TronScanClient.instance) {
            TronScanClient.instance = new TronScanClient(logger);
        }
    }

    /**
     * @returns The shared instance.
     * @throws If {@link setDependencies} has not run.
     */
    public static getInstance(): TronScanClient {
        if (!TronScanClient.instance) {
            throw new Error('TronScanClient.setDependencies() must be called before getInstance()');
        }
        return TronScanClient.instance;
    }

    /** Reset for tests. */
    public static resetInstance(): void {
        TronScanClient.instance = null;
    }

    /**
     * Build the outbound headers, attaching the API key only when one is set so a
     * keyless deployment still works (at TronScan's lower anonymous limits).
     *
     * @param apiKey - The configured key, possibly empty.
     * @returns Headers for the request.
     */
    private static buildHeaders(apiKey: string | undefined): Record<string, string> {
        const headers: Record<string, string> = {};
        if (apiKey) {
            headers[API_KEY_HEADER] = apiKey;
        }
        return headers;
    }

    /**
     * Fetch TRX daily OHLC over an inclusive epoch-millisecond range from
     * `/api/trx/volume`. Returns the rows as TronScan provides them (one per day,
     * `close` being the day's reference price) for the caller to map. Retries
     * transient transport failures; a non-2xx from TronScan propagates so the
     * caller can treat it as a tick failure rather than silently empty.
     *
     * @param startMs - Inclusive start epoch milliseconds.
     * @param endMs - Inclusive end epoch milliseconds.
     * @param source - Price source TronScan should report from.
     * @param limit - Max rows to request (defaults high enough for any seed window).
     * @returns The daily volume/price rows, oldest first as TronScan returns them.
     */
    public async getTrxPriceVolume(
        startMs: number,
        endMs: number,
        source: TronScanPriceSource,
        limit: number = DEFAULT_ROW_LIMIT
    ): Promise<ITronScanTrxVolumePoint[]> {
        const config = await ProviderConfigService.getInstance().getTronScanConfig();
        const url = `${config.baseUrl}${TRX_VOLUME_PATH}`;
        const rows = await retry(
            async () => {
                const response = await httpClient.get<ITronScanTrxVolumeResponse>(url, {
                    params: { start_timestamp: startMs, end_timestamp: endMs, source, limit },
                    headers: TronScanClient.buildHeaders(config.apiKey),
                    timeout: REQUEST_TIMEOUT_MS
                });
                return response.data?.data ?? [];
            },
            {
                retries: 3,
                delayMs: 1000,
                factor: 2,
                onRetry: (attempt, error) =>
                    this.logger.warn({ attempt, error, startMs, endMs }, 'Retrying TronScan getTrxPriceVolume')
            }
        );
        return rows;
    }

    /**
     * Probe the TronScan endpoint for the admin "Test" button. Issues one small
     * ranged TRX call with the currently-saved config (key included if set),
     * reports latency and a sample close price on success, and turns any failure
     * into a friendly message rather than throwing — the UI shows the result
     * inline. This is also how an operator confirms a newly-pasted key is accepted.
     *
     * @returns The structured test outcome.
     */
    public async testConnection(): Promise<ITronScanTestResult> {
        const config = await ProviderConfigService.getInstance().getTronScanConfig();
        const endMs = Date.now();
        const startMs = endMs - TEST_RANGE_DAYS * 86_400_000;
        const startedAt = Date.now();
        let result: ITronScanTestResult;
        try {
            const rows = await this.getTrxPriceVolume(startMs, endMs, config.priceSource);
            const latencyMs = Date.now() - startedAt;
            const lastClose = rows.length > 0 ? Number(rows[rows.length - 1].close) : NaN;
            if (rows.length === 0 || !Number.isFinite(lastClose)) {
                result = {
                    ok: false,
                    message: 'TronScan responded but returned no usable price data.',
                    latencyMs,
                    usingKey: !!config.apiKey
                };
            } else {
                result = {
                    ok: true,
                    message: `Connected to TronScan (${config.priceSource}) — latest TRX close $${lastClose.toFixed(4)}.`,
                    sampleClose: lastClose,
                    latencyMs,
                    usingKey: !!config.apiKey
                };
            }
        } catch (error) {
            const status = (error as { response?: { status?: number } })?.response?.status;
            const detail = status ? ` (HTTP ${status})` : '';
            this.logger.warn({ error, usingKey: !!config.apiKey }, 'TronScan connectivity test failed');
            result = {
                ok: false,
                message: `TronScan request failed${detail}. ${config.apiKey ? 'Check the API key and base URL.' : 'Check the base URL or add an API key.'}`,
                usingKey: !!config.apiKey
            };
        }
        return result;
    }
}
