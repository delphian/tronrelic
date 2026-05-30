/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the slim analytics bootstrap controller.
 *
 * Verifies the post-cutover contract: read/mint the unsigned `tronrelic_tid`
 * (and first-touch `tronrelic_ref`) cookies, emit exactly one `bootstrap`
 * traffic event keyed on the tid, attribute the Better Auth account when
 * present, and never touch identity or MongoDB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import type { TrafficService } from '../services/traffic.service.js';
import { BootstrapController } from '../api/bootstrap.controller.js';
import { TID_COOKIE_NAME, REF_COOKIE_NAME } from '../api/traffic-cookies.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXISTING_TID = '550e8400-e29b-41d4-a716-446655440000';

interface SetCookie { name: string; value: string; }

function buildReq(overrides: Partial<Request> = {}): Request {
    return {
        cookies: {},
        body: {},
        query: {},
        headers: {},
        ip: '203.0.113.7',
        path: '/markets',
        ...overrides
    } as unknown as Request;
}

function buildRes(): { res: Response; cookies: SetCookie[]; json: ReturnType<typeof vi.fn> } {
    const cookies: SetCookie[] = [];
    const json = vi.fn();
    const res = {
        cookie: vi.fn((name: string, value: string) => { cookies.push({ name, value }); }),
        status: vi.fn().mockReturnThis(),
        json
    } as unknown as Response;
    return { res, cookies, json };
}

describe('BootstrapController', () => {
    let recordEvent: ReturnType<typeof vi.fn>;
    let trafficService: TrafficService;
    let logger: ISystemLogService;
    let controller: BootstrapController;

    beforeEach(() => {
        recordEvent = vi.fn();
        trafficService = { recordEvent } as unknown as TrafficService;
        logger = { error: vi.fn() } as unknown as ISystemLogService;
        controller = new BootstrapController(trafficService, logger);
    });

    it('mints a fresh tid, emits a bootstrap event, and returns success', async () => {
        const req = buildReq();
        const { res, cookies, json } = buildRes();

        await controller.bootstrap(req, res);

        const tidCookie = cookies.find(c => c.name === TID_COOKIE_NAME);
        expect(tidCookie?.value).toMatch(UUID_V4);
        expect(recordEvent).toHaveBeenCalledTimes(1);
        const event = recordEvent.mock.calls[0][0];
        expect(event.event_type).toBe('bootstrap');
        expect(event.candidate_uid).toBe(tidCookie?.value);
        expect(json).toHaveBeenCalledWith({ success: true });
    });

    it('reuses an existing tid cookie without re-issuing it', async () => {
        const req = buildReq({ cookies: { [TID_COOKIE_NAME]: EXISTING_TID } } as Partial<Request>);
        const { res, cookies } = buildRes();

        await controller.bootstrap(req, res);

        expect(cookies.find(c => c.name === TID_COOKIE_NAME)).toBeUndefined();
        expect(recordEvent.mock.calls[0][0].candidate_uid).toBe(EXISTING_TID);
    });

    it('attributes the logged-in Better Auth account', async () => {
        const req = buildReq({
            cookies: { [TID_COOKIE_NAME]: EXISTING_TID },
            authSession: { user: { id: 'ba_user_42' } }
        } as unknown as Partial<Request>);
        const { res } = buildRes();

        await controller.bootstrap(req, res);

        expect(recordEvent.mock.calls[0][0].user_id).toBe('ba_user_42');
    });

    it('captures a first-touch referral from the body and sets the ref cookie', async () => {
        const req = buildReq({
            cookies: { [TID_COOKIE_NAME]: EXISTING_TID },
            body: { ref: 'promo_2026' }
        } as unknown as Partial<Request>);
        const { res, cookies } = buildRes();

        await controller.bootstrap(req, res);

        expect(cookies.find(c => c.name === REF_COOKIE_NAME)?.value).toBe('promo_2026');
        expect(recordEvent.mock.calls[0][0].referral_code).toBe('promo_2026');
    });
});
