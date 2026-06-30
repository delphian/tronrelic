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
import { ProviderConfigService } from '../services/provider-config.service.js';
import { TronScanClient } from '../clients/tron-scan.client.js';
import { CLEAR_SENTINEL, type ITronScanProviderConfig } from '../database/index.js';

/**
 * Controller for `/api/admin/system/providers/*`. Stateless beyond its injected
 * collaborators; one instance is mounted by the module.
 */
export class ProvidersController {
    private readonly configService: ProviderConfigService;
    private readonly tronScanClient: TronScanClient;
    private readonly logger: ISystemLogService;

    /**
     * @param configService - DB-backed provider config (masked reads, guarded writes).
     * @param tronScanClient - TronScan transport, used by the connectivity test.
     * @param logger - Child logger for request diagnostics.
     */
    constructor(
        configService: ProviderConfigService,
        tronScanClient: TronScanClient,
        logger: ISystemLogService
    ) {
        this.configService = configService;
        this.tronScanClient = tronScanClient;
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
     * @param res - JSON `{ success, config }` with the new masked config.
     */
    updateTronScanConfig = async (req: Request, res: Response): Promise<void> => {
        try {
            const body = (req.body ?? {}) as Record<string, unknown>;
            const updates: Partial<ITronScanProviderConfig> = {};

            if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
                // Strip trailing slashes so the client's `${baseUrl}${path}` join
                // can't produce a double-slash path (e.g. `//api/trx/volume`) from
                // an operator pasting a URL with a trailing `/`.
                updates.baseUrl = body.baseUrl.trim().replace(/\/+$/, '');
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
}
