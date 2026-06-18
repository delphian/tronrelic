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
     * Whether the tool reads or mutates objects owned by a specific end user
     * (their files, their records), as opposed to global or admin-scoped data.
     * Such a tool MUST scope every object access to the trusted end-user
     * principal — which the governor passes to the handler as its second
     * argument (`handler(input, principal)`), never from model `input`. Knowing
     * an id is not authorization, so the handler verifies ownership against
     * `principal.userId` before returning or touching an object (the BOLA guard).
     *
     * Setting this turns that obligation into an enforceable precondition: the
     * governor denies the call when no end-user principal is present, so the
     * tool can never run under the actor's ambient server/admin authority,
     * where "the user" is undefined and the ownership check has nothing to
     * check against. Core cannot verify the handler performs the check, but it
     * can — and does — refuse to run the tool without the identity the check
     * needs. Leave unset for tools that operate on global or admin-scoped data;
     * a normal tool is unaffected by the presence or absence of a principal.
     */
    operatesOnUserOwnedObjects?: boolean;

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

    /**
     * Namespaced id of the core curation type this tool routes every effect
     * into (e.g. `x-poster:tweet`). It turns `forcesCuratorReview` from a
     * self-attestation into a verifiable binding: when present, the governor
     * honours the curator-review relaxation only while a matching type is
     * registered on the `'curation'` service, and re-tightens the tool's gates
     * the moment that owner goes away. Omit it to keep the legacy honour-system
     * behaviour, where `forcesCuratorReview: true` is trusted on the tool's word
     * (the tool runs its own private review queue). Declaring it without
     * `forcesCuratorReview: true` is incoherent and rejected at registration.
     */
    curationTypeId?: string;
}
