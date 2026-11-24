/**
 * @fileoverview The `ITrafficGoals` implementation the traffic module publishes
 * as `'traffic-goals'`.
 *
 * Why it exists: a component that owns a visitor action worth measuring, such
 * as the resource-markets plugin's links to rental markets, needs that action
 * tied to the visitor who made it, so it can be attributed to their session's
 * source and landing page and so ignored accounts and bots can be told apart.
 * This class is the one way in. It validates the goal, applies the consent
 * rule the page-view endpoint applies, and stores one `traffic_goal_events`
 * row built by the same request builder the page beacon uses.
 *
 * Consent, mirroring the page-view endpoint and the consent module's anonymous
 * page-view count:
 * - With analytics consent the goal is stored with the visitor's tid, account
 *   id, and address hashes, and the ignore list is NOT checked; it is applied
 *   when goals are read, as for page views.
 * - Without analytics consent the goal is stored with no identifier, unless
 *   the request is on the ignore list, which is checked now because a row
 *   with no tid cannot be filtered later. This is the same check, in the same
 *   order, the consent module applies before counting an anonymous page view.
 * - If the consent check itself fails, nothing is recorded.
 */

import type { IConsentService, IHttpRequest, ISystemLogService, ITrafficGoal, ITrafficGoals, ITrafficIgnoreList } from '@/types';
import { CONSENT_COOKIE_NAME } from '@/types';
import { resolveTid } from '../api/traffic-cookies.js';
import type { IBotRuleMatcher } from './bot-rule-matcher.js';
import { buildTrafficGoalEvent } from './buildTrafficGoalEvent.js';
import type { TrafficService } from './traffic.service.js';
import { validateTrafficGoal } from './validateTrafficGoal.js';

/** The consent decision for one request: allowed, refused, or unknown because the check failed. */
type ConsentDecision = 'allowed' | 'refused' | 'unknown';

/**
 * Records goal events against the visitor who sent a request.
 */
export class TrafficGoalRecorder implements ITrafficGoals {
    /**
     * @param store - Where goal rows go and whether a store is configured;
     *   `TrafficService` in production, narrowed so tests can supply a stub.
     * @param botRules - The operator's bot rules, applied to the goal exactly
     *   as to a page event.
     * @param consent - The consent module's rule, asked on every goal.
     * @param ignoreList - The ignore-list check, used only for anonymous goals.
     * @param logger - Traffic-module logger, for a failed consent check.
     */
    constructor(
        private readonly store: Pick<TrafficService, 'recordGoalEvent' | 'isEnabled'>,
        private readonly botRules: IBotRuleMatcher,
        private readonly consent: IConsentService,
        private readonly ignoreList: Pick<ITrafficIgnoreList, 'isRequestIgnored'>,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Record that the visitor behind a request reached a goal.
     *
     * The goal is validated before anything else, including the check for a
     * configured store, so a malformed goal is refused on every deployment and
     * the mistake surfaces in the caller's own tests.
     *
     * @param req - The visitor's request, from the handler serving it.
     * @param goal - The goal's name and properties.
     * @returns Resolves once the row is handed to the store, or without
     *   recording when no store is configured, the consent check failed, or
     *   an anonymous visitor is on the ignore list.
     * @throws TrafficGoalValidationError when the goal breaks the naming rules.
     */
    async recordGoal(req: IHttpRequest, goal: ITrafficGoal): Promise<void> {
        const valid = validateTrafficGoal(goal);
        if (this.store.isEnabled()) {
            const decision = await this.resolveConsent(req);
            const anonymousAndIgnored = decision === 'refused' && this.ignoreList.isRequestIgnored(req);
            if (decision !== 'unknown' && !anonymousAndIgnored) {
                const analyticsConsent = decision === 'allowed';
                const event = buildTrafficGoalEvent(req, valid, {
                    // Without consent the analytics cookie is not read for the row.
                    tid: analyticsConsent ? resolveTid(req) : null,
                    userId: req.authSession?.user?.id ?? null,
                    analyticsConsent,
                    botRules: this.botRules
                });
                await this.store.recordGoalEvent(event);
            }
        }
    }

    /**
     * Ask the consent module whether this request allows analytics, with the
     * same inputs the page-view endpoint passes.
     *
     * @param req - The visitor's request.
     * @returns `allowed` or `refused`, or `unknown` when the check threw, in
     *   which case nothing is recorded, as the page-view endpoint does.
     */
    private async resolveConsent(req: IHttpRequest): Promise<ConsentDecision> {
        let decision: ConsentDecision = 'unknown';
        try {
            const country = req.headers['cf-ipcountry'];
            const cookies = (req as unknown as { cookies?: Record<string, unknown> }).cookies;
            const consentCookie = cookies?.[CONSENT_COOKIE_NAME];
            const state = await this.consent.resolveRequest(
                Array.isArray(country) ? country[0] : country,
                typeof consentCookie === 'string' ? consentCookie : undefined
            );
            decision = state.analytics ? 'allowed' : 'refused';
        } catch (error) {
            this.logger.error({ error }, 'Failed to resolve analytics consent; goal event not recorded');
        }
        return decision;
    }
}
