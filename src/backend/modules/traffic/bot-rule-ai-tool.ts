/**
 * @file bot-rule-ai-tool.ts
 *
 * The two bot-rule AI tools. `traffic-list-bot-rules` reads the rules that
 * exist and how often each has matched, and `traffic-propose-bot-rule` lets an
 * agent that has diagnosed automated traffic propose a new rule, held for a
 * human.
 *
 * ## Why These Exist
 *
 * The per-event traffic tool lets an agent find a disguised crawler — a
 * network sending one-page visits with no referrer, or page loads and reports
 * arriving from different networks. Without the propose tool the agent could
 * only describe the rule for an operator to type in. With it, the agent stores
 * the rule as `proposed` together with the preview it was based on, and holds
 * it in the central curation queue.
 *
 * Without the list tool the agent could not tell whether a network it found is
 * already covered, whether its own earlier proposal is still waiting, or
 * whether an active rule has stopped matching. It would propose duplicates of
 * rules an admin already wrote, or report a cloud network as uncounted when a
 * rule in label mode has been counting it for a week. The list tool answers
 * those questions from the same storage the admin page reads.
 *
 * ## Safety
 *
 * A proposed rule matches nothing. Approving it in `/system/curation` activates
 * it in `monitor` mode, which records matches without changing any label;
 * switching it to `label` mode is a separate admin action on `/system/traffic`.
 * So no agent call, attended or not, can change a traffic figure. The propose
 * tool declares `forcesCuratorReview` bound to `traffic:bot-rule`, which the
 * governor verifies against the live curation registration. Proposals are
 * capped at {@link MAX_PENDING_PROPOSALS} waiting at once so a looping or
 * injected agent cannot flood the queue.
 *
 * Both tools carry evidence as counts only, never the sample events, whose
 * paths and browser identifiers are attacker-controlled text. The curator sees
 * the samples on the review screen; the model does not need them. The list
 * tool still declares that it surfaces untrusted content, because a proposed
 * rule's name and note were written by a model that may itself have been
 * reading injected text when it proposed, so a later model should treat them
 * as data rather than instructions.
 */

import { BOT_RULE_LABELS } from '@/types';
import type {
    BotRuleStatus,
    IAiTool,
    IAiToolCapability,
    IBotRule,
    IBotRulePreview,
    IBotRuleStats,
    ICurationService,
    ISystemLogService
} from '@/types';
import type { BotRulesService } from './services/bot-rules.service.js';
import type { BotRuleAnalyticsService } from './services/bot-rule-analytics.service.js';
import { BotRuleValidationError, MAX_MISMATCH_SECONDS, validateBotRuleInput } from './services/bot-rule-validation.js';
import { BOT_RULE_CURATION_TYPE_ID } from './services/bot-rule-curation-type.js';

/** Tool name, led by the owning module's id. */
export const PROPOSE_BOT_RULE_TOOL_NAME = 'traffic-propose-bot-rule';

/** Name of the read tool, led by the owning module's id. */
export const LIST_BOT_RULES_TOOL_NAME = 'traffic-list-bot-rules';

/** Most proposals allowed to wait for a curator at once. */
export const MAX_PENDING_PROPOSALS = 20;

/** Most rules the list tool returns in one call, to bound the context window. */
export const MAX_LISTED_BOT_RULES = 50;

/** Window the evidence preview covers, in days. */
const EVIDENCE_WINDOW_DAYS = 7;

/** Window the per-rule match counts cover, in days, fixed by `BotRuleAnalyticsService.stats`. */
const STATS_WINDOW_DAYS = 7;

/** The review states a caller may filter the list by. */
const BOT_RULE_STATUSES: readonly BotRuleStatus[] = ['proposed', 'active', 'rejected'];

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

/**
 * Capability of the list tool: a plain read of the module's own configuration
 * and aggregate match counts. `internal` because rules and counts are operator
 * data, not public. It surfaces untrusted content because a proposed rule's
 * name and note are model-written text (see the file header), so the governor
 * wraps the result as data.
 */
const LIST_BOT_RULES_CAPABILITY: IAiToolCapability = {
    sideEffect: 'read',
    reversible: true,
    sensitivity: 'internal',
    surfacesUntrustedContent: true
};

/**
 * One rule as the list tool returns it: the stored rule with its evidence
 * reduced to counts, plus its recent match counts.
 */
interface IListedBotRule extends Omit<IBotRule, 'evidence'> {
    /** The proposal evidence without its sample events, or null for an admin-written rule. */
    evidence: Omit<IBotRulePreview, 'samples'> | null;
    /** Events the rule matched in the last 24 hours, or null when match counts are unavailable. */
    matches24h: number | null;
    /** Events the rule matched in the last 7 days, or null when match counts are unavailable. */
    matches7d: number | null;
    /** When the rule last matched within the last 7 days, or null. */
    lastMatchedAt: string | null;
}

/**
 * What the list tool needs.
 */
export interface IListBotRulesToolDependencies {
    /** Rule storage; the list is read from here. */
    rules: BotRulesService;
    /** ClickHouse reads; the per-rule match counts come from here. */
    analytics: BotRuleAnalyticsService;
    /** Traffic-module logger. */
    logger: ISystemLogService;
}

/**
 * Join a stored rule to its match counts and drop the evidence samples.
 *
 * The samples hold paths and browser identifiers the requester chose, so they
 * stay on the curator's screen. A rule with no stats row has not matched in
 * the last week, which is a real zero when the counts were readable at all;
 * when the counts could not be read, every rule reports null instead so the
 * model cannot narrate "never matched" from a failed query.
 *
 * @param rule - The stored rule.
 * @param stats - Match counts keyed by rule id.
 * @param countsAvailable - Whether the stats read succeeded, so a missing row means zero rather than unknown.
 * @returns The rule in the shape the model receives.
 */
function toListedRule(rule: IBotRule, stats: ReadonlyMap<string, IBotRuleStats>, countsAvailable: boolean): IListedBotRule {
    const { evidence, ...rest } = rule;
    const row = stats.get(rule.id);
    return {
        ...rest,
        evidence: evidence ? previewCounts(evidence) : null,
        matches24h: row ? row.matches24h : (countsAvailable ? 0 : null),
        matches7d: row ? row.matches7d : (countsAvailable ? 0 : null),
        lastMatchedAt: row ? row.lastMatchedAt : null
    };
}

/**
 * Build the `traffic-list-bot-rules` tool.
 *
 * @param deps - Rule storage, analytics, and a logger.
 * @returns The tool to register on the core `'ai-tools'` registry.
 */
export function createListBotRulesTool(deps: IListBotRulesToolDependencies): IAiTool {
    const { rules, analytics, logger } = deps;
    return {
        name: LIST_BOT_RULES_TOOL_NAME,
        description:
            'List the TronRelic bot rules that exist, newest first, with how often each matched recently. ' +
            'A bot rule labels automated traffic the built-in classifier counts as human; it only changes analytics labels and never blocks anyone. ' +
            `Use it before calling ${PROPOSE_BOT_RULE_TOOL_NAME} to check whether a network, country, or browser build is already covered, ` +
            'to see whether an earlier proposal is still waiting for a curator, or to find an active rule that has stopped matching. ' +
            'Optional "status" keeps only rules in one review state: "active" (evaluated on every event), "proposed" (waiting in the curation queue; matches nothing), ' +
            'or "rejected" (turned down; kept as a record). Optional "limit" caps the rows, up to ' + String(MAX_LISTED_BOT_RULES) + '. ' +
            'Each rule carries its conditions, label, mode ("label" writes the label to matched events; "monitor" only counts them), enabled flag, status, ' +
            'source ("admin", "ai-tool", or "migration"), expiry, and for an AI-proposed rule the evidence counts recorded at proposal time (never its sample events). ' +
            `matches24h and matches7d count events the rule matched, in either mode, over the last day and ${STATS_WINDOW_DAYS} days; lastMatchedAt is the newest match in that window. ` +
            'They are null, not zero, when the analytics store could not be read. A rule only matches while active, enabled, and unexpired, and never matches a logged-in visitor. ' +
            'Returns { total, returned, hasMore, matchCountsAvailable, rules }. Read-only; to add a rule use the propose tool, and to edit or delete one an admin uses /system/traffic.',
        capability: LIST_BOT_RULES_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Optional filter and row cap for the rule list.',
            properties: {
                status: { type: 'string', enum: [...BOT_RULE_STATUSES], description: 'Keep only rules in this review state. Omit for all.' },
                limit: { type: 'integer', description: `Most rules to return, 1 to ${MAX_LISTED_BOT_RULES}. Defaults to ${MAX_LISTED_BOT_RULES}.` }
            },
            additionalProperties: false
        },
        inputExamples: [
            {},
            { status: 'active' },
            { status: 'proposed', limit: 10 }
        ],

        /**
         * Read every rule, join the match counts, and return them newest first.
         *
         * @param input - The model's arguments, re-validated here.
         * @returns The rule list with match counts, or a correctable error.
         */
        handler: async (input) => {
            const payload = (input ?? {}) as Record<string, unknown>;
            let result: Record<string, unknown>;
            try {
                let status: BotRuleStatus | undefined;
                if (payload.status !== undefined) {
                    if (typeof payload.status !== 'string' || !BOT_RULE_STATUSES.includes(payload.status as BotRuleStatus)) {
                        throw new Error(`Parameter "status" must be one of: ${BOT_RULE_STATUSES.join(', ')}`);
                    }
                    status = payload.status as BotRuleStatus;
                }
                let limit = MAX_LISTED_BOT_RULES;
                if (payload.limit !== undefined) {
                    const requested = Number(payload.limit);
                    if (!Number.isInteger(requested) || requested < 1 || requested > MAX_LISTED_BOT_RULES) {
                        throw new Error(`Parameter "limit" must be a whole number from 1 to ${MAX_LISTED_BOT_RULES}`);
                    }
                    limit = requested;
                }

                const [all, statsRows] = await Promise.all([rules.list(), analytics.tryStats()]);
                const countsAvailable = statsRows !== null;
                const stats = new Map((statsRows ?? []).map(row => [row.ruleId, row]));
                const matching = status ? all.filter(rule => rule.status === status) : all;
                const page = matching.slice(0, limit);
                result = {
                    status: status ?? null,
                    statsWindowDays: STATS_WINDOW_DAYS,
                    matchCountsAvailable: countsAvailable,
                    total: matching.length,
                    returned: page.length,
                    hasMore: matching.length > page.length,
                    rules: page.map(rule => toListedRule(rule, stats, countsAvailable))
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn({ error: message }, 'Failed to list bot rules');
                result = { success: false, error: message };
            }
            return result;
        }
    };
}
