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
import type { IBotNetworkLookup } from '../services/bot-networks.service.js';
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
    let botNetworks: IBotNetworkLookup;
    let logger: ISystemLogService;
    let controller: BootstrapController;

    beforeEach(() => {
        recordEvent = vi.fn();
        trafficService = { recordEvent } as unknown as TrafficService;
        // AS139341 stands in for a network the operator has listed.
        botNetworks = { isBotNetwork: vi.fn((asn: number) => asn === 139341) };
        logger = { error: vi.fn() } as unknown as ISystemLogService;
        controller = new BootstrapController(trafficService, botNetworks, logger);
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

    it('emits a page event keyed on the existing tid for the route-change beacon', async () => {
        const req = buildReq({
            cookies: { [TID_COOKIE_NAME]: EXISTING_TID },
            body: { landingPath: '/markets/energy' }
        } as unknown as Partial<Request>);
        const { res, json } = buildRes();

        await controller.page(req, res);

        expect(recordEvent).toHaveBeenCalledTimes(1);
        const event = recordEvent.mock.calls[0][0];
        expect(event.event_type).toBe('page');
        expect(event.candidate_uid).toBe(EXISTING_TID);
        expect(event.path).toBe('/markets/energy');
        expect(json).toHaveBeenCalledWith({ success: true });
    });

    it('attributes a page event to the logged-in account', async () => {
        const req = buildReq({
            cookies: { [TID_COOKIE_NAME]: EXISTING_TID },
            body: { landingPath: '/account' },
            authSession: { user: { id: 'ba_user_42' } }
        } as unknown as Partial<Request>);
        const { res } = buildRes();

        await controller.page(req, res);

        expect(recordEvent.mock.calls[0][0].user_id).toBe('ba_user_42');
    });

    describe('automation flag from the page beacon', () => {
        const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

        it('classifies a browser-UA page event as bot_other when the beacon reports automated: true', async () => {
            const req = buildReq({
                cookies: { [TID_COOKIE_NAME]: EXISTING_TID },
                headers: { 'user-agent': CHROME_UA },
                body: { landingPath: '/blog', automated: true }
            } as unknown as Partial<Request>);
            const { res } = buildRes();

            await controller.page(req, res);

            expect(recordEvent.mock.calls[0][0].bot_class).toBe('bot_other');
        });

        it.each([
            ['absent', undefined],
            ['false', false],
            ['a truthy non-boolean', 'true']
        ])('keeps a browser-UA page event human when the flag is %s', async (_label, automated) => {
            const req = buildReq({
                cookies: { [TID_COOKIE_NAME]: EXISTING_TID },
                headers: { 'user-agent': CHROME_UA },
                body: { landingPath: '/blog', automated }
            } as unknown as Partial<Request>);
            const { res } = buildRes();

            await controller.page(req, res);

            expect(recordEvent.mock.calls[0][0].bot_class).toBe('human');
        });
    });

    describe('automated-network list', () => {
        const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

        /**
         * Build a page-beacon request that arrived through Cloudflare from a
         * given network, since the ASN is only trusted when CF-Ray is present.
         *
         * @param headers - Extra headers layered over the browser UA.
         * @returns A request carrying a stock Chrome UA and the given headers.
         */
        function networkReq(headers: Record<string, string>): Request {
            return buildReq({
                cookies: { [TID_COOKIE_NAME]: EXISTING_TID },
                headers: { 'user-agent': CHROME_UA, ...headers },
                body: { landingPath: '/blog' }
            } as unknown as Partial<Request>);
        }

        it('labels a browser-UA event from a listed network as bot_other', async () => {
            const { res } = buildRes();

            await controller.page(networkReq({ 'cf-ray': 'abc123-SIN', 'x-client-asn': '139341' }), res);

            const event = recordEvent.mock.calls[0][0];
            expect(event.asn).toBe(139341);
            expect(event.bot_class).toBe('bot_other');
        });

        it('keeps a browser-UA event from an unlisted network human', async () => {
            const { res } = buildRes();

            await controller.page(networkReq({ 'cf-ray': 'abc123-SIN', 'x-client-asn': '9808' }), res);

            expect(recordEvent.mock.calls[0][0].bot_class).toBe('human');
        });

        it('ignores a listed ASN header that did not arrive through Cloudflare', async () => {
            // Without CF-Ray the ASN is not stored, so a direct-to-origin caller
            // cannot mislabel itself or anyone else by sending the header.
            const { res } = buildRes();

            await controller.page(networkReq({ 'x-client-asn': '139341' }), res);

            const event = recordEvent.mock.calls[0][0];
            expect(event.asn).toBeNull();
            expect(event.bot_class).toBe('human');
        });
    });
});
