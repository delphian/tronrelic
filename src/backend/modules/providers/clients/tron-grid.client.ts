/**
 * @fileoverview TronGrid provider client — the database-backed transport that
 * will eventually replace the env-configured TronGrid client in the blockchain
 * module.
 *
 * Why it exists now: the platform's live TronGrid access still reads
 * `TRONGRID_API_KEY*` from env and a hardcoded `https://api.trongrid.io` from
 * source. The Configuration tab lets an operator stage the same settings in the
 * database ahead of that switchover, and staged settings are worthless if nobody
 * can tell whether they work — a base URL typo or a key that was never activated
 * would only surface after the cutover, as a blockchain sync outage. This client
 * exposes exactly one operation, {@link TronGridProviderClient.testConnection},
 * so an operator can prove the stored config before anything depends on it.
 *
 * It reads {@link ProviderConfigService} per call and touches no other caller's
 * path: nothing in the sync pipeline consumes it. When the switchover happens,
 * the real request methods land here and the blockchain module's env-bound
 * client retires.
 */

import type { ISystemLogService } from '@/types';
import { httpClient } from '../../../lib/http-client.js';
import { ProviderConfigService } from '../services/provider-config.service.js';

/** Cheapest authenticated TronGrid call: returns the current head block. */
const NOW_BLOCK_PATH = '/wallet/getnowblock';

/** Header TronGrid uses for an API key (shared TRON-ecosystem convention). */
const API_KEY_HEADER = 'TRON-PRO-API-KEY';

/**
 * Ceiling on how long a single probe may hang, regardless of the configured
 * `requestTimeoutMs`.
 *
 * The stored timeout may legitimately be as high as two minutes, which is a
 * sensible bound for a background sync request but not for a request an
 * operator is watching a spinner on: against a base URL that blackholes packets
 * the browser or proxy gives up long before the probe does, so the operator gets
 * a hung button instead of the per-key diagnosis this endpoint exists to
 * provide. Probes run concurrently and each is capped here, so the whole test
 * settles within this bound no matter how many keys are in the pool.
 */
const PROBE_TIMEOUT_CAP_MS = 15_000;

/** Shape of the `/wallet/getnowblock` response, narrowed to what the test reads. */
interface ITronGridNowBlockResponse {
    block_header?: {
        raw_data?: {
            number?: number;
        };
    };
}

/** Outcome of probing TronGrid with one specific key (or keyless). */
export interface ITronGridKeyTestResult {
    /** Rotation position of the key probed, or null for a keyless probe. */
    index: number | null;
    /** Masked form of the key probed (`****abcd`), or empty when keyless. */
    maskedKey: string;
    /** Whether TronGrid answered with a usable head block. */
    ok: boolean;
    /** Human-readable result for the admin UI. */
    message: string;
    /** Round-trip latency in milliseconds, when the call completed. */
    latencyMs?: number;
    /** Head block height TronGrid reported, when the call succeeded. */
    blockNumber?: number;
}

/** Aggregate outcome of a connectivity test across the whole stored key pool. */
export interface ITronGridTestResult {
    /** True only when every probe succeeded — one dead key fails the test. */
    ok: boolean;
    /** Summary line for the admin UI. */
    message: string;
    /** Highest head block seen across the probes, for a sanity check against the chain. */
    blockNumber?: number;
    /** Per-key detail, so a single failing key in the rotation is identifiable. */
    keyResults: ITronGridKeyTestResult[];
}

/**
 * Singleton TronGrid provider client. No construction-time config — the probe
 * resolves the current stored config on every call, so an operator's edit is
 * testable immediately.
 */
export class TronGridProviderClient {
    private static instance: TronGridProviderClient | null = null;

    private readonly logger: ISystemLogService;

    /**
     * @param logger - Child logger for diagnostics.
     */
    private constructor(logger: ISystemLogService) {
        this.logger = logger;
    }

    /**
     * Wire the logger on first call; idempotent so repeated bootstrap paths are
     * harmless.
     *
     * @param logger - Child logger.
     */
    public static setDependencies(logger: ISystemLogService): void {
        if (!TronGridProviderClient.instance) {
            TronGridProviderClient.instance = new TronGridProviderClient(logger);
        }
    }

    /**
     * @returns The shared instance.
     * @throws If {@link setDependencies} has not run.
     */
    public static getInstance(): TronGridProviderClient {
        if (!TronGridProviderClient.instance) {
            throw new Error('TronGridProviderClient.setDependencies() must be called before getInstance()');
        }
        return TronGridProviderClient.instance;
    }

    /** Reset for tests. */
    public static resetInstance(): void {
        TronGridProviderClient.instance = null;
    }

    /**
     * Probe the stored TronGrid config for the admin "Test" button.
     *
     * Every stored key is probed rather than just the first, because the rotator
     * will spread real traffic across all of them: a pool where one key was
     * revoked still answers most requests, which is precisely the failure that
     * hides until it causes intermittent sync errors. With no keys stored the
     * probe runs once anonymously, mirroring TronGrid's shared per-IP pool.
     *
     * The probes run concurrently, and each is bounded by
     * {@link PROBE_TIMEOUT_CAP_MS}. Run serially at the configured timeout, a
     * full pool against an unresponsive host would hold the request for the
     * product of the two — long past the point where the operator's browser has
     * given up and the diagnosis is lost. Concurrency costs one extra request
     * per key against a host the operator has already chosen to talk to.
     *
     * Failures never throw — the UI renders them inline, one line per key.
     *
     * @returns The aggregate outcome plus per-key detail, in rotation order.
     */
    public async testConnection(): Promise<ITronGridTestResult> {
        const configService = ProviderConfigService.getInstance();
        const config = await configService.getTronGridConfig();
        const masked = await configService.getMaskedTronGridConfig();

        if (!config.baseUrl) {
            return {
                ok: false,
                message: 'No base URL is configured. Set one before testing.',
                keyResults: []
            };
        }

        const timeoutMs = Math.min(config.requestTimeoutMs, PROBE_TIMEOUT_CAP_MS);
        const keyResults: ITronGridKeyTestResult[] = config.apiKeys.length === 0
            ? [await this.probe(config.baseUrl, timeoutMs, undefined, null, '')]
            : await Promise.all(
                config.apiKeys.map((apiKey, index) =>
                    this.probe(config.baseUrl, timeoutMs, apiKey, index, masked.apiKeys[index] ?? ''))
            );

        const failures = keyResults.filter((result) => !result.ok);
        const heights = keyResults
            .map((result) => result.blockNumber)
            .filter((height): height is number => typeof height === 'number');
        const blockNumber = heights.length > 0 ? Math.max(...heights) : undefined;
        const scope = config.apiKeys.length === 0
            ? 'keyless'
            : `${config.apiKeys.length} key${config.apiKeys.length === 1 ? '' : 's'}`;

        return {
            ok: failures.length === 0,
            message: failures.length === 0
                ? `Connected to TronGrid (${scope}) — head block ${blockNumber?.toLocaleString() ?? 'unknown'}.`
                : `${failures.length} of ${keyResults.length} probe${keyResults.length === 1 ? '' : 's'} failed (${scope}).`,
            blockNumber,
            keyResults
        };
    }

    /**
     * Issue one head-block call and turn whatever happens into a result row.
     *
     * @param baseUrl - Configured API host.
     * @param timeoutMs - Per-probe timeout: the configured request timeout, capped so an operator-facing test cannot hang past {@link PROBE_TIMEOUT_CAP_MS}.
     * @param apiKey - Raw key to send, or undefined for a keyless probe.
     * @param index - Rotation position being probed, or null when keyless.
     * @param maskedKey - Masked form of the key, for display in the result row.
     * @returns The single-probe outcome; never throws.
     */
    private async probe(
        baseUrl: string,
        timeoutMs: number,
        apiKey: string | undefined,
        index: number | null,
        maskedKey: string
    ): Promise<ITronGridKeyTestResult> {
        const label = index === null ? 'Keyless' : `Key ${index + 1} (${maskedKey})`;
        const headers: Record<string, string> = {};
        if (apiKey) {
            headers[API_KEY_HEADER] = apiKey;
        }
        const startedAt = Date.now();
        let result: ITronGridKeyTestResult;
        try {
            const response = await httpClient.post<ITronGridNowBlockResponse>(
                `${baseUrl}${NOW_BLOCK_PATH}`,
                {},
                { headers, timeout: timeoutMs }
            );
            const latencyMs = Date.now() - startedAt;
            const blockNumber = response.data?.block_header?.raw_data?.number;
            result = typeof blockNumber === 'number'
                ? { index, maskedKey, ok: true, message: `${label}: OK`, latencyMs, blockNumber }
                : {
                    index,
                    maskedKey,
                    ok: false,
                    message: `${label}: TronGrid responded without a block header — check the base URL.`,
                    latencyMs
                };
        } catch (error) {
            const status = (error as { response?: { status?: number } })?.response?.status;
            const detail = status ? ` (HTTP ${status})` : '';
            this.logger.warn({ error, index, status }, 'TronGrid connectivity probe failed');
            result = {
                index,
                maskedKey,
                ok: false,
                message: status === 401 || status === 403
                    ? `${label}: rejected${detail} — the key is invalid or not activated.`
                    : `${label}: request failed${detail}.`
            };
        }
        return result;
    }
}
