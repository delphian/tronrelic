/**
 * @file IAiToolCapability.ts
 *
 * Declarative governance metadata for an AI tool. A tool classifies what it
 * does to the world and how sensitive its data is; the governor derives the
 * guardrails (rate limit, quota, cost cap, approval, audit redaction) from the
 * class instead of trusting prose in the tool description.
 */

import type { IToolPolicy } from './IToolPolicy.js';

/**
 * What a tool does to the world.
 * - `read` — returns data, mutates nothing.
 * - `write` — mutates internal platform state.
 * - `external` — causes an effect outside the platform (posts, sends, spends).
 */
export type AiToolSideEffect = 'read' | 'write' | 'external';

/**
 * Sensitivity of the data a tool returns. Drives audit-log redaction and
 * lethal-trifecta accounting.
 * - `public` — already-public information.
 * - `internal` — operational data not meant for the public.
 * - `secret` — may contain credentials, PII, or private user data.
 */
export type AiToolSensitivity = 'public' | 'internal' | 'secret';

/**
 * Governance classification a tool declares so the governor can apply the
 * right guardrails. Absent on a tool, the governor treats it as
 * `read` / `internal` and warns at startup so unclassified tools stay visible.
 */
export interface IAiToolCapability {
    /** What the tool does to the world. */
    sideEffect: AiToolSideEffect;

    /** Whether the tool's effect can be undone. Irreversible effects default to requiring approval. */
    reversible: boolean;

    /** Whether invoking the tool costs money (a paid upstream API). Drives cost ceilings and quotas. */
    spendsMoney?: boolean;

    /**
     * Representative USD cost of one successful invocation, charged against an
     * operator's cost ceiling (`IToolPolicy.costCeilingUsd`). A tool that sets
     * `spendsMoney: true` must declare this so the governor can hold a running
     * spend tally; the registry warns when it is missing. Set it to the
     * worst-case per-call cost for variable-cost tools so the ceiling errs
     * toward safety.
     */
    costPerCallUsd?: number;

    /** Sensitivity of the data the tool returns. */
    sensitivity: AiToolSensitivity;

    /**
     * Whether the tool surfaces attacker-controlled text into the model
     * (on-chain memos, fetched web pages, social timelines). Marks the tool as
     * a prompt-injection source for lethal-trifecta accounting.
     */
    surfacesUntrustedContent?: boolean;

    /** Whether each invocation must be approved by a human before it runs. */
    requiresApproval?: boolean;

    /**
     * Whether the tool is safe to run on autonomous trigger paths (scheduled
     * prompts, programmatic `ask()` from other plugins). Defaults to false for
     * `external` tools — an unattended run has no human to catch a mistake — and
     * true otherwise. Declaring it lets a tool author opt a genuinely-safe
     * external tool into unattended use without an operator policy override; an
     * admin policy override still wins over this declaration.
     */
    allowUnattended?: boolean;

    /**
     * Named policy id, or an inline policy, overriding the class-derived
     * defaults. Resolved by the governor's policy engine.
     */
    policy?: string | IToolPolicy;
}
