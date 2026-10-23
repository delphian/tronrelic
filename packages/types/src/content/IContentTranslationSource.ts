/**
 * @file IContentTranslationSource.ts
 *
 * The English text an item's translations are written against, with the field
 * list that describes it. Core picks this version once, and the translation
 * editor, the Suggest request, and the stale check all use it, so a translator
 * never works from different text than the stale check compares with.
 *
 * It is the version visitors are served, or the latest edit when no version is
 * served yet. An English edit waiting for review is not used, because a
 * curator may reject it, and a translation of it would then put text live in
 * another language that never went live in English.
 */

import type { ITranslatableField } from './ITranslatableField.js';
import type { TranslationValues } from './TranslationValues.js';

/**
 * The English side of the translation editor.
 */
export interface IContentTranslationSource {
    /** The managed content type, for example `core:page`. */
    typeId: string;

    /** Core content id of the item. */
    contentId: string;

    /** The fields a translation carries, in the order the editor shows them. */
    fields: ITranslatableField[];

    /** The English values, keyed by field name. */
    values: TranslationValues;

    /**
     * True when a newer English edit that changes the translatable text is
     * waiting for review. Once a curator approves it, every translation
     * written against this source is flagged stale, so the editor warns the
     * translator that a second pass is coming.
     */
    pendingEdit: boolean;
}
