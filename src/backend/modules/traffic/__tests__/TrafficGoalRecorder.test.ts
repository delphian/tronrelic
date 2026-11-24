/// <reference types="vitest" />

/**
 * @fileoverview Tests for the recorder the traffic module publishes as
 * `'traffic-goals'`. They pin the three promises other components rely on:
 * a malformed goal is refused even without ClickHouse, a goal is recorded
 * under the same consent rule the page-view endpoint applies, and the ignore
 * list is left to read time for goals that carry a tid.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { IConsentService, IConsentState, IHttpRequest, ISystemLogService, ITrafficIgnoreList } from '@/types';
import { CONSENT_COOKIE_NAME } from '@/types';
import { TrafficGoalRecorder } from '../services/TrafficGoalRecorder.js';
import { TrafficGoalValidationError } from '../services/validateTrafficGoal.js';
import { selectBotRuleMatch, type IBotRuleMatcher } from '../services/bot-rule-matcher.js';
import { NO_TID, type ITrafficGoalEvent } from '../services/traffic.service.js';
import { TID_COOKIE_NAME } from '../api/traffic-cookies.js';

const TID = '550e8400-e29b-41d4-a716-446655440000';
const GOAL = { name: 'resource-markets:outbound-click', properties: { market: 'tronsave', placement: 'table' } };

/** What the consent module answers for a visitor who allowed analytics. */
const ALLOWED: IConsentState = { enabled: true, required: true, decided: true, analytics: true, ads: false };

/** What it answers for a visitor in a consent region who has not agreed. */
const REFUSED: IConsentState = { enabled: true, required: true, decided: false, analytics: false, ads: false };

/**
 * Build the request a plugin route handler receives: headers, the parsed
 * cookies core's middleware attaches, and the session.
 *
 * @param options - Logged-in user and extra headers for the case under test.
 */
function buildReq(options: { userId?: string; headers?: Record<string, string> } = {}): IHttpRequest {
    return {
        params: {},
        query: {},
        body: {},
        method: 'GET',
        path: '/api/plugins/resource-markets/go/tronsave',
        ip: '203.0.113.7',
        headers: {
            host: 'tronrelic.com',
            referer: 'https://tronrelic.com/resource-markets?sort=price',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            ...options.headers
        },
        cookies: { [TID_COOKIE_NAME]: TID, [CONSENT_COOKIE_NAME]: '1.10.1760000000' },
        authSession: options.userId ? { user: { id: options.userId } } : null
    } as unknown as IHttpRequest;
}

describe('TrafficGoalRecorder', () => {
    let recordGoalEvent: Mock<(event: ITrafficGoalEvent) => Promise<void>>;
    let enabled: boolean;
    let resolveRequest: ReturnType<typeof vi.fn>;
    let isRequestIgnored: ReturnType<typeof vi.fn>;
    let logger: ISystemLogService;
    let recorder: TrafficGoalRecorder;

    beforeEach(() => {
        recordGoalEvent = vi.fn(async (_event: ITrafficGoalEvent) => undefined);
        enabled = true;
        resolveRequest = vi.fn(async () => ALLOWED);
        isRequestIgnored = vi.fn(() => false);
        logger = { error: vi.fn(), warn: vi.fn() } as unknown as ISystemLogService;
        const botRules: IBotRuleMatcher = { match: vi.fn(signals => selectBotRuleMatch([], signals)) };
        const consent = { getPublicConfig: vi.fn(), resolveRequest } as unknown as IConsentService;
        const ignoreList = { isRequestIgnored } as unknown as Pick<ITrafficIgnoreList, 'isRequestIgnored'>;
        recorder = new TrafficGoalRecorder(
            { recordGoalEvent, isEnabled: () => enabled },
            botRules,
            consent,
            ignoreList,
            logger
        );
    });

    /** The single row the recorder handed to the store. */
    function recordedRow(): ITrafficGoalEvent {
        expect(recordGoalEvent).toHaveBeenCalledTimes(1);
        return recordGoalEvent.mock.calls[0]![0] as ITrafficGoalEvent;
    }

    it('records a consented goal with the tid, account, page path, and address hashes', async () => {
        await recorder.recordGoal(buildReq({ userId: 'user-1' }), GOAL);
        const row = recordedRow();
        expect(row.candidate_uid).toBe(TID);
        expect(row.user_id).toBe('user-1');
        expect(row.goal).toBe(GOAL.name);
        expect(row.properties).toEqual(GOAL.properties);
        expect(row.analytics_consent).toBe(1);
        // The page the visitor acted on, from the same-site referrer, not the API route.
        expect(row.path).toBe('/resource-markets');
        expect(row.ip_hash).toMatch(/^[a-f0-9]{16}$/);
        expect(row.subnet_hash).toMatch(/^[a-f0-9]{16}$/);
        expect(row.bot_class).toBe('human');
    });

    it('asks the consent module with the same inputs the page-view endpoint uses', async () => {
        await recorder.recordGoal(buildReq({ headers: { 'cf-ipcountry': 'DE' } }), GOAL);
        expect(resolveRequest).toHaveBeenCalledWith('DE', '1.10.1760000000');
    });

    it('does not check the ignore list for a consented goal, leaving that to read time', async () => {
        isRequestIgnored.mockReturnValue(true);
        await recorder.recordGoal(buildReq({ userId: 'ignored-user' }), GOAL);
        expect(isRequestIgnored).not.toHaveBeenCalled();
        expect(recordedRow().candidate_uid).toBe(TID);
    });

    it('records a goal without analytics consent anonymously: no tid, account, or hashes', async () => {
        resolveRequest.mockResolvedValue(REFUSED);
        await recorder.recordGoal(buildReq({ userId: 'user-1' }), GOAL);
        const row = recordedRow();
        expect(row.candidate_uid).toBe(NO_TID);
        expect(row.user_id).toBeNull();
        expect(row.ip_hash).toBeNull();
        expect(row.subnet_hash).toBeNull();
        expect(row.analytics_consent).toBe(0);
        // What the goal means is still kept, so it counts under its goal.
        expect(row.goal).toBe(GOAL.name);
        expect(row.properties).toEqual(GOAL.properties);
    });

    it('skips an anonymous goal from an ignored visitor, as the anonymous page-view count does', async () => {
        resolveRequest.mockResolvedValue(REFUSED);
        isRequestIgnored.mockReturnValue(true);
        await recorder.recordGoal(buildReq({ userId: 'ignored-user' }), GOAL);
        expect(isRequestIgnored).toHaveBeenCalledTimes(1);
        expect(recordGoalEvent).not.toHaveBeenCalled();
    });

    it('records nothing when the consent check fails', async () => {
        resolveRequest.mockRejectedValue(new Error('settings unavailable'));
        await expect(recorder.recordGoal(buildReq(), GOAL)).resolves.toBeUndefined();
        expect(recordGoalEvent).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalled();
    });

    it('resolves without recording when no analytics store is configured', async () => {
        enabled = false;
        await expect(recorder.recordGoal(buildReq(), GOAL)).resolves.toBeUndefined();
        expect(resolveRequest).not.toHaveBeenCalled();
        expect(recordGoalEvent).not.toHaveBeenCalled();
    });

    it('rejects a malformed goal even when no analytics store is configured', async () => {
        enabled = false;
        await expect(recorder.recordGoal(buildReq(), { name: 'Outbound Click' })).rejects.toBeInstanceOf(TrafficGoalValidationError);
    });

    it('leaves the page path empty when the referrer is another site', async () => {
        await recorder.recordGoal(buildReq({ headers: { referer: 'https://elsewhere.example/page' } }), GOAL);
        expect(recordedRow().path).toBe('');
    });
});
