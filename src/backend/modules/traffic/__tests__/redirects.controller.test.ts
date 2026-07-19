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
    let controller: RedirectsController;

    beforeEach(() => {
        recordRedirectHit = vi.fn();
        getRedirectAnalytics = vi.fn();
        const redirectService = {} as unknown as RedirectService;
        const trafficService = { recordRedirectHit, getRedirectAnalytics } as unknown as TrafficService;
        const logger = { error: vi.fn() } as unknown as ISystemLogService;
        controller = new RedirectsController(redirectService, trafficService, logger);
    });

    describe('recordHit()', () => {
        it('400s and records nothing when pattern/destination are missing', async () => {
            const req = buildReq({ body: { pattern: '/only-pattern' } });
            const { res, status, json } = buildRes();

            await controller.recordHit(req, res);

            expect(status).toHaveBeenCalledWith(400);
            expect(recordRedirectHit).not.toHaveBeenCalled();
            expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'ValidationError' }));
        });

        it('dispatches a hit and answers success for a valid beacon', async () => {
            const req = buildReq({
                body: { pattern: '/tron-forum', destination: '/forum', permanent: true, path: '/tron-forum/thread/9?ref=x' },
                headers: { 'user-agent': 'Mozilla/5.0', 'cf-ipcountry': 'US' }
            });
            const { res, json } = buildRes();

            await controller.recordHit(req, res);

            expect(recordRedirectHit).toHaveBeenCalledTimes(1);
            const hit = recordRedirectHit.mock.calls[0][0];
            expect(hit.pattern).toBe('/tron-forum');
            expect(hit.destination).toBe('/forum');
            // Query string stripped from the stored path.
            expect(hit.path).toBe('/tron-forum/thread/9');
            expect(hit.permanent).toBe(true);
            expect(hit.country).toBe('US');
            expect(typeof hit.botClass).toBe('string');
            expect(json).toHaveBeenCalledWith({ success: true });
        });

        it('defaults permanent to true and path to the pattern when omitted/invalid', async () => {
            const req = buildReq({ body: { pattern: '/a', destination: '/b', path: 'not-a-path' } });
            const { res } = buildRes();

            await controller.recordHit(req, res);

            const hit = recordRedirectHit.mock.calls[0][0];
            expect(hit.permanent).toBe(true);
            expect(hit.path).toBe('/a');
        });

        it('honors an explicit permanent=false (302)', async () => {
            const req = buildReq({ body: { pattern: '/a', destination: '/b', permanent: false } });
            const { res } = buildRes();

            await controller.recordHit(req, res);

            expect(recordRedirectHit.mock.calls[0][0].permanent).toBe(false);
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
