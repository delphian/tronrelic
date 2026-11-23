/**
 * @file createPromptVariableEditCurationType.ts
 *
 * The `ai-tools:prompt-variable-edit` curation type: how a proposed change to
 * a static prompt variable's text waits for a human in `/system/curation`. A
 * prompt variable is configuration rather than content the platform
 * publishes, so this is an `ICurationType` directly, as the curation docs
 * prescribe for effects that are not content. `ai-tools:saved-prompt-edit` is
 * the precedent, and the settings below match it for the same reasons:
 *
 * - `requiresSignedInCurator`: the text splices into every prompt that
 *   references the variable, so approving a change must be a named admin's
 *   decision. The service token and the interactive auto-approve bypass
 *   cannot approve.
 * - `announcesPublication: false`: an approval is a configuration change, so
 *   it must not fire `content.published`, which hook-bound saved prompts
 *   listen on and which could repeat the text to an outside channel.
 * - Not editable in the queue: the reviewer approves exactly what was
 *   proposed, and edits a variable on `/system/ai-tools`.
 */

import type { ICurationType } from '@/types';
import { PROMPT_VARIABLE_EDIT_CURATION_TYPE_ID, type PromptVariableEditsService } from './PromptVariableEditsService.js';

/**
 * Build the curation type over the variable edits service.
 *
 * @param edits - Resolves the `{ proposalId }` ref and applies decisions.
 * @returns The type to register on the core `'curation'` service.
 */
export function createPromptVariableEditCurationType(
    edits: Pick<PromptVariableEditsService, 'describe' | 'describeChanges' | 'applyDecision'>
): ICurationType {
    return {
        typeId: PROMPT_VARIABLE_EDIT_CURATION_TYPE_ID,
        label: 'Prompt Variable Edit',
        decisionStatus: { approved: 'applied', rejected: 'rejected' },
        requiresSignedInCurator: true,
        announcesPublication: false,

        /**
         * Render a held proposal for the review screen.
         *
         * @param ref - `{ proposalId }`, as the propose tool held it.
         * @returns The descriptor the queue renders.
         */
        describe: (ref) => edits.describe(String(ref.proposalId ?? '')),

        /**
         * Compare the proposal with the variable's current text.
         *
         * @param ref - `{ proposalId }`.
         * @returns The change set, or null when the proposal or variable is gone.
         */
        describeChanges: (ref) => edits.describeChanges(String(ref.proposalId ?? '')),

        /**
         * Commit a curator's decision. Only status transitions are accepted; a
         * text edit is refused because the curator approves the proposal as
         * written.
         *
         * @param ref - `{ proposalId }`.
         * @param patch - `{ status: 'applied' | 'rejected' }` from the decision.
         * @param context - The deciding curator, required for an approval.
         */
        applyEdit: async (ref, patch, context): Promise<void> => {
            if (typeof patch.status !== 'string') {
                throw new Error('A proposed variable edit cannot be changed in the queue. Reject it, or edit the variable on /system/ai-tools.');
            }
            if (patch.status !== 'applied' && patch.status !== 'rejected') {
                throw new Error(`Unsupported prompt variable edit status transition: '${patch.status}'`);
            }
            await edits.applyDecision(String(ref.proposalId ?? ''), patch.status, context?.actorId);
        }
    };
}
