/**
 * @fileoverview Admin HTTP layer for tag-source operations: source status,
 * manual runs, per-address screening, and the write-only settings surface.
 *
 * Thin wrapper by design — envelope validation here, all behaviour in
 * `TagIngestionService`. Mounted behind the same `createAdminRateLimiter` +
 * `requireAdmin` stack as the tag-mutation routes, so no new gating is
 * introduced. The one rule enforced at this layer by construction: nothing
 * these handlers return can contain the Chainalysis API key, because the
 * ingestion service's read side never surfaces it.
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import type { IAddressTagsSettingsUpdate, TagIngestionService } from '../services/tag-ingestion.service.js';

/** Base58 TRON address shape, mirrored from the service's validation. */
const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/**
 * Controller exposing source status, runs, screening, and settings.
 */
export class AddressTagsSourcesController {
    /**
     * @param ingestion - The ingestion service all handlers delegate to.
     * @param logger - Module-scoped logger for failure diagnostics.
     */
    constructor(
        private readonly ingestion: TagIngestionService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /sources — per-source status: last run, last error, cursor, and the
     * counts from the most recent reconcile. The panel this feeds exists so a
     * silently failing feed cannot look identical to a clean one.
     */
    getSources = async (_req: Request, res: Response): Promise<void> => {
        try {
            res.json({ sources: await this.ingestion.getStatuses() });
        } catch (error) {
            this.fail(res, error, 'Failed to load tag source statuses');
        }
    };

    /**
     * POST /sources/:id/run — run one source now, for testing and recovery.
     * Deliberately ignores the enable switch (that gates scheduled runs), and
     * awaits the run so the operator gets the reconcile counts back — the OFAC
     * download can take a minute, which an admin action can afford.
     */
    runSource = async (req: Request, res: Response): Promise<void> => {
        try {
            res.json({ result: await this.ingestion.runSource(String(req.params.id)) });
        } catch (error) {
            this.fail(res, error, 'Failed to run tag source');
        }
    };

    /**
     * POST /screen — screen one address through Chainalysis on demand. Body:
     * `{ address: string }`. The address shape is checked here so an obvious
     * typo fails before spending a call against the API's rate limit.
     */
    screen = async (req: Request, res: Response): Promise<void> => {
        try {
            const address = typeof req.body?.address === 'string' ? req.body.address.trim() : '';
            if (!TRON_ADDRESS_PATTERN.test(address)) {
                res.status(400).json({ error: 'Body must be { address } with a base58 TRON address' });
                return;
            }
            res.json({ result: await this.ingestion.screenAddress(address) });
        } catch (error) {
            this.fail(res, error, 'Failed to screen address');
        }
    };

    /**
     * GET /settings — source configuration. Reports whether a Chainalysis key
     * is configured and its last four characters, never the key: the read and
     * write sides of this surface are asymmetric on purpose.
     */
    getSettings = async (_req: Request, res: Response): Promise<void> => {
        try {
            res.json({ settings: await this.ingestion.getSettings() });
        } catch (error) {
            this.fail(res, error, 'Failed to load address-tags settings');
        }
    };

    /**
     * PUT /settings — write source configuration, including the key. Body is a
     * partial `{ chainalysis?: { apiKey?, enabled? }, sources?: { [id]: { enabled? } } }`;
     * the response is the post-update settings with the key redacted as always.
     */
    putSettings = async (req: Request, res: Response): Promise<void> => {
        try {
            const update = this.parseSettingsUpdate(req.body);
            if (!update) {
                res.status(400).json({ error: 'Body must be { chainalysis?: { apiKey?, enabled? }, sources?: { [id]: { enabled? } } }' });
                return;
            }
            res.json({ settings: await this.ingestion.updateSettings(update) });
        } catch (error) {
            this.fail(res, error, 'Failed to update address-tags settings');
        }
    };

    /**
     * Envelope check for the settings update: reject anything whose fields are
     * present but mistyped, so a malformed client cannot half-apply.
     *
     * @param body - Raw request body.
     * @returns The typed update, or null when structurally invalid.
     */
    private parseSettingsUpdate(body: unknown): IAddressTagsSettingsUpdate | null {
        if (typeof body !== 'object' || body === null) {
            return null;
        }
        const raw = body as Record<string, unknown>;
        const update: IAddressTagsSettingsUpdate = {};
        if (raw.chainalysis !== undefined) {
            if (typeof raw.chainalysis !== 'object' || raw.chainalysis === null) {
                return null;
            }
            const chainalysis = raw.chainalysis as Record<string, unknown>;
            update.chainalysis = {};
            if ('apiKey' in chainalysis) {
                if (chainalysis.apiKey !== null && typeof chainalysis.apiKey !== 'string') {
                    return null;
                }
                update.chainalysis.apiKey = chainalysis.apiKey as string | null;
            }
            if ('enabled' in chainalysis) {
                if (typeof chainalysis.enabled !== 'boolean') {
                    return null;
                }
                update.chainalysis.enabled = chainalysis.enabled;
            }
        }
        if (raw.sources !== undefined) {
            if (typeof raw.sources !== 'object' || raw.sources === null) {
                return null;
            }
            update.sources = {};
            for (const [id, config] of Object.entries(raw.sources as Record<string, unknown>)) {
                if (typeof config !== 'object' || config === null) {
                    return null;
                }
                const enabled = (config as Record<string, unknown>).enabled;
                if (enabled !== undefined && typeof enabled !== 'boolean') {
                    return null;
                }
                update.sources[id] = typeof enabled === 'boolean' ? { enabled } : {};
            }
        }
        return update;
    }

    /**
     * Map known operational errors to 400/409 and everything else to 500. The
     * "already running" case is a conflict, not a failure — the admin clicked
     * twice or raced a scheduled tick.
     *
     * @param res - Response to write the failure to.
     * @param error - The thrown error.
     * @param message - Log line describing which handler failed.
     */
    private fail(res: Response, error: unknown, message: string): void {
        const text = error instanceof Error ? error.message : 'Unknown error';
        if (/already running/.test(text)) {
            res.status(409).json({ error: text });
            return;
        }
        if (/^Unknown tag source|^No Chainalysis API key|^Chainalysis screening is disabled|is a per-address lookup|does not support/.test(text)) {
            res.status(400).json({ error: text });
            return;
        }
        this.logger.error({ error }, message);
        res.status(500).json({ error: `${message}: ${text}` });
    }
}
