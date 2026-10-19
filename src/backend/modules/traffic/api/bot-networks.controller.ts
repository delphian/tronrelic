/**
 * @fileoverview Admin controller for the automated-network list.
 *
 * Lets an operator view, add, and remove the networks (by ASN) whose traffic
 * the classifier labels `bot_other`. Every handler returns the full updated
 * list, so the Settings panel never needs a follow-up fetch. Admin gating is
 * applied where the router is mounted.
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import { BotNetworksService, BotNetworkValidationError } from '../services/bot-networks.service.js';
import { parseAsn } from '../services/traffic.service.js';

/**
 * HTTP handlers for `/api/admin/traffic/bot-networks`.
 */
export class BotNetworksController {
    /**
     * @param botNetworksService - The list's storage and cache.
     * @param logger - Traffic-module logger, so failures appear on its Logs tab.
     */
    constructor(
        private readonly botNetworksService: BotNetworksService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /api/admin/traffic/bot-networks
     * Return the listed networks, so the panel can show what is being labeled.
     *
     * @param _req - Express request (unused).
     * @param res - Express response carrying `{ networks }`.
     */
    async list(_req: Request, res: Response): Promise<void> {
        try {
            res.json({ networks: await this.botNetworksService.list() });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to list automated networks');
            res.status(500).json({ error: 'InternalError', message: 'Failed to list automated networks' });
        }
    }

    /**
     * POST /api/admin/traffic/bot-networks  Body: { asn, note? }.
     * Add a network so its future traffic is labeled `bot_other`. An invalid
     * ASN is reported as 400 with the reason rather than as a server error.
     *
     * @param req - Express request whose body carries the ASN and optional note.
     * @param res - Express response carrying the updated `{ networks }`.
     */
    async add(req: Request, res: Response): Promise<void> {
        const body = (req.body ?? {}) as Record<string, unknown>;
        try {
            await this.botNetworksService.add({ asn: body.asn, note: body.note });
            res.json({ networks: await this.botNetworksService.list() });
        } catch (error) {
            if (error instanceof BotNetworkValidationError) {
                res.status(400).json({ error: 'ValidationError', message: error.message });
            } else {
                this.logger.error({ err: error }, 'Failed to add automated network');
                res.status(500).json({ error: 'InternalError', message: 'Failed to add automated network' });
            }
        }
    }

    /**
     * DELETE /api/admin/traffic/bot-networks/:asn
     * Remove a network so its future traffic is classified normally again.
     *
     * @param req - Express request whose `:asn` parameter names the network.
     * @param res - Express response carrying the updated `{ networks }`.
     */
    async remove(req: Request, res: Response): Promise<void> {
        const asn = parseAsn(typeof req.params.asn === 'string' ? req.params.asn : undefined);
        if (asn === null) {
            res.status(400).json({ error: 'ValidationError', message: 'asn must be a whole number between 1 and 4294967295' });
            return;
        }
        try {
            await this.botNetworksService.remove(asn);
            res.json({ networks: await this.botNetworksService.list() });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to remove automated network');
            res.status(500).json({ error: 'InternalError', message: 'Failed to remove automated network' });
        }
    }
}
