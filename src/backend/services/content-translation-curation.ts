/**
 * @fileoverview The curation binding for proposed translations of managed
 * content, registered as `core:content-translation`.
 *
 * A translation proposed by someone who is not a curator waits in the central
 * curation queue until a curator decides it. It cannot use the binding core
 * generates for each managed type, for three reasons:
 *
 * - That binding's hold state is one per item, on the item's core row, so a
 *   translation hold and an English edit hold on the same item would merge.
 * - Its approval promotes the item's English working version.
 * - It inherits the type's `publishesToSinks`, so approving a blog post's
 *   translation would ask the curator to post it to X or Telegram again.
 *
 * This binding is one core-owned type for every translatable type. It never
 * publishes to sinks, and it forwards each decision to the translation
 * service, which keeps the hold state per item and language.
 *
 * An approval does fire `content.published`, with this binding's type id,
 * because a translation going live is a publication. A hook subscriber that
 * should not react to translations filters on `typeId`.
 *
 * @module backend/services/content-translation-curation
 */

import type { ContentCurationState, IContentChangeSet, IContentDescriptor, ICurationType } from '@/types';

/** Curation type id every proposed translation is held under. */
export const CONTENT_TRANSLATION_CURATION_TYPE_ID = 'core:content-translation';

/** Provider id the binding is registered under on the curation service. */
export const CONTENT_TRANSLATION_CURATION_PROVIDER_ID = 'core';

/**
 * Where the binding sends each call. The translation service implements all
 * three; they are passed in so this file does not depend on it.
 */
export interface ITranslationCurationHandlers {
    /** Render a proposal for the queue. */
    describe: (ref: Record<string, unknown>) => Promise<IContentDescriptor>;
    /** Compare a proposal with the translation visitors read now. */
    describeChanges: (ref: Record<string, unknown>) => Promise<IContentChangeSet>;
    /** Apply a curator's decision. */
    decide: (ref: Record<string, unknown>, decision: Exclude<ContentCurationState, 'pending'>) => Promise<void>;
}

/**
 * Build the `core:content-translation` curation binding.
 *
 * Proposals are not edited inline in the queue. An inline edit would skip the
 * checks a proposal passes when it is made, so the binding refuses a body edit
 * and the descriptor reports itself read-only.
 *
 * @param handlers - The translation service's describe, compare, and decide methods.
 * @returns The curation type to register on the `'curation'` service.
 */
export function createTranslationCurationType(handlers: ITranslationCurationHandlers): ICurationType {
    const curationType: ICurationType = {
        typeId: CONTENT_TRANSLATION_CURATION_TYPE_ID,
        label: 'Content translation',
        publishesToSinks: false,
        decisionStatus: { approved: 'approved', rejected: 'rejected' },

        /**
         * Render the proposal for the queue, always read-only.
         *
         * @param ref - `{ typeId, id, language, holdId }`.
         * @returns The descriptor with `editable` forced off.
         */
        async describe(ref) {
            const descriptor = await handlers.describe(ref);

            return { ...descriptor, editable: false };
        },

        /**
         * Compare the proposal with the translation visitors read now.
         *
         * @param ref - `{ typeId, id, language, holdId }`.
         * @returns The change set.
         */
        async describeChanges(ref) {
            return handlers.describeChanges(ref);
        },

        /**
         * Forward a curator's decision to the translation service. A body
         * edit is refused because it would skip the proposal checks.
         *
         * @param ref - `{ typeId, id, language, holdId }`.
         * @param patch - The decision status word, or an inline body edit.
         * @throws When the status word is unknown or a body edit is attempted.
         */
        async applyEdit(ref, patch) {
            if (typeof patch.status === 'string') {
                if (patch.status !== 'approved' && patch.status !== 'rejected') {
                    throw new Error(`Unsupported decision '${patch.status}' for proposed translations`);
                }
                await handlers.decide(ref, patch.status);
            } else if (patch.body !== undefined) {
                throw new Error('Proposed translations are not edited here. Reject it and change the translation in its editor instead.');
            }

            return;
        }
    };

    return curationType;
}
