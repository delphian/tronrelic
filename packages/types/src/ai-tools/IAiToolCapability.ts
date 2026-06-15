/**
 * @file IAiToolCapability.ts
 *
 * Declarative governance metadata for an AI tool. A tool classifies what it
 * does to the world and how sensitive its data is; the governor derives the
 * guardrails (rate limit, quota, cost cap, approval, audit redaction) from the
 * class instead of trusting prose in the tool description.
 */

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
     * Representative USD cost of one invocation, charged against an operator's
     * cost ceiling (`IToolPolicy.costCeilingUsd`) each time the tool runs. A
     * tool that sets `spendsMoney: true` must declare this so the governor can
     * hold a running spend tally; the registry warns when it is missing or
     * invalid. Set it to the worst-case per-call cost for variable-cost tools so
     * the ceiling errs toward safety.
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

    /**
     * Whether the tool guarantees, by its own construction, that every effect it
     * produces is held for a human curator's review before it takes hold — a
     * built-in approval queue, for example. This describes what the tool *does*,
     * not what it *wants*: the governor derives its gates from the fact rather
     * than accepting a request to relax them. A self-curated external/irreversible
     * tool needs no governor approval (its curator is the approval, so a second
     * gate would be redundant) and is safe on autonomous trigger paths (an
     * unattended call can do no more than draft into the curator's queue). Leave
     * false unless the tool truly enforces its own human review — an operator
     * policy override is the only way to drop review for a tool that does not.
     */
    forcesCuratorReview?: boolean;
}
