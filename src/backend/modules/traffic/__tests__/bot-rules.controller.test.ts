/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the bot rules admin controller.
 *
 * Checks that each handler returns what the Settings panel expects, that
 * invalid input becomes a 400 carrying the reason, an unknown id a 404, a
 * missing analytics store a 503, and an unexpected failure a 500 without its
 * details.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import { BotRulesController } from '../api/bot-rules.controller.js';
import { BotRuleNotFoundError, type BotRulesService } from '../services/bot-rules.service.js';
import { BotRuleValidationError } from '../services/bot-rule-validation.js';
import type { BotRuleAnalyticsService } from '../services/bot-rule-analytics.service.js';

/**
 * Build a response stub whose `status` chains into `json`, as Express's does.
 *
 * @returns The stub plus the `status` and `json` spies to assert on.
 */
function buildRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
    const json = vi.fn();
    const status = vi.fn();
    const res = { status, json } as unknown as Response;
    status.mockReturnValue(res);
    return { res, status, json };
}

describe('BotRulesController', () => {
    const RULE = { id: 'r1', name: 'AS45102' };
    let rules: Record<string, ReturnType<typeof vi.fn>>;
    let analytics: Record<string, ReturnType<typeof vi.fn>>;
    let controller: BotRulesController;

    beforeEach(() => {
        rules = {
            list: vi.fn().mockResolvedValue([RULE]),
            create: vi.fn().mockResolvedValue(RULE),
            update: vi.fn().mockResolvedValue(RULE),
            remove: vi.fn().mockResolvedValue(true),
            coveredAsns: vi.fn().mockReturnValue(new Set([45102]))
        };
        analytics = {
            stats: vi.fn().mockResolvedValue([{ ruleId: 'r1', matches24h: 3, matches7d: 9, lastMatchedAt: null }]),
            preview: vi.fn().mockResolvedValue({ matchedEvents: 73 }),
            suggestions: vi.fn().mockResolvedValue([])
        };
        const logger = { error: vi.fn() } as unknown as ISystemLogService;
        controller = new BotRulesController(rules as unknown as BotRulesService, analytics as unknown as BotRuleAnalyticsService, logger);
    });

    it('lists rules with their match counts', async () => {
        const { res, json } = buildRes();

        await controller.list({} as Request, res);

        expect(json).toHaveBeenCalledWith({ rules: [RULE], stats: [{ ruleId: 'r1', matches24h: 3, matches7d: 9, lastMatchedAt: null }] });
    });

    it('creates a rule and answers 201', async () => {
        const { res, status, json } = buildRes();

        await controller.create({ body: { name: 'x' } } as Request, res);

        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith({ rule: RULE });
    });

    it('reports invalid input as 400 with the reason', async () => {
        rules.create.mockRejectedValue(new BotRuleValidationError('name is required'));
        const { res, status, json } = buildRes();

        await controller.create({ body: {} } as Request, res);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({ error: 'ValidationError', message: 'name is required' });
    });

    it('reports an unknown rule as 404', async () => {
        rules.update.mockRejectedValue(new BotRuleNotFoundError('missing'));
        const { res, status } = buildRes();

        await controller.update({ params: { id: 'missing' }, body: {} } as unknown as Request, res);

        expect(status).toHaveBeenCalledWith(404);
    });

    it('reports deleting an unknown rule as 404', async () => {
        rules.remove.mockResolvedValue(false);
        const { res, status } = buildRes();

        await controller.remove({ params: { id: 'missing' } } as unknown as Request, res);

        expect(status).toHaveBeenCalledWith(404);
    });

    it('reports an unexpected failure as 500 without its details', async () => {
        rules.list.mockRejectedValue(new Error('connection lost'));
        const { res, status, json } = buildRes();

        await controller.list({} as Request, res);

        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith({ error: 'InternalError', message: 'Failed to list bot rules' });
    });

    it('previews validated conditions over the requested window', async () => {
        const { res, json } = buildRes();

        await controller.preview({ body: { conditions: { asns: ['45102'] }, days: 30 } } as Request, res);

        expect(analytics.preview).toHaveBeenCalledWith({ asns: [45102] }, 30);
        expect(json).toHaveBeenCalledWith({ preview: { matchedEvents: 73 } });
    });

    it('rejects preview conditions that would match most traffic', async () => {
        const { res, status } = buildRes();

        await controller.preview({ body: { conditions: { referrer: 'absent' } } } as Request, res);

        expect(status).toHaveBeenCalledWith(400);
        expect(analytics.preview).not.toHaveBeenCalled();
    });

    it('answers 503 when the analytics store is not configured', async () => {
        analytics.preview.mockResolvedValue(null);
        const { res, status } = buildRes();

        await controller.preview({ body: { conditions: { asns: [45102] } } } as Request, res);

        expect(status).toHaveBeenCalledWith(503);
    });

    it('leaves networks active rules cover out of the suggestions', async () => {
        const { res } = buildRes();

        await controller.suggestions({} as Request, res);

        expect(analytics.suggestions).toHaveBeenCalledWith(new Set([45102]));
    });
});
