/**
 * @file ISavedPromptProposal.ts
 *
 * One proposed change to a saved prompt's body, made by an AI tool and held
 * in the central curation queue until a signed-in admin decides it. The
 * record is the durable thing the curation item points at: the queue renders
 * it, compares it with the live prompt, and on approval writes its body to the
 * prompt only if the prompt has not changed since.
 */

import type { SavedPromptProposalStatus } from './SavedPromptProposalStatus.js';

/**
 * A proposed saved-prompt edit, stored in `module_ai-tools_prompt_proposals`.
 */
export interface ISavedPromptProposal {
    /** Proposal id; the curation item's `ref` carries it as `proposalId`. */
    id: string;

    /** Id of the saved prompt the proposal would change. */
    promptId: string;

    /** The prompt's name when the proposal was made, for display after a rename or delete. */
    promptName: string;

    /**
     * The prompt's `updatedAt` when the proposal was made. Approval writes the
     * new body only while the prompt still carries this value, so an edit made
     * in between is never overwritten.
     */
    baseUpdatedAt: string;

    /** The full body the prompt would have after approval. */
    proposedPrompt: string;

    /** Why the proposer wants the change, shown to the curator. */
    reason: string;

    /** What produced the proposal, such as `ai-tool:ai-propose-saved-prompt-edit (mcp)`. */
    source: string;

    /** Better Auth user id of the person whose AI session proposed it, when one was known. */
    proposedBy?: string;

    /** Where the proposal stands. */
    status: SavedPromptProposalStatus;

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
