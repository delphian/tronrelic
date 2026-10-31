/**
 * @fileoverview Admin controller for bot rules.
 *
 * Lets an operator list, create, edit, and delete the rules that identify
 * automated traffic, preview a rule's conditions against recent traffic before
 * saving, and see networks that look automated but are still counted as human.
 * Admin gating is applied where the router is mounted.
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import { BotRulesService, BotRuleNotFoundError } from '../services/bot-rules.service.js';
import { BotRuleValidationError, validateBotRuleConditions } from '../services/bot-rule-validation.js';
import { BotRuleAnalyticsService, DEFAULT_BOT_RULE_PREVIEW_DAYS } from '../services/bot-rule-analytics.service.js';

/**
 * HTTP handlers for `/api/admin/traffic/bot-rules`.
 */
export class BotRulesController {
    /**
     * @param rules - Rule storage and the in-memory active set.
     * @param analytics - ClickHouse reads for preview, match counts, and suggestions.
     * @param logger - Traffic-module logger, so failures appear on its Logs tab.
     */
    constructor(
        private readonly rules: BotRulesService,
        private readonly analytics: BotRuleAnalyticsService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Send a validation, not-found, or unexpected error with the matching status.
     *
     * @param res - Express response.
     * @param error - The caught error.
     * @param action - What was being attempted, for the log and the 500 message.
     */
    private sendError(res: Response, error: unknown, action: string): void {
        if (error instanceof BotRuleValidationError) {
            res.status(400).json({ error: 'ValidationError', message: error.message });
        } else if (error instanceof BotRuleNotFoundError) {
            res.status(404).json({ error: 'NotFound', message: error.message });
        } else {
            this.logger.error({ err: error }, `Failed to ${action}`);
            res.status(500).json({ error: 'InternalError', message: `Failed to ${action}` });
        }
    }

    /**
     * GET /api/admin/traffic/bot-rules
     * Return every rule with its recent match counts, so the Settings panel can
     * show what each rule is doing in one request.
     *
     * @param _req - Express request (unused).
     * @param res - Express response carrying `{ rules, stats }`.
     */
    async list(_req: Request, res: Response): Promise<void> {
        try {
            const [rules, stats] = await Promise.all([this.rules.list(), this.analytics.stats()]);
            res.json({ rules, stats });
        } catch (error) {
            this.sendError(res, error, 'list bot rules');
        }
    }

    /**
     * POST /api/admin/traffic/bot-rules  Body: `IBotRuleInput`.
     * Create a rule. It takes effect for the next event recorded.
     *
     * @param req - Express request whose body carries the rule.
     * @param res - Express response carrying `{ rule }`.
     */
    async create(req: Request, res: Response): Promise<void> {
        try {
            res.status(201).json({ rule: await this.rules.create(req.body) });
        } catch (error) {
            this.sendError(res, error, 'create bot rule');
        }
    }

    /**
     * PUT /api/admin/traffic/bot-rules/:id  Body: `IBotRuleInput`.
     * Replace a rule's editable fields.
     *
     * @param req - Express request whose `:id` names the rule and body carries the new fields.
     * @param res - Express response carrying `{ rule }`.
     */
    async update(req: Request, res: Response): Promise<void> {
        try {
            res.json({ rule: await this.rules.update(String(req.params.id), req.body) });
        } catch (error) {
            this.sendError(res, error, 'update bot rule');
        }
    }

    /**
     * DELETE /api/admin/traffic/bot-rules/:id
     * Delete a rule. Events it already labeled keep their label.
     *
     * @param req - Express request whose `:id` names the rule.
     * @param res - Express response carrying `{ success: true }`, or 404.
     */
    async remove(req: Request, res: Response): Promise<void> {
        try {
            const id = String(req.params.id);
            if (await this.rules.remove(id)) {
                res.json({ success: true });
            } else {
                this.sendError(res, new BotRuleNotFoundError(id), 'delete bot rule');
            }
        } catch (error) {
            this.sendError(res, error, 'delete bot rule');
        }
    }

    /**
     * POST /api/admin/traffic/bot-rules/preview  Body: `{ conditions, days? }`.
     * Report what the conditions would have matched over a recent window,
     * without saving anything. 503 when the analytics store is not configured.
     *
     * @param req - Express request whose body carries the conditions and window.
     * @param res - Express response carrying `{ preview }`.
     */
    async preview(req: Request, res: Response): Promise<void> {
        try {
            const body = (req.body ?? {}) as Record<string, unknown>;
            const conditions = validateBotRuleConditions(body.conditions);
            const days = typeof body.days === 'number' ? body.days : DEFAULT_BOT_RULE_PREVIEW_DAYS;
            const preview = await this.analytics.preview(conditions, days);
            if (preview) {
                res.json({ preview });
            } else {
                res.status(503).json({ error: 'Unavailable', message: 'The analytics store (ClickHouse) is not configured' });
            }
        } catch (error) {
            this.sendError(res, error, 'preview bot rule');
        }
    }

    /**
     * GET /api/admin/traffic/bot-rules/suggestions
     * List networks whose recent traffic looks automated but is still counted
     * as human, leaving out networks an active rule already names.
     *
     * @param _req - Express request (unused).
     * @param res - Express response carrying `{ suggestions }`.
     */
    async suggestions(_req: Request, res: Response): Promise<void> {
        try {
            res.json({ suggestions: await this.analytics.suggestions(this.rules.coveredAsns()) });
        } catch (error) {
            this.sendError(res, error, 'load bot rule suggestions');
        }
    }
}
