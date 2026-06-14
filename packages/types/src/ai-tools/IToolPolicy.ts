/**
 * @file IToolPolicy.ts
 *
 * Governance policy for an AI tool invocation. The policy engine resolves a
 * tool's effective policy from its capability class (with admin overrides) and
 * returns a decision the governor enforces before a handler runs.
 */

/**
 * Limits and gates the governor applies to a tool invocation. Every field is
 * optional; an omitted field means "no limit of this kind". Defaults are
 * derived from the tool's capability class by the policy engine, then merged
 * with any admin override.
 */
export interface IToolPolicy {
    /** Maximum invocations allowed within a rolling window, across all callers. */
    rateLimit?: { max: number; windowMs: number };

    /** Maximum invocations allowed per actor within a rolling window. */
    quota?: { max: number; windowMs: number };

    /**
     * Maximum spend, in USD, within a rolling 24h window before the governor
     * denies further invocations. Enforced per tool by charging the declared
     * `capability.costPerCallUsd` on each allowed call — a tool with no declared
     * per-call cost cannot be enforced. Applies to money-spending tools
     * (`capability.spendsMoney`).
     */
    costCeilingUsd?: number;

    /** Require human approval before the handler runs. */
    requireApproval?: boolean;

    /**
     * Permit this tool on autonomous trigger paths (`scheduled`,
     * `programmatic`). Defaults to false for `external` tools — an unattended
     * run has no human to catch a mistake.
     */
    allowUnattended?: boolean;
}

/** The governor's verdict for a single invocation. */
export type ToolPolicyVerdict = 'allow' | 'deny' | 'needs-approval';

/** A policy decision plus its reason, surfaced to the audit record and the model. */
export interface IToolPolicyDecision {
    /** Whether the invocation may proceed, is blocked, or needs human approval. */
    verdict: ToolPolicyVerdict;

    /** Human-readable reason, recorded in the audit trail and returned on denial. */
    reason?: string;
}
