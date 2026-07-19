/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the redirect-hit ingestion + analytics handlers
 * on RedirectsController.
 *
 * The hit endpoint is public and unauthenticated (the edge middleware fires it
 * server-to-server), so these tests pin the defensive contract: reject a body
 * missing its required fields, otherwise clamp/classify and dispatch exactly one
 * fire-and-forget write, always answering `{ success: true }`. The analytics
 * handler is verified to pass the resolved window + bot filter straight through.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import type { RedirectService } from '../services/redirect.service.js';
import type { TrafficService } from '../services/traffic.service.js';
import { RedirectsController } from '../api/redirects.controller.js';

/**
 * Build an Express request double with sensible empty defaults.
 *
 * @param overrides - Fields to set (body, headers, query).
 * @returns A minimal Request.
 */
function buildReq(overrides: Partial<Request> = {}): Request {
    return { body: {}, query: {}, headers: {}, ...overrides } as unknown as Request;
}

/**
 * Build an Express response double capturing status + json.
 *
 * @returns The response plus its status/json spies.
 */
function buildRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
    const json = vi.fn();
    const status = vi.fn().mockReturnThis();
    const res = { status, json } as unknown as Response;
    return { res, status, json };
}

describe('RedirectsController redirect analytics', () => {
    let recordRedirectHit: ReturnType<typeof vi.fn>;
    let getRedirectAnalytics: ReturnType<typeof vi.fn>;
    let getActiveRules: ReturnType<typeof vi.fn>;
    let controller: RedirectsController;

    beforeEach(() => {
        recordRedirectHit = vi.fn();
        getRedirectAnalytics = vi.fn();
        // Default active-rule set the beacon's pattern is matched against.
        getActiveRules = vi.fn().mockResolvedValue([
            { pattern: '/tron-forum', isPrefix: true, destination: '/forum', permanent: true },
            { pattern: '/a', isPrefix: true, destination: '/b', permanent: false }
        ]);
        const redirectService = { getActiveRules } as unknown as RedirectService;
        const trafficService = { recordRedirectHit, getRedirectAnalytics } as unknown as TrafficService;
        const logger = { error: vi.fn() } as unknown as ISystemLogService;
        controller = new RedirectsController(redirectService, trafficService, logger);
    });

    describe('recordHit()', () => {
        it('400s and records nothing when pattern is missing', async () => {
            const req = buildReq({ body: { destination: '/forum' } });
            const { res, status, json } = buildRes();

            await controller.recordHit(req, res);

            expect(status).toHaveBeenCalledWith(400);
            expect(recordRedirectHit).not.toHaveBeenCalled();
            expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'ValidationError' }));
        });

        it('drops (records nothing, still 200) a beacon whose pattern is not an active rule', async () => {
            const req = buildReq({ body: { pattern: '/forged', destination: '/evil' } });
            const { res, json } = buildRes();

            await controller.recordHit(req, res);

            expect(recordRedirectHit).not.toHaveBeenCalled();
            expect(json).toHaveBeenCalledWith({ success: true });
        });

        it('records a matched beacon, sourcing destination/permanent from the rule', async () => {
            const req = buildReq({
                // Body destination/permanent are deliberately wrong — they must be ignored.
                body: { pattern: '/tron-forum', destination: '/attacker', permanent: false, path: '/tron-forum/thread/9?ref=x' },
                headers: { 'user-agent': 'Mozilla/5.0', 'cf-ipcountry': 'US' }
            });
            const { res, json } = buildRes();

            await controller.recordHit(req, res);

            expect(recordRedirectHit).toHaveBeenCalledTimes(1);
            const hit = recordRedirectHit.mock.calls[0][0];
            expect(hit.pattern).toBe('/tron-forum');
            // Sourced from the matched rule, not the (forged) body.
            expect(hit.destination).toBe('/forum');
            expect(hit.permanent).toBe(true);
            // Query string stripped from the stored path.
            expect(hit.path).toBe('/tron-forum/thread/9');
            expect(hit.country).toBe('US');
            expect(typeof hit.botClass).toBe('string');
            expect(json).toHaveBeenCalledWith({ success: true });
        });

        it('defaults path to the pattern when the beacon path is invalid', async () => {
            const req = buildReq({ body: { pattern: '/a', path: 'not-a-path' } });
            const { res } = buildRes();

            await controller.recordHit(req, res);

            const hit = recordRedirectHit.mock.calls[0][0];
            expect(hit.path).toBe('/a');
            // /a is a 302 rule — permanent comes from the rule, not the body.
            expect(hit.permanent).toBe(false);
        });

        it('rejects a forged CF-IPCountry header (only ISO alpha-2 stored)', async () => {
            const req = buildReq({
                body: { pattern: '/tron-forum' },
                headers: { 'cf-ipcountry': 'not-a-country' }
            });
            const { res } = buildRes();

            await controller.recordHit(req, res);

            expect(recordRedirectHit.mock.calls[0][0].country).toBeNull();
        });
    });

    describe('getRedirectAnalytics()', () => {
        it('passes the resolved window and bot filter through to the service', async () => {
            const payload = { granularity: 'day', total: 3, humanTotal: 3, botTotal: 0, series: [], byPattern: [] };
            getRedirectAnalytics.mockResolvedValue(payload);
            const req = buildReq({ query: { period: '7d', bots: 'exclude' } as Request['query'] });
            const { res, json } = buildRes();

            await controller.getRedirectAnalytics(req, res);

            expect(getRedirectAnalytics).toHaveBeenCalledTimes(1);
            // Second arg is excludeBots — true because bots=exclude.
            expect(getRedirectAnalytics.mock.calls[0][1]).toBe(true);
            expect(json).toHaveBeenCalledWith(payload);
        });

        it('does not exclude bots when the query omits the filter', async () => {
            getRedirectAnalytics.mockResolvedValue({ granularity: 'day', total: 0, humanTotal: 0, botTotal: 0, series: [], byPattern: [] });
            const req = buildReq({ query: { period: '30d' } as Request['query'] });
            const { res } = buildRes();

            await controller.getRedirectAnalytics(req, res);

            expect(getRedirectAnalytics.mock.calls[0][1]).toBe(false);
        });
    });
});
