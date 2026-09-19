/**
 * @fileoverview Makes a managed content type reviewable in the existing
 * curation queue without the type implementing any curation contract.
 *
 * The curation module decides items through `ICurationType`: it renders them
 * with `describe`, and commits a decision by writing a status word through
 * `applyEdit({ status })`. A managed content type already has `describe`, and
 * its review state belongs to core rather than to the type, so core builds the
 * `ICurationType` itself. The generated `applyEdit` forwards each decision to
 * the core content service, which records it on the core row and asks the type
 * to promote its working version. The queue, history, notifications, and admin
 * interface then work for managed content with no changes to curation.
 *
 * This is a bridge for as long as the older curation types exist alongside
 * managed content. When every reviewable type is managed, curation can call
 * the content service directly and this adapter can go.
 *
 * @module backend/services/content-curation-adapter
 */

import type { ContentCurationState, IContent, ICurationType, IManagedContentType } from '@/types';

/**
 * The decision callback the adapter forwards to — the content service's
 * `applyDecision`, bound to the type. It receives the queue item's whole ref,
 * `{ id, holdId }`, because the hold id is what tells the current queue item
 * apart from an older one for the same content.
 */
type ContentDecisionFn = (
    ref: Record<string, unknown>,
    decision: Exclude<ContentCurationState, 'pending'>
) => Promise<void>;

/**
 * Build the curation binding for a managed content type.
 *
 * Managed items are never edited inline in the curation queue. An inline edit
 * would reach the item without passing through the core content service, so
 * the veto hooks and the reviewed-field check would not run. The generated
 * type therefore reports every item as not editable and refuses a body edit.
 *
 * @param type - The managed content type to make reviewable; supplies the id,
 *   label, classification ceiling, and `describe`.
 * @param onDecision - Where a curator's approve or reject is sent; core's
 *   content service records it and promotes the working version on approval.
 * @returns The curation type to register on the `'curation'` service.
 */
export function createContentCurationType<T extends IContent, TCreate, TUpdate>(
    type: IManagedContentType<T, TCreate, TUpdate>,
    onDecision: ContentDecisionFn
): ICurationType {
    const curationType: ICurationType = {
        typeId: type.typeId,
        label: type.label,
        classification: type.classification,
        publishesToSinks: false,
        decisionStatus: { approved: 'approved', rejected: 'rejected' },

        /**
         * Render the item's working version for the queue, marked read-only so
         * the queue offers no inline editor.
         *
         * @param ref - The curation ref, `{ id, holdId }` for managed content.
         * @returns The type's descriptor with `editable` forced off.
         */
        async describe(ref) {
            const descriptor = await type.describe(ref);

            return { ...descriptor, editable: false };
        },

        /**
         * Forward a curator's decision to the core content service. A body edit
         * is refused because it would bypass the core write path.
         *
         * @param ref - The curation ref, `{ id, holdId }` for managed content.
         * @param patch - The decision status word, or an inline body edit.
         * @throws When the status word is unknown or a body edit is attempted.
         */
        async applyEdit(ref, patch) {
            if (typeof patch.status === 'string') {
                if (patch.status !== 'approved' && patch.status !== 'rejected') {
                    throw new Error(`Unsupported decision '${patch.status}' for managed content type '${type.typeId}'`);
                }
                await onDecision(ref, patch.status);
            } else if (patch.body !== undefined) {
                throw new Error(
                    `'${type.label}' items are edited in their own editor so the change passes through the core content service.`
                );
            }

            return;
        }
    };

    return curationType;
}
