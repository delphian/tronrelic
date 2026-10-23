/**
 * @file IContentTranslation.ts
 *
 * One translation as the admin API returns it: the translated values the
 * content author stores, joined with the state core keeps. The translation
 * editor needs both to show a translator what exists, what is live, and what
 * needs another pass.
 */

import type { TranslationValues } from './TranslationValues.js';

/**
 * A content item's translation into one language.
 */
export interface IContentTranslation {
    /** The managed content type, for example `core:page`. */
    typeId: string;

    /** Core content id of the translated item. */
    contentId: string;

    /** Language code of the translation, such as `zh`. */
    language: string;

    /** The translated values, keyed by field name. */
    values: TranslationValues;

    /**
     * Whether visitors are served this translation. Off by default, so a
     * translator can save a draft without putting it live.
     */
    published: boolean;

    /**
     * True when the English text has changed since this translation was last
     * saved. A stale translation is still served; the flag only tells the
     * translator it may need updating.
     */
    stale: boolean;

    /** When the translation was soft-deleted; absent while it is live. */
    deletedAt?: Date;

    /** When the translation was first saved. */
    createdAt: Date;

    /** Who first saved it. */
    createdBy: string;

    /** When it was last changed. */
    updatedAt: Date;

    /** Who last changed it. */
    updatedBy: string;
}
