/**
 * @file bot-rule-ai-tool.ts
 *
 * The `traffic-propose-bot-rule` AI tool: lets an agent that has diagnosed
 * automated traffic propose a bot rule for it, held for a human.
 *
 * ## Why This Exists
 *
 * The per-event traffic tool lets an agent find a disguised crawler — a
 * network sending one-page visits with no referrer, or page loads and reports
 * arriving from different networks. Without this tool the agent could only
 * describe the rule for an operator to type in. With it, the agent stores the
 * rule as `proposed` together with the preview it was based on, and holds it in
 * the central curation queue.
 *
 * ## Safety
 *
 * A proposed rule matches nothing. Approving it in `/system/curation` activates
 * it in `monitor` mode, which records matches without changing any label;
 * switching it to `label` mode is a separate admin action on `/system/traffic`.
 * So no agent call, attended or not, can change a traffic figure. The tool
 * declares `forcesCuratorReview` bound to `traffic:bot-rule`, which the
 * governor verifies against the live curation registration. Proposals are
 * capped at {@link MAX_PENDING_PROPOSALS} waiting at once so a looping or
 * injected agent cannot flood the queue.
 *
 * The response carries counts only, never the sample events, whose paths and
 * browser identifiers are attacker-controlled text. The curator sees the
 * samples on the review screen; the model does not need them.
 */

import { BOT_RULE_LABELS } from '@/types';
import type { IAiTool, IAiToolCapability, IBotRulePreview, ICurationService, ISystemLogService } from '@/types';
import type { BotRulesService } from './services/bot-rules.service.js';
import type { BotRuleAnalyticsService } from './services/bot-rule-analytics.service.js';
import { BotRuleValidationError, MAX_MISMATCH_SECONDS, validateBotRuleInput } from './services/bot-rule-validation.js';
import { BOT_RULE_CURATION_TYPE_ID } from './services/bot-rule-curation-type.js';

/** Tool name, led by the owning module's id. */
export const PROPOSE_BOT_RULE_TOOL_NAME = 'traffic-propose-bot-rule';

/** Most proposals allowed to wait for a curator at once. */
export const MAX_PENDING_PROPOSALS = 20;

/** Window the evidence preview covers, in days. */
const EVIDENCE_WINDOW_DAYS = 7;

/**
 * Capability: a `write` to the platform's own configuration, reversible
 * because a rule can be deleted and starts in monitor mode, `internal` because
 * it reads and returns only aggregate traffic counts, and self-curated: every
 * effect is held in the curation queue under `traffic:bot-rule`.
 */
const PROPOSE_BOT_RULE_CAPABILITY: IAiToolCapability = {
    sideEffect: 'write',
    reversible: true,
    sensitivity: 'internal',
    forcesCuratorReview: true,
    curationTypeId: BOT_RULE_CURATION_TYPE_ID
};

/**
 * Reduce a preview to its counts for the model. The sample events carry paths
 * and browser identifiers the requester chose, so they stay on the curator's
 * review screen and never enter the model's context.
 *
 * @param preview - The full preview.
 * @returns The preview without its samples.
 */
function previewCounts(preview: IBotRulePreview): Omit<IBotRulePreview, 'samples'> {
    return {
        windowDays: preview.windowDays,
        windowStart: preview.windowStart,
        windowEnd: preview.windowEnd,
        matchedEvents: preview.matchedEvents,
        matchedCookies: preview.matchedCookies,
        eventsByCurrentLabel: preview.eventsByCurrentLabel,
        loggedInCookies: preview.loggedInCookies,
        returningCookies: preview.returningCookies,
        distinctReferrerDomains: preview.distinctReferrerDomains,
        distinctUserAgents: preview.distinctUserAgents
    };
}

/**
 * What the propose tool needs.
 */
export interface IProposeBotRuleToolDependencies {
    /** Rule storage; the proposal is written here as `proposed`. */
    rules: BotRulesService;
    /** ClickHouse reads; the evidence preview comes from here. */
    analytics: BotRuleAnalyticsService;
    /**
     * Resolve the central curation service at call time, so the tool tolerates
     * curation registering after this module.
     */
    getCuration: () => ICurationService | undefined;
    /** Traffic-module logger. */
    logger: ISystemLogService;
}

/**
 * Build the `traffic-propose-bot-rule` tool.
 *
 * @param deps - Rule storage, analytics, a lazy curation resolver, and a logger.
 * @returns The tool to register on the core `'ai-tools'` registry.
 */
export function createProposeBotRuleTool(deps: IProposeBotRuleToolDependencies): IAiTool {
    const { rules, analytics, getCuration, logger } = deps;
    return {
        name: PROPOSE_BOT_RULE_TOOL_NAME,
        description:
            'Propose a bot rule that labels automated TronRelic traffic the built-in classifier counts as human. ' +
            'Use only after diagnosing the traffic with tronrelic-list-traffic-events and confirming it is automated ' +
            '(for example: many fresh cookies with one page each, no referrer, no logins, one browser build, or page loads ' +
            'and JavaScript reports arriving from different networks). Do NOT use it to block anyone; rules only change analytics labels. ' +
            'The rule is NOT applied: it is stored as proposed and held for an admin in the curation queue. If approved it starts in ' +
            'monitor mode, which records matches without changing labels; an admin switches it to labeling separately. ' +
            'Parameters: "name" (short title), "reason" (the evidence, shown to the reviewer), "label" (bot class, usually bot_other), ' +
            'and "conditions", which must set at least one of asns, countries, userAgentContains, pathPrefixes, or networkMismatch. ' +
            'All set conditions must match; list entries match if any one matches, except userAgentContains, where every fragment must appear. ' +
            'Logged-in visitors never match. Returns { success, pendingReview, ruleId, preview } where preview counts what the conditions ' +
            `matched over the last ${EVIDENCE_WINDOW_DAYS} days (events, cookies, current labels, logged-in and returning cookies). ` +
            'If preview.loggedInCookies or preview.returningCookies is high, the conditions probably catch real people: narrow them and propose again. ' +
            `At most ${MAX_PENDING_PROPOSALS} proposals may wait for review at once.`,
        capability: PROPOSE_BOT_RULE_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'The bot rule to propose for curator review.',
            properties: {
                name: { type: 'string', description: 'Short title for the rule, at most 80 characters.' },
                reason: { type: 'string', description: 'The evidence that this traffic is automated, at most 500 characters. Shown to the reviewer.' },
                label: { type: 'string', enum: [...BOT_RULE_LABELS], description: 'Bot class to assign when the rule labels. Use bot_other unless a named family fits.' },
                conditions: {
                    type: 'object',
                    description: 'What an event must look like to match. Set at least one of asns, countries, userAgentContains, pathPrefixes, networkMismatch.',
                    properties: {
                        asns: { type: 'array', items: { type: 'integer' }, description: 'Autonomous system numbers (network operators); any one matches.' },
                        countries: { type: 'array', items: { type: 'string' }, description: 'Two-letter country codes such as SG; any one matches.' },
                        userAgentContains: { type: 'array', items: { type: 'string' }, description: 'Case-insensitive text the browser identifier must contain; every entry must appear. 3 to 200 characters each.' },
                        pathPrefixes: { type: 'array', items: { type: 'string' }, description: 'Path prefixes starting with "/", such as /vi/; any one matches.' },
                        eventType: { type: 'string', enum: ['bootstrap', 'page'], description: 'bootstrap = server-recorded page load, page = JavaScript report.' },
                        referrer: { type: 'string', enum: ['absent', 'present'], description: 'Require no referrer, or a referrer.' },
                        networkMismatch: {
                            type: 'object',
                            description: 'Match a JavaScript report whose network or country differs from the same cookie\'s page load shortly before it.',
                            properties: {
                                compare: { type: 'string', enum: ['asn', 'country'], description: 'Which value must differ.' },
                                withinSeconds: { type: 'integer', description: `How soon after the page load, 1 to ${MAX_MISMATCH_SECONDS}.` }
                            },
                            required: ['compare', 'withinSeconds'],
                            additionalProperties: false
                        }
                    },
                    additionalProperties: false
                }
            },
            required: ['name', 'reason', 'label', 'conditions'],
            additionalProperties: false
        },
        inputExamples: [
            {
                name: 'Alibaba Cloud SG headless crawler',
                reason: '73 cookies in one hour, one page each, no referrer, no logins, all Chrome 145 on Mac, from AS45102.',
                label: 'bot_other',
                conditions: { asns: [45102], userAgentContains: ['chrome/145.0.0.0', 'macintosh'], referrer: 'absent' }
            },
            {
                name: 'Residential-proxy page loads with cloud reports',
                reason: 'Page loads from home ISPs worldwide, each report 3 seconds later from a cloud network.',
                label: 'bot_other',
                conditions: { networkMismatch: { compare: 'asn', withinSeconds: 30 }, pathPrefixes: ['/vi/', '/zh/'] }
            }
        ],

        /**
         * Validate the proposal, record its evidence, store it as proposed, and
         * hold it for a curator.
         *
         * @param input - The model's arguments, re-validated here.
         * @returns A pending-review confirmation with evidence counts, or a correctable error.
         */
        handler: async (input) => {
            const payload = (input ?? {}) as Record<string, unknown>;
            let result: Record<string, unknown>;
            try {
                const valid = validateBotRuleInput({
                    name: payload.name,
                    note: payload.reason,
                    label: payload.label,
                    conditions: payload.conditions,
                    mode: 'monitor'
                });
                const curation = getCuration();
                if (!curation) {
                    result = { success: false, error: 'The curation service is unavailable, so the rule cannot be held for review' };
                } else if (await rules.countProposed() >= MAX_PENDING_PROPOSALS) {
                    result = { success: false, error: `${MAX_PENDING_PROPOSALS} proposals are already waiting for review. Ask an admin to decide them before proposing more` };
                } else {
                    let preview: IBotRulePreview | null = null;
                    try {
                        preview = await analytics.preview(valid.conditions, EVIDENCE_WINDOW_DAYS);
                    } catch (error) {
                        logger.warn({ error }, 'Bot rule proposal preview failed; holding without evidence');
                    }
                    const rule = await rules.propose(valid, preview);
                    const held = await curation.hold({
                        typeId: BOT_RULE_CURATION_TYPE_ID,
                        ref: { ruleId: rule.id },
                        source: `ai-tool:${PROPOSE_BOT_RULE_TOOL_NAME}`
                    });
                    logger.info({ ruleId: rule.id, curationId: held.id }, 'Bot rule proposed and held for curation');
                    result = { success: true, pendingReview: true, ruleId: rule.id, preview: preview ? previewCounts(preview) : null };
                }
            } catch (error) {
                if (error instanceof BotRuleValidationError) {
                    result = { success: false, error: error.message };
                } else {
                    const message = error instanceof Error ? error.message : String(error);
                    logger.warn({ error: message }, 'Failed to propose bot rule');
                    result = { success: false, error: `Failed to propose the rule: ${message}` };
                }
            }
            return result;
        }
    };
}
