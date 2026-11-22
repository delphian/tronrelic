/**
 * @file saved-prompt-edit-curation-type.ts
 *
 * The `ai-tools:saved-prompt-edit` curation type: how a proposed saved-prompt
 * edit waits for a human in `/system/curation`. A saved prompt is
 * configuration rather than content the platform publishes, so this is an
 * `ICurationType` directly, as the curation docs prescribe for effects that
 * are not content. `traffic:bot-rule` is the precedent.
 *
 * Settings that differ from a content type, and why:
 * - `requiresSignedInCurator`: saving a prompt is restricted to a signed-in
 *   admin, so approving a proposal must be too. The service token and the
 *   interactive auto-approve bypass cannot approve.
 * - `announcesPublication: false`: an approval is a configuration change, so
 *   it must not fire `content.published`, which hook-bound saved prompts
 *   listen on and which could repeat the prompt body to an outside channel.
 * - Not editable in the queue: the reviewer approves exactly what was
 *   proposed, and edits a prompt on `/system/ai-tools`.
 */

import type { ICurationType } from '@/types';
import { SAVED_PROMPT_EDIT_CURATION_TYPE_ID, type SavedPromptEditsService } from './saved-prompt-edits.service.js';

/**
 * Build the curation type over the edits service.
 *
 * @param edits - Resolves the `{ proposalId }` ref and applies decisions.
 * @returns The type to register on the core `'curation'` service.
 */
export function createSavedPromptEditCurationType(
    edits: Pick<SavedPromptEditsService, 'describe' | 'describeChanges' | 'applyDecision'>
): ICurationType {
    return {
        typeId: SAVED_PROMPT_EDIT_CURATION_TYPE_ID,
        label: 'Saved Prompt Edit',
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
         * Compare the proposal with the prompt as it is now.
         *
         * @param ref - `{ proposalId }`.
         * @returns The change set, or null when the proposal or prompt is gone.
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
                throw new Error('A proposed prompt edit cannot be changed in the queue. Reject it, or edit the prompt on /system/ai-tools.');
            }
            if (patch.status !== 'applied' && patch.status !== 'rejected') {
                throw new Error(`Unsupported saved prompt edit status transition: '${patch.status}'`);
            }
            await edits.applyDecision(String(ref.proposalId ?? ''), patch.status, context?.actorId);
        }
    };
}
