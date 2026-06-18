/**
 * @file capability-linter.ts
 *
 * Registration-time lint for a tool's capability declaration.
 *
 * The governor derives every guardrail from the declared capability, so a wrong
 * or missing classification silently weakens the platform: a paid tool the cost
 * ceiling cannot charge, a read tool wrongly shipped disabled, or — the F3
 * footgun — a tool that surfaces attacker-influenceable text without the
 * `surfacesUntrustedContent` flag the governor needs to wrap its output. Core
 * cannot read a handler's intent, but it *can* reject declarations that
 * contradict themselves and warn on the ones that read like a misclassification.
 * Running this once at `registerTool` makes a mistake fail loudly at boot
 * instead of surfacing as a missing control much later.
 *
 * `error` findings block registration; `warn` findings are logged and the tool
 * still registers. The function is pure so it unit-tests without a registry.
 */

import type { IAiTool } from '@/types';

/** Severity of a capability lint finding. `error` blocks registration. */
export type CapabilityLintSeverity = 'error' | 'warn';

/** One problem found in a tool's capability declaration. */
export interface ICapabilityLintFinding {
    /** `error` rejects the registration; `warn` is logged and allowed. */
    severity: CapabilityLintSeverity;

    /** Operator-facing explanation, including the fix. */
    message: string;
}

/**
 * Description fragments that read like the tool returns text authored by an
 * external, attacker-influenceable party. Matching one is a *heuristic* signal —
 * not proof — that the tool should declare `surfacesUntrustedContent`. The list
 * stays narrow to free-text authored off-platform; on-chain numeric fields and
 * platform-internal data are not injection vectors and must not appear here.
 */
const UNTRUSTED_CONTENT_HINTS = [
    'memo', 'tweet', 'timeline', 'social media', 'web page', 'web fetch',
    'fetched content', 'user comment', 'username', 'display name', 'profile bio', 'caption'
];

/**
 * Find the first untrusted-content hint a description mentions, if any.
 *
 * @param description - The tool's description text.
 * @returns The matched hint phrase, or null when none match.
 */
function matchUntrustedHint(description: string): string | null {
    const haystack = description.toLowerCase();
    const hit = UNTRUSTED_CONTENT_HINTS.find(hint => haystack.includes(hint));
    return hit ?? null;
}

/**
 * Lint a tool's capability declaration for contradictions and likely
 * misclassifications.
 *
 * @param tool - The tool being registered.
 * @returns Findings in declaration order; empty when the capability is clean.
 */
export function lintToolCapability(tool: IAiTool): ICapabilityLintFinding[] {
    const findings: ICapabilityLintFinding[] = [];
    const cap = tool.capability;

    if (!cap) {
        findings.push({
            severity: 'warn',
            message: `AI tool "${tool.name}" registered without a capability classification; treating as read/internal`
        });
        return findings;
    }

    // A curation binding only means something for a tool that forces curator
    // review — the binding is the verification of that claim. The binding alone
    // grants nothing, so reject rather than silently honour it.
    if (cap.curationTypeId && cap.forcesCuratorReview !== true) {
        findings.push({
            severity: 'error',
            message: `AI tool "${tool.name}" declares curationTypeId "${cap.curationTypeId}" `
                + 'without forcesCuratorReview: true. Set forcesCuratorReview: true or remove curationTypeId.'
        });
    }

    // A paid tool the ceiling cannot charge escapes cost enforcement entirely.
    if (cap.spendsMoney === true && (typeof cap.costPerCallUsd !== 'number' || cap.costPerCallUsd < 0)) {
        findings.push({
            severity: 'warn',
            message: `AI tool "${tool.name}" declares spendsMoney but has an invalid or missing costPerCallUsd; `
                + 'cost-ceiling enforcement cannot charge this tool until it declares a valid non-negative per-call cost'
        });
    }

    // A cost with no spend is inert — the ceiling only charges money-spending tools.
    if (cap.costPerCallUsd !== undefined && cap.spendsMoney !== true) {
        findings.push({
            severity: 'warn',
            message: `AI tool "${tool.name}" declares costPerCallUsd without spendsMoney: true; `
                + 'the cost ceiling only charges money-spending tools, so this cost is never applied'
        });
    }

    // A read tool mutates nothing and leaves the platform untouched, so it can be
    // neither irreversible nor a money-spender. Either misclass wrongly ships the
    // tool disabled (the default-deny treats both as the dangerous class).
    if (cap.sideEffect === 'read' && cap.reversible === false) {
        findings.push({
            severity: 'warn',
            message: `AI tool "${tool.name}" declares sideEffect: 'read' with reversible: false; `
                + 'a read-only tool mutates nothing — set reversible: true or reclassify the side effect'
        });
    }
    if (cap.sideEffect === 'read' && cap.spendsMoney === true) {
        findings.push({
            severity: 'warn',
            message: `AI tool "${tool.name}" declares sideEffect: 'read' with spendsMoney: true; `
                + "spending money is an external effect — classify the side effect as 'external'"
        });
    }

    // Heuristic: the description reads like the tool returns attacker-authored
    // text but the injection-source flag is absent. Under-declaring this is the
    // F3 footgun — the governor never wraps content it is not told is untrusted.
    // Over-declaring only makes the trifecta banner more cautious, so this is a
    // loud nudge, never a reject.
    if (cap.surfacesUntrustedContent !== true) {
        const hint = matchUntrustedHint(tool.description);
        if (hint) {
            findings.push({
                severity: 'warn',
                message: `AI tool "${tool.name}" description mentions "${hint}" but does not declare `
                    + 'surfacesUntrustedContent. If it returns attacker-influenceable text, set '
                    + 'surfacesUntrustedContent: true so the governor wraps the result and the trifecta '
                    + 'detector counts the injection leg. Ignore if the content is not externally authored.'
            });
        }
    }

    return findings;
}
