/**
 * @file IPromptVariableProposal.ts
 *
 * One proposed change to the text of an admin-authored (static) prompt
 * variable, made by an AI tool and held in the central curation queue until a
 * signed-in admin decides it. A variable's text is spliced into every prompt
 * that references it, so a change reaches every one of those prompts on its
 * next run. The record is the durable thing the curation item points at: the
 * queue renders it, compares it with the live variable, and on approval writes
 * the new text only if the variable has not changed since.
 */

import type { PromptVariableProposalStatus } from './PromptVariableProposalStatus.js';

/**
 * A proposed prompt-variable edit, stored in `module_ai-tools_variable_proposals`.
 */
export interface IPromptVariableProposal {
    /** Proposal id; the curation item's `ref` carries it as `proposalId`. */
    id: string;

    /** Name of the static variable the proposal would change, without the `{% %}` delimiters. */
    variableName: string;

    /**
     * The variable's `updatedAt` when the proposal was made. Approval writes
     * the new text only while the variable still carries this value, so an
     * edit, reclassification, or delete made in between is never overwritten.
     */
    baseUpdatedAt: string;

    /** The full text the variable would hold after approval. */
    proposedContent: string;

    /** Why the proposer wants the change, shown to the curator. */
    reason: string;

    /** What produced the proposal, such as `ai-tool:ai-propose-prompt-variable-edit (mcp)`. */
    source: string;

    /** Better Auth user id of the person whose AI session proposed it, when one was known. */
    proposedBy?: string;

    /** Where the proposal stands. */
    status: PromptVariableProposalStatus;

    /** Id of the curation item holding the proposal, once it is held. */
    curationItemId?: string;

    /** ISO timestamp of when the proposal was made. */
    createdAt: string;

    /** ISO timestamp of when it left `pending`. */
    decidedAt?: string;

    /**
     * Who moved it out of `pending`: the curator's Better Auth user id for an
     * approval or rejection, or a `system:` id when it was superseded.
     */
    decidedBy?: string;

    /** Why an approved proposal could not be written, when `status` is `failed`. */
    failureReason?: string;
}
