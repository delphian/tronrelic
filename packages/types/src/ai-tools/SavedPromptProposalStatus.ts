/**
 * @file SavedPromptProposalStatus.ts
 *
 * Where a proposed saved-prompt edit stands. A proposal waits in the central
 * curation queue as `pending`, and leaves that state exactly once, so a
 * repeated or late decision can tell it has nothing left to do.
 */

/**
 * - `pending`: waiting for a curator in `/system/curation`.
 * - `applied`: approved, and the new body was written to the prompt.
 * - `rejected`: a curator rejected it.
 * - `superseded`: withdrawn before a decision, because a newer proposal for the
 *   same prompt arrived or an admin saved or deleted the prompt directly.
 * - `failed`: approved, but the prompt had changed or been deleted since the
 *   proposal was made, so nothing was written.
 */
export type SavedPromptProposalStatus = 'pending' | 'applied' | 'rejected' | 'superseded' | 'failed';
