/**
 * HTTP controller for admin-managed URL redirects.
 *
 * Exposes one public read (`GET /api/redirects`) that the Next.js edge
 * middleware polls to learn the active redirect map, plus the admin CRUD the
 * `/system/traffic` management UI drives. The public read is deliberately
 * unauthenticated: the middleware fetches it server-to-server before any auth
 * context exists, exactly like the public bootstrap ingestion endpoint.
 *
 * Handlers mirror the traffic module's conventions — try/catch every handler,
 * log failures via `this.logger.error({ err }, '...')`, and translate service
 * errors into precise status codes (400 validation, 404 missing, 409 duplicate
 * pattern, 500 unexpected).
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import {
    RedirectService,
    RedirectValidationError,
    RedirectNotFoundError
} from '../services/redirect.service.js';

/**
 * Seconds any intermediary (CDN) may cache the public redirect feed. Matches
 * the middleware's own refresh cadence, so a freshly-added rule goes live in at
 * most this long regardless of caching layer.
 */
const PUBLIC_FEED_MAX_AGE_SECONDS = 60;

/**
 * Routes redirect reads/writes to `RedirectService`.
 */
export class RedirectsController {
    /**
     * @param redirectService - The redirect storage/validation service.
     * @param logger - Scoped logger for handler-level failure diagnostics.
     */
    constructor(
        private readonly redirectService: RedirectService,
        private readonly logger: ISystemLogService
    ) { }

    /**
     * Public read consumed by the edge middleware. Emits only enabled rules in
     * the minimal four-field shape, with a short cache window so a CDN in front
     * of the origin cannot pin a stale map longer than the middleware would.
     *
     * @param _req - Unused; the feed is identical for every caller.
     * @param res - Express response carrying `{ rules }`.
     */
    async getPublicRedirects(_req: Request, res: Response): Promise<void> {
        try {
            const rules = await this.redirectService.getActiveRules();
            res.set('Cache-Control', `public, max-age=${PUBLIC_FEED_MAX_AGE_SECONDS}`);
            res.json({ rules });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to serve public redirect feed');
            res.status(500).json({ error: 'InternalError', message: 'Failed to load redirects' });
        }
    }

    /**
     * Admin list of every rule (enabled and disabled) for the management table.
     *
     * @param _req - Unused.
     * @param res - Express response carrying `{ rules }` in admin shape.
     */
    async listRedirects(_req: Request, res: Response): Promise<void> {
        try {
            const rules = await this.redirectService.listRules();
            res.json({ rules });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to list redirect rules');
            res.status(500).json({ error: 'InternalError', message: 'Failed to list redirects' });
        }
    }

    /**
     * Create a rule from the admin form. Requires string `pattern` and
     * `destination`; the service applies the deeper same-site/loop validation.
     *
     * @param req - Express request; body carries the rule fields.
     * @param res - Express response carrying the created rule (201).
     */
    async createRedirect(req: Request, res: Response): Promise<void> {
        const { pattern, destination, isPrefix, permanent, enabled, notes } = req.body ?? {};
        if (typeof pattern !== 'string' || typeof destination !== 'string') {
            res.status(400).json({ error: 'ValidationError', message: 'pattern and destination are required strings' });
            return;
        }
        try {
            const rule = await this.redirectService.createRule({ pattern, destination, isPrefix, permanent, enabled, notes });
            res.status(201).json(rule);
        } catch (error) {
            this.respondError(res, error, 'create');
        }
    }

    /**
     * Patch an existing rule. Only supplied fields change; the service
     * re-validates the merged result.
     *
     * @param req - Express request; `params.id` selects the rule, body carries changes.
     * @param res - Express response carrying the updated rule.
     */
    async updateRedirect(req: Request, res: Response): Promise<void> {
        const { id } = req.params;
        const { pattern, destination, isPrefix, permanent, enabled, notes } = req.body ?? {};
        try {
            const rule = await this.redirectService.updateRule(id, { pattern, destination, isPrefix, permanent, enabled, notes });
            res.json(rule);
        } catch (error) {
            this.respondError(res, error, 'update');
        }
    }

    /**
     * Delete a rule.
     *
     * @param req - Express request; `params.id` selects the rule.
     * @param res - Express response (204 on success).
     */
    async deleteRedirect(req: Request, res: Response): Promise<void> {
        const { id } = req.params;
        try {
            await this.redirectService.deleteRule(id);
            res.status(204).end();
        } catch (error) {
            this.respondError(res, error, 'delete');
        }
    }

    /**
     * Translate a thrown service error into the right status code. Validation
     * problems are 400, a missing rule 404, a duplicate `pattern` (Mongo
     * E11000) 409, and anything unexpected 500 with the failure logged.
     *
     * @param res - Express response to write.
     * @param error - The thrown value from the service call.
     * @param action - Verb for the log line (create/update/delete).
     */
    private respondError(res: Response, error: unknown, action: string): void {
        if (error instanceof RedirectValidationError) {
            res.status(400).json({ error: 'ValidationError', message: error.message });
            return;
        }
        if (error instanceof RedirectNotFoundError) {
            res.status(404).json({ error: 'NotFound', message: error.message });
            return;
        }
        if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) {
            res.status(409).json({ error: 'Conflict', message: 'A redirect for this pattern already exists' });
            return;
        }
        this.logger.error({ err: error }, `Failed to ${action} redirect rule`);
        res.status(500).json({ error: 'InternalError', message: `Failed to ${action} redirect` });
    }
}
