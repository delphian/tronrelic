/**
 * @fileoverview Admin notification controller — the global control surface.
 *
 * Powers the `/system/notifications` admin tabs: Categories (enable/disable a
 * category for everyone), Channels (enable/disable a transport globally), and
 * History (the audit feed). Mounted behind `requireAdmin`, so every handler may
 * assume an authorized operator.
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import type { NotificationService } from '../services/notification.service.js';
import type { PolicyService } from '../services/policy.service.js';
import type { AuditService } from '../services/audit.service.js';
import { AUDIT_HISTORY_MAX_LIMIT } from '../config.js';

/**
 * Read/administer notification categories, channels, and audit history.
 */
export class AdminController {
    /**
     * @param notifications - Published service, for the category/channel catalog.
     * @param policy - Admin policy store.
     * @param audit - Audit history store.
     * @param logger - Scoped logger.
     */
    constructor(
        private readonly notifications: NotificationService,
        private readonly policy: PolicyService,
        private readonly audit: AuditService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET `/categories` — every registered category annotated with its current
     * admin enable state.
     */
    getCategories = async (_req: Request, res: Response): Promise<void> => {
        try {
            const policy = await this.policy.get();
            const categories = this.notifications.listCategories().map((c) => ({
                ...c,
                enabled: this.policy.isCategoryEnabled(policy, c.id)
            }));
            res.json({ success: true, categories });
        } catch (error) {
            this.logger.error({ error }, 'Failed to read notification categories');
            res.status(500).json({ success: false, error: 'Failed to read categories' });
        }
    };

    /**
     * PATCH `/categories/:id` — globally enable/disable a category.
     */
    setCategory = async (req: Request, res: Response): Promise<void> => {
        const id = req.params.id;
        const enabled = (req.body ?? {}).enabled;
        if (typeof enabled !== 'boolean') {
            res.status(400).json({ success: false, error: 'enabled must be a boolean' });
            return;
        }
        try {
            const policy = await this.policy.setCategory(id, enabled);
            res.json({ success: true, categoryId: id, enabled: this.policy.isCategoryEnabled(policy, id) });
        } catch (error) {
            this.logger.error({ error, categoryId: id }, 'Failed to update category policy');
            res.status(500).json({ success: false, error: 'Failed to update category' });
        }
    };

    /**
     * GET `/channels` — every registered channel annotated with its current
     * admin enable state.
     */
    getChannels = async (_req: Request, res: Response): Promise<void> => {
        try {
            const policy = await this.policy.get();
            const channels = this.notifications.listChannels().map((c) => ({
                ...c,
                enabled: this.policy.isChannelEnabled(policy, c.id)
            }));
            res.json({ success: true, channels });
        } catch (error) {
            this.logger.error({ error }, 'Failed to read notification channels');
            res.status(500).json({ success: false, error: 'Failed to read channels' });
        }
    };

    /**
     * PATCH `/channels/:id` — globally enable/disable a channel transport.
     */
    setChannel = async (req: Request, res: Response): Promise<void> => {
        const id = req.params.id;
        const enabled = (req.body ?? {}).enabled;
        if (typeof enabled !== 'boolean') {
            res.status(400).json({ success: false, error: 'enabled must be a boolean' });
            return;
        }
        try {
            const policy = await this.policy.setChannel(id, enabled);
            res.json({ success: true, channelId: id, enabled: this.policy.isChannelEnabled(policy, id) });
        } catch (error) {
            this.logger.error({ error, channelId: id }, 'Failed to update channel policy');
            res.status(500).json({ success: false, error: 'Failed to update channel' });
        }
    };

    /**
     * GET `/history` — paginated audit feed, optionally filtered by category or
     * source. Caps the page size so one request cannot scan the whole feed.
     */
    getHistory = async (req: Request, res: Response): Promise<void> => {
        try {
            const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
            const source = typeof req.query.source === 'string' ? req.query.source : undefined;
            const limit = this.parseInt(req.query.limit, 50, 1, AUDIT_HISTORY_MAX_LIMIT);
            const skip = this.parseInt(req.query.skip, 0, 0, Number.MAX_SAFE_INTEGER);

            const { records, total } = await this.audit.query({ categoryId, source, limit, skip });
            res.json({ success: true, records, total });
        } catch (error) {
            this.logger.error({ error }, 'Failed to read notification history');
            res.status(500).json({ success: false, error: 'Failed to read history' });
        }
    };

    /**
     * Parse a query-string integer with a default and clamp bounds, so a
     * malformed `?limit=` never produces NaN or an unbounded scan.
     *
     * @param raw - The raw query value.
     * @param fallback - Default when absent or unparseable.
     * @param min - Lower clamp.
     * @param max - Upper clamp.
     * @returns The clamped integer.
     */
    private parseInt(raw: unknown, fallback: number, min: number, max: number): number {
        const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
        if (!Number.isFinite(n)) {
            return fallback;
        }
        return Math.min(Math.max(n, min), max);
    }
}
