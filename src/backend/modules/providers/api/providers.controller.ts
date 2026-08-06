/**
 * @fileoverview Admin HTTP handlers for external-provider configuration.
 *
 * Why these guards matter: the TronScan API key is a secret. GET returns only the
 * masked view, and the save handler refuses to persist a re-echoed mask (so a
 * round-trip of the masked value can never overwrite the real key with `****…`),
 * while honouring an explicit clear sentinel. The test handler exercises a live
 * TronScan call so an operator can confirm a pasted key works before relying on
 * it for ingestion.
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import { ProviderConfigService, ProviderConfigValidationError } from '../services/provider-config.service.js';
import { TronScanClient } from '../clients/tron-scan.client.js';
import { TronGridProviderClient } from '../clients/tron-grid.client.js';
import {
    CLEAR_SENTINEL,
    TRONGRID_LIMITS,
    type ITronScanProviderConfig,
    type ITronGridProviderConfig
} from '../database/index.js';

/**
 * Coerce a request-body value into an integer inside an inclusive range.
 *
 * Why reject rather than clamp: these are pacing controls an operator types by
 * hand, and silently rewriting 20000 to 10000 would leave the form showing a
 * number the backend never agreed to. Out-of-range input comes back as an error
 * the field can display.
 *
 * The type gate matters as much as the bounds. A bare `Number(value)` turns
 * `null`, `true`, `''`, and `[]` into finite integers, so `requestThrottleMs:
 * null` would pass the `{min: 0}` bound and silently persist "no pacing at all"
 * behind a 200 response. Only a real number — or a non-empty numeric string, so
 * a hand-written `curl` call still works — is accepted.
 *
 * @param value - Raw value from the JSON body.
 * @param bounds - Inclusive min/max the field accepts.
 * @returns The integer, or undefined when the value is absent or unusable.
 */
function readBoundedInteger(value: unknown, bounds: { min: number; max: number }): number | undefined {
    let numeric: number;
    if (typeof value === 'number') {
        numeric = value;
    } else if (typeof value === 'string' && value.trim()) {
        numeric = Number(value);
    } else {
        return undefined;
    }
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
        return undefined;
    }
    if (numeric < bounds.min || numeric > bounds.max) {
        return undefined;
    }
    return numeric;
}

/**
 * Validate an operator-supplied base URL and strip its trailing slashes so a
 * client's `${baseUrl}${path}` join cannot produce a double slash.
 *
 * The shape check is a security control, not a typo guard. Whatever is stored
 * here becomes the host these clients hand their stored credentials to — the
 * TronGrid probe puts every key in the pool into a `TRON-PRO-API-KEY` header —
 * so accepting an arbitrary string turns a config write into a key-exfiltration
 * primitive and the test button into a blind network probe. Demanding an
 * absolute `http:`/`https:` URL with a host closes the scheme half of that
 * (`javascript:`, `file:`, bare hostnames). It deliberately does *not* restrict
 * which host: pointing the client at a private full node is a supported
 * deployment, so what still guards the destination is the admin gate on the
 * route, not this function.
 *
 * The trailing-slash trim is a linear scan rather than a `/\/+$/` regex, which
 * CodeQL flags as a polynomial-ReDoS risk on user-provided input.
 *
 * @param raw - The URL as typed.
 * @returns The normalized URL, or null when it is not a usable absolute HTTP(S) URL.
 */
function normalizeBaseUrl(raw: string): string | null {
    const trimmed = raw.trim();
    let sliceEnd = trimmed.length;
    while (sliceEnd > 0 && trimmed[sliceEnd - 1] === '/') {
        sliceEnd -= 1;
    }
    const candidate = trimmed.slice(0, sliceEnd);
    if (!candidate) {
        return null;
    }
    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        return null;
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
        return null;
    }
    return candidate;
}

/** Rejection message for a base URL that is not an absolute HTTP(S) URL. */
const INVALID_BASE_URL_MESSAGE = 'baseUrl must be an absolute http:// or https:// URL, for example https://api.trongrid.io';

/**
 * Controller for `/api/admin/system/providers/*`. Stateless beyond its injected
 * collaborators; one instance is mounted by the module.
 */
export class ProvidersController {
    private readonly configService: ProviderConfigService;
    private readonly tronScanClient: TronScanClient;
    private readonly tronGridClient: TronGridProviderClient;
    private readonly logger: ISystemLogService;

    /**
     * @param configService - DB-backed provider config (masked reads, guarded writes).
     * @param tronScanClient - TronScan transport, used by the connectivity test.
     * @param tronGridClient - TronGrid transport for the staged config's connectivity test.
     * @param logger - Child logger for request diagnostics.
     */
    constructor(
        configService: ProviderConfigService,
        tronScanClient: TronScanClient,
        tronGridClient: TronGridProviderClient,
        logger: ISystemLogService
    ) {
        this.configService = configService;
        this.tronScanClient = tronScanClient;
        this.tronGridClient = tronGridClient;
        this.logger = logger;
    }

    /**
     * GET /tronscan — return the masked TronScan config for the admin form.
     *
     * @param _req - Unused.
     * @param res - JSON `{ success, config }` with the key masked.
     */
    getTronScanConfig = async (_req: Request, res: Response): Promise<void> => {
        try {
            const config = await this.configService.getMaskedTronScanConfig();
            res.json({ success: true, config });
        } catch (error) {
            this.logger.error({ error }, 'Failed to read TronScan provider config');
            res.status(500).json({ success: false, error: 'Failed to read provider config' });
        }
    };

    /**
     * PUT /tronscan — persist a partial config update. The `apiKey` field is
     * sanitised here: a masked echo (`****…`) is ignored, the clear sentinel empties
     * the key, and any other non-empty string sets a new key.
     *
     * @param req - Body with optional `apiKey`, `baseUrl`, `priceSource`, `enabled`.
     * @param res - JSON `{ success, config }` with the new masked config, or 400 when the base URL is malformed.
     */
    updateTronScanConfig = async (req: Request, res: Response): Promise<void> => {
        try {
            const body = (req.body ?? {}) as Record<string, unknown>;
            const updates: Partial<ITronScanProviderConfig> = {};

            if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
                const normalizedBaseUrl = normalizeBaseUrl(body.baseUrl);
                if (!normalizedBaseUrl) {
                    res.status(400).json({ success: false, error: INVALID_BASE_URL_MESSAGE });
                    return;
                }
                updates.baseUrl = normalizedBaseUrl;
            }
            if (body.priceSource === 'coinmarketcap' || body.priceSource === 'coingecko') {
                updates.priceSource = body.priceSource;
            }
            if (typeof body.enabled === 'boolean') {
                updates.enabled = body.enabled;
            }
            if (typeof body.apiKey === 'string') {
                const trimmed = body.apiKey.trim();
                if (trimmed === CLEAR_SENTINEL) {
                    updates.apiKey = '';
                } else if (trimmed && !trimmed.startsWith('****')) {
                    updates.apiKey = trimmed;
                }
                // A masked echo or empty string leaves the stored key untouched.
            }

            const config = await this.configService.saveTronScanConfig(updates);
            res.json({ success: true, config });
        } catch (error) {
            this.logger.error({ error }, 'Failed to update TronScan provider config');
            res.status(500).json({ success: false, error: 'Failed to update provider config' });
        }
    };

    /**
     * POST /tronscan/test — run a live connectivity/credential check and return the
     * structured outcome. Never 500s on an upstream failure: a failed test is a
     * `200` with `result.ok === false` so the form can render the reason inline.
     *
     * @param _req - Unused.
     * @param res - JSON `{ success, result }` where `result` carries ok/message/latency.
     */
    testTronScan = async (_req: Request, res: Response): Promise<void> => {
        try {
            const result = await this.tronScanClient.testConnection();
            res.json({ success: result.ok, result });
        } catch (error) {
            this.logger.error({ error }, 'TronScan provider test threw unexpectedly');
            res.status(500).json({ success: false, error: 'Provider test failed' });
        }
    };

    /**
     * GET /trongrid — return the masked TronGrid config for the admin form.
     *
     * @param _req - Unused.
     * @param res - JSON `{ success, config }` with every key masked.
     */
    getTronGridConfig = async (_req: Request, res: Response): Promise<void> => {
        try {
            const config = await this.configService.getMaskedTronGridConfig();
            res.json({ success: true, config });
        } catch (error) {
            this.logger.error({ error }, 'Failed to read TronGrid provider config');
            res.status(500).json({ success: false, error: 'Failed to read provider config' });
        }
    };

    /**
     * PUT /trongrid — persist the non-secret fields. API keys are not accepted
     * here; they are added and removed through the dedicated key endpoints so a
     * masked value can never be written back over a real one.
     *
     * @param req - Body with optional `enabled`, `baseUrl`, `requestThrottleMs`, `maxQueueSize`, `requestTimeoutMs`.
     * @param res - JSON `{ success, config }` with the new masked config, or 400 listing every field that was refused.
     */
    updateTronGridConfig = async (req: Request, res: Response): Promise<void> => {
        try {
            const body = (req.body ?? {}) as Record<string, unknown>;
            const updates: Partial<Omit<ITronGridProviderConfig, 'apiKeys'>> = {};

            // Present-but-unusable is an operator error worth reporting; absent is
            // simply a field this request does not change.
            const rejected: string[] = [];

            if (typeof body.enabled === 'boolean') {
                updates.enabled = body.enabled;
            }
            if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
                const normalizedBaseUrl = normalizeBaseUrl(body.baseUrl);
                if (normalizedBaseUrl) {
                    updates.baseUrl = normalizedBaseUrl;
                } else {
                    rejected.push(INVALID_BASE_URL_MESSAGE);
                }
            }

            const throttle = readBoundedInteger(body.requestThrottleMs, TRONGRID_LIMITS.requestThrottleMs);
            const queueSize = readBoundedInteger(body.maxQueueSize, TRONGRID_LIMITS.maxQueueSize);
            const timeout = readBoundedInteger(body.requestTimeoutMs, TRONGRID_LIMITS.requestTimeoutMs);

            if (body.requestThrottleMs !== undefined && throttle === undefined) {
                rejected.push(
                    `requestThrottleMs must be a whole number between ${TRONGRID_LIMITS.requestThrottleMs.min} and ${TRONGRID_LIMITS.requestThrottleMs.max}`
                );
            }
            if (body.maxQueueSize !== undefined && queueSize === undefined) {
                rejected.push(
                    `maxQueueSize must be a whole number between ${TRONGRID_LIMITS.maxQueueSize.min} and ${TRONGRID_LIMITS.maxQueueSize.max}`
                );
            }
            if (body.requestTimeoutMs !== undefined && timeout === undefined) {
                rejected.push(
                    `requestTimeoutMs must be a whole number between ${TRONGRID_LIMITS.requestTimeoutMs.min} and ${TRONGRID_LIMITS.requestTimeoutMs.max}`
                );
            }
            if (rejected.length > 0) {
                res.status(400).json({ success: false, error: rejected.join('; ') });
                return;
            }

            if (throttle !== undefined) {
                updates.requestThrottleMs = throttle;
            }
            if (queueSize !== undefined) {
                updates.maxQueueSize = queueSize;
            }
            if (timeout !== undefined) {
                updates.requestTimeoutMs = timeout;
            }

            const config = await this.configService.saveTronGridConfig(updates);
            res.json({ success: true, config });
        } catch (error) {
            this.logger.error({ error }, 'Failed to update TronGrid provider config');
            res.status(500).json({ success: false, error: 'Failed to update provider config' });
        }
    };

    /**
     * POST /trongrid/keys — append a key to the rotation pool.
     *
     * @param req - Body with `apiKey`.
     * @param res - JSON `{ success, config }`, or 400 with the reason the key was refused.
     */
    addTronGridApiKey = async (req: Request, res: Response): Promise<void> => {
        try {
            const body = (req.body ?? {}) as Record<string, unknown>;
            if (typeof body.apiKey !== 'string') {
                res.status(400).json({ success: false, error: 'An API key is required.' });
                return;
            }
            const config = await this.configService.addTronGridApiKey(body.apiKey);
            res.json({ success: true, config });
        } catch (error) {
            if (error instanceof ProviderConfigValidationError) {
                res.status(400).json({ success: false, error: error.message });
                return;
            }
            this.logger.error({ error }, 'Failed to add TronGrid API key');
            res.status(500).json({ success: false, error: 'Failed to add API key' });
        }
    };

    /**
     * DELETE /trongrid/keys/:index — drop the key at a rotation position. The UI
     * only ever holds masked values, so position is the shared handle.
     *
     * @param req - Route param `index` (zero-based).
     * @param res - JSON `{ success, config }`, or 400 when no key occupies that position.
     */
    removeTronGridApiKey = async (req: Request, res: Response): Promise<void> => {
        try {
            const index = Number(req.params.index);
            const config = await this.configService.removeTronGridApiKey(index);
            res.json({ success: true, config });
        } catch (error) {
            if (error instanceof ProviderConfigValidationError) {
                res.status(400).json({ success: false, error: error.message });
                return;
            }
            this.logger.error({ error }, 'Failed to remove TronGrid API key');
            res.status(500).json({ success: false, error: 'Failed to remove API key' });
        }
    };

    /**
     * POST /trongrid/test — probe the saved TronGrid config, one call per stored
     * key. Never 500s on an upstream failure: a failed probe is a `200` with
     * `result.ok === false` so the form can render the reason per key.
     *
     * @param _req - Unused.
     * @param res - JSON `{ success, result }` carrying the aggregate and per-key outcomes.
     */
    testTronGrid = async (_req: Request, res: Response): Promise<void> => {
        try {
            const result = await this.tronGridClient.testConnection();
            res.json({ success: result.ok, result });
        } catch (error) {
            this.logger.error({ error }, 'TronGrid provider test threw unexpectedly');
            res.status(500).json({ success: false, error: 'Provider test failed' });
        }
    };
}
