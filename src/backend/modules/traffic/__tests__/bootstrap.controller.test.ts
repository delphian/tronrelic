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
import type { IConsentService, IConsentState, ISystemLogService } from '@/types';
import type { TrafficService } from '../services/traffic.service.js';
import { selectBotRuleMatch, type IBotRuleMatcher, type ICompiledBotRule } from '../services/bot-rule-matcher.js';
import { FirstTouchStore } from '../services/first-touch-store.js';
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
    let rules: ICompiledBotRule[];
    let botRules: IBotRuleMatcher;
    let resolveRequest: ReturnType<typeof vi.fn>;
    let logger: ISystemLogService;
    let controller: BootstrapController;

    /** What the consent module answers when the visitor allowed analytics. */
    const ANALYTICS_ALLOWED: IConsentState = { enabled: true, required: false, decided: false, analytics: true, ads: true };

    beforeEach(() => {
        recordEvent = vi.fn();
        trafficService = { recordEvent } as unknown as TrafficService;
        // The real matcher over a rule list each test can set, so the controller
        // is exercised with the same selection logic the service uses.
        rules = [];
        botRules = { match: vi.fn(signals => selectBotRuleMatch(rules, signals)) };
        // Analytics allowed by default, so the tests below that predate the
        // consent check exercise recording exactly as before.
        resolveRequest = vi.fn(async () => ANALYTICS_ALLOWED);
        const consent = { getPublicConfig: vi.fn(), resolveRequest } as unknown as IConsentService;
        logger = { error: vi.fn() } as unknown as ISystemLogService;
        controller = new BootstrapController(trafficService, botRules, new FirstTouchStore(), consent, logger);
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

    describe('analytics consent on the page beacon', () => {
        it('asks the consent module with the request country and consent cookie', async () => {
            const req = buildReq({
                cookies: { [TID_COOKIE_NAME]: EXISTING_TID, tronrelic_consent: '1.10.1760000000' },
                headers: { 'cf-ipcountry': 'DE' },
                body: { landingPath: '/blog' }
            } as unknown as Partial<Request>);
            const { res } = buildRes();

            await controller.page(req, res);

            expect(resolveRequest).toHaveBeenCalledWith('DE', '1.10.1760000000');
        });

        it('records nothing and sets no cookie when the visitor has not allowed analytics', async () => {
            resolveRequest.mockResolvedValue({ enabled: true, required: true, decided: false, analytics: false, ads: false });
            const req = buildReq({ headers: { 'cf-ipcountry': 'DE' }, body: { landingPath: '/blog', ref: 'promo_2026' } } as unknown as Partial<Request>);
            const { res, cookies, json } = buildRes();

            await controller.page(req, res);

            expect(recordEvent).not.toHaveBeenCalled();
            expect(cookies).toEqual([]);
            expect(json).toHaveBeenCalledWith({ success: true, recorded: false });
        });

        it('records nothing when the consent check fails, rather than risk an unconsented cookie', async () => {
            resolveRequest.mockRejectedValue(new Error('database unavailable'));
            const req = buildReq({ body: { landingPath: '/blog' } } as unknown as Partial<Request>);
            const { res, cookies } = buildRes();

            await controller.page(req, res);

            expect(recordEvent).not.toHaveBeenCalled();
            expect(cookies).toEqual([]);
            expect(logger.error).toHaveBeenCalled();
        });
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

    describe('bot rules', () => {
        const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

        /** A rule labeling AS139341, which stands in for a confirmed automated network. */
        const NETWORK_RULE: ICompiledBotRule = { id: 'rule-asn', label: 'bot_other', mode: 'label', conditions: { asns: [139341] }, expiresAt: null };

        /**
         * Build a request that arrived through Cloudflare from a given network,
         * since the ASN is only trusted when CF-Ray is present.
         *
         * @param headers - Extra headers layered over the browser UA.
         * @param authSession - Optional session, to test the logged-in exclusion.
         * @returns A request carrying a stock Chrome UA and the given headers.
         */
        function networkReq(headers: Record<string, string>, authSession?: unknown): Request {
            return buildReq({
                cookies: { [TID_COOKIE_NAME]: EXISTING_TID },
                headers: { 'user-agent': CHROME_UA, ...headers },
                body: { tid: EXISTING_TID, landingPath: '/blog' },
                authSession
            } as unknown as Partial<Request>);
        }

        it('labels a browser-UA event matching a label-mode rule and records the rule id', async () => {
            rules = [NETWORK_RULE];
            const { res } = buildRes();

            await controller.page(networkReq({ 'cf-ray': 'abc123-SIN', 'x-client-asn': '139341' }), res);

            const event = recordEvent.mock.calls[0][0];
            expect(event.asn).toBe(139341);
            expect(event.bot_class).toBe('bot_other');
            expect(event.bot_rule).toBe('rule-asn');
        });

        it('records a monitor-mode match without changing the label', async () => {
            rules = [{ ...NETWORK_RULE, mode: 'monitor' }];
            const { res } = buildRes();

            await controller.page(networkReq({ 'cf-ray': 'abc123-SIN', 'x-client-asn': '139341' }), res);

            const event = recordEvent.mock.calls[0][0];
            expect(event.bot_class).toBe('human');
            expect(event.bot_rule).toBe('rule-asn');
        });

        it('keeps a browser-UA event from an unlisted network human with no rule id', async () => {
            rules = [NETWORK_RULE];
            const { res } = buildRes();

            await controller.page(networkReq({ 'cf-ray': 'abc123-SIN', 'x-client-asn': '9808' }), res);

            const event = recordEvent.mock.calls[0][0];
            expect(event.bot_class).toBe('human');
            expect(event.bot_rule).toBeNull();
        });

        it('never matches a logged-in visitor', async () => {
            rules = [NETWORK_RULE];
            const { res } = buildRes();

            await controller.page(networkReq({ 'cf-ray': 'abc123-SIN', 'x-client-asn': '139341' }, { user: { id: 'ba_user_42' } }), res);

            const event = recordEvent.mock.calls[0][0];
            expect(event.bot_class).toBe('human');
            expect(event.bot_rule).toBeNull();
        });

        it('ignores a listed ASN header that did not arrive through Cloudflare', async () => {
            // Without CF-Ray the ASN is not stored, so a direct-to-origin caller
            // cannot mislabel itself or anyone else by sending the header.
            rules = [NETWORK_RULE];
            const { res } = buildRes();

            await controller.page(networkReq({ 'x-client-asn': '139341' }), res);

            const event = recordEvent.mock.calls[0][0];
            expect(event.asn).toBeNull();
            expect(event.bot_class).toBe('human');
        });

        it('matches a page report whose network differs from the same cookie\'s page load', async () => {
            rules = [{ id: 'rule-mismatch', label: 'bot_other', mode: 'label', conditions: { networkMismatch: { compare: 'asn', withinSeconds: 30 } }, expiresAt: null }];

            // Page load through a residential network, then the report from a cloud network.
            await controller.bootstrap(networkReq({ 'cf-ray': 'r1-TLV', 'x-client-asn': '12849' }), buildRes().res);
            await controller.page(networkReq({ 'cf-ray': 'r2-SIN', 'x-client-asn': '45102' }), buildRes().res);

            const pageEvent = recordEvent.mock.calls[1][0];
            expect(pageEvent.event_type).toBe('page');
            expect(pageEvent.bot_class).toBe('bot_other');
            expect(pageEvent.bot_rule).toBe('rule-mismatch');
        });

        it('does not match a page report from the same network as its page load', async () => {
            rules = [{ id: 'rule-mismatch', label: 'bot_other', mode: 'label', conditions: { networkMismatch: { compare: 'asn', withinSeconds: 30 } }, expiresAt: null }];

            await controller.bootstrap(networkReq({ 'cf-ray': 'r1-SIN', 'x-client-asn': '9808' }), buildRes().res);
            await controller.page(networkReq({ 'cf-ray': 'r2-SIN', 'x-client-asn': '9808' }), buildRes().res);

            expect(recordEvent.mock.calls[1][0].bot_class).toBe('human');
        });
    });
});
