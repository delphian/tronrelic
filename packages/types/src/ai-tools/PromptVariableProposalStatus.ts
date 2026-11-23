/**
 * @file PromptVariableProposalStatus.ts
 *
 * Where a proposed prompt-variable edit stands. It moves through exactly the
 * same states as a proposed saved-prompt edit, because both wait in the same
 * curation queue and are decided the same way, so the two names share one
 * union and code that handles either kind of proposal handles both.
 */

import type { SavedPromptProposalStatus } from './SavedPromptProposalStatus.js';

/**
 * - `pending`: waiting for a curator in `/system/curation`.
 * - `applied`: approved, and the new text was written to the variable.
 * - `rejected`: a curator rejected it.
 * - `superseded`: withdrawn before a decision, because a newer proposal for the
 *   same variable arrived or an admin edited, reclassified, or deleted the
 *   variable directly.
 * - `failed`: approved, but the variable had changed or been deleted since the
 *   proposal was made, so nothing was written.
 */
export type PromptVariableProposalStatus = SavedPromptProposalStatus;
