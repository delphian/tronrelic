/**
 * @fileoverview The `traffic:bot-rule` curation type — how an AI-proposed bot
 * rule waits for a human.
 *
 * ## Why This Exists
 *
 * An AI agent can spot a disguised crawler in the traffic data, but a rule it
 * writes decides how every future event is counted. A wrong rule would quietly
 * delete real visitors from the figures. So the agent's rule is stored as
 * `proposed`, matches nothing, and is held in the central curation queue at
 * `/system/curation`. A bot rule is configuration rather than content the
 * platform publishes, so it uses an `ICurationType` directly, as the module
 * docs prescribe for effects that are not content.
 *
 * ## Design Decisions
 *
 * - **Approval means monitor mode.** Approving activates the rule in `monitor`
 *   mode, where it records matches without changing labels. Turning on labels
 *   is a separate admin step on `/system/traffic`, so no AI proposal can change
 *   a figure without an operator switching it on.
 * - **Not editable in the queue.** The queue's editor edits free text, and a
 *   rule's conditions are structured. Edits happen on `/system/traffic`.
 * - **Evidence travels with the rule.** The preview the agent saw is stored on
 *   the rule and rendered by `describe()`, so the curator decides on the same
 *   figures without a ClickHouse query each time the queue is listed.
 */

import type { IBotRule, IContentDescriptor, IContentDescriptorField, ICurationType, ISystemLogService } from '@/types';
import type { BotRulesService } from './bot-rules.service.js';

/** Curation type id; the propose tool binds its `curationTypeId` to it. */
export const BOT_RULE_CURATION_TYPE_ID = 'traffic:bot-rule';

/**
 * Describe a rule's conditions as label and value pairs for the review screen.
 *
 * @param rule - The proposed rule.
 * @returns One field per condition the rule sets.
 */
export function describeBotRuleConditions(rule: IBotRule): IContentDescriptorField[] {
    const fields: IContentDescriptorField[] = [];
    const c = rule.conditions;
    if (c.asns?.length) {
        fields.push({ label: 'Networks (ASN)', value: c.asns.join(', ') });
    }
    if (c.countries?.length) {
        fields.push({ label: 'Countries', value: c.countries.join(', ') });
    }
    if (c.userAgentContains?.length) {
        fields.push({ label: 'Browser identifier contains (all)', value: c.userAgentContains.join(' + ') });
    }
    if (c.pathPrefixes?.length) {
        fields.push({ label: 'Path starts with (any)', value: c.pathPrefixes.join(', ') });
    }
    if (c.eventType) {
        fields.push({ label: 'Event type', value: c.eventType });
    }
    if (c.referrer) {
        fields.push({ label: 'Referrer', value: c.referrer });
    }
    if (c.networkMismatch) {
        fields.push({
            label: 'Page load and report differ by',
            value: `${c.networkMismatch.compare} within ${c.networkMismatch.withinSeconds}s`
        });
    }
    return fields;
}

/**
 * Describe the evidence recorded with a proposal.
 *
 * @param rule - The proposed rule.
 * @returns Fields summarising the preview, or a single field saying none was recorded.
 */
function describeEvidence(rule: IBotRule): IContentDescriptorField[] {
    const evidence = rule.evidence;
    let fields: IContentDescriptorField[];
    if (!evidence) {
        fields = [{ label: 'Evidence', value: 'No preview was recorded (the analytics store was unavailable).' }];
    } else {
        const labels = Object.entries(evidence.eventsByCurrentLabel)
            .map(([label, count]) => `${label}: ${count}`)
            .join(', ');
        fields = [
            { label: `Matched in the last ${evidence.windowDays} days`, value: `${evidence.matchedEvents} events from ${evidence.matchedCookies} cookies` },
            { label: 'Current labels of matched events', value: labels || 'none' },
            { label: 'Matched cookies that logged in', value: String(evidence.loggedInCookies) },
            { label: 'Matched cookies seen on 2+ days', value: String(evidence.returningCookies) },
            { label: 'Distinct referrer domains', value: String(evidence.distinctReferrerDomains) },
            { label: 'Distinct browser identifiers', value: String(evidence.distinctUserAgents) }
        ];
    }
    return fields;
}

/**
 * Build the `traffic:bot-rule` curation type over the rules service.
 *
 * @param rules - The bot rules service the opaque `{ ruleId }` ref resolves against.
 * @param logger - Traffic-module logger for decision diagnostics.
 * @returns The curation type to register on the core `'curation'` service.
 */
export function createBotRuleCurationType(rules: BotRulesService, logger: ISystemLogService): ICurationType {
    return {
        typeId: BOT_RULE_CURATION_TYPE_ID,
        label: 'Bot Rule',
        decisionStatus: { approved: 'active', rejected: 'rejected' },

        /**
         * Render a held rule for the review screen: its conditions, label, the
         * agent's note, and the evidence recorded at proposal time.
         *
         * @param ref - `{ ruleId }`, as the propose tool held it.
         * @returns The descriptor the curation queue renders.
         */
        describe: async (ref): Promise<IContentDescriptor> => {
            const rule = await rules.get(String(ref.ruleId ?? ''));
            let descriptor: IContentDescriptor;
            if (!rule) {
                descriptor = { title: 'Bot rule (unavailable)', body: 'The proposed rule no longer exists; it was probably deleted on /system/traffic.' };
            } else {
                descriptor = {
                    title: `Bot rule: ${rule.name}`,
                    summary: `Would label matching traffic as ${rule.label}. Approving starts it in monitor mode; labels change only after an admin switches it to label mode on /system/traffic.`,
                    body: rule.note ?? 'No reason was given.',
                    details: [
                        ...describeBotRuleConditions(rule),
                        { label: 'Label', value: rule.label },
                        ...describeEvidence(rule)
                    ],
                    editable: false
                };
            }
            return descriptor;
        },

        /**
         * Commit a curator's decision. Only status transitions are accepted; a
         * text edit is refused because rule conditions are edited on
         * `/system/traffic`. A rule already decided or deleted is logged, not
         * thrown, so a stale decision does not read as a failure.
         *
         * @param ref - `{ ruleId }`.
         * @param patch - `{ status: 'active' | 'rejected' }` from the decision.
         */
        applyEdit: async (ref, patch): Promise<void> => {
            const ruleId = String(ref.ruleId ?? '');
            if (typeof patch.status !== 'string') {
                throw new Error('Bot rules are edited on /system/traffic, not in the curation queue');
            }
            if (patch.status !== 'active' && patch.status !== 'rejected') {
                throw new Error(`Unsupported bot rule status transition: '${patch.status}'`);
            }
            const decided = await rules.decideProposal(ruleId, patch.status);
            if (decided) {
                logger.info({ ruleId, status: patch.status }, 'Curation decision applied to proposed bot rule');
            } else {
                logger.warn({ ruleId, status: patch.status }, 'Bot rule decision no-op: rule missing or no longer proposed');
            }
        }
    };
}
