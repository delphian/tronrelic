/**
 * @file IContentTranslationStatus.ts
 *
 * The state of one translation, reduced to what an admin list needs to show
 * at a glance: which languages an item has, whether each is live, and whether
 * each needs another pass. A content type's admin list shows it beside every
 * item, so an operator can see how much is translated without opening each
 * item's translation editor.
 */

/**
 * One translation's state, without its text.
 */
export interface IContentTranslationStatus {
    /** Language code of the translation, such as `zh`. */
    language: string;

    /** Whether visitors are served the translation. */
    published: boolean;

    /**
     * True when the English text has changed since the translation was last
     * saved and the translation is not custom.
     */
    stale: boolean;

    /**
     * True when a curator marked the translation as custom, so it no longer
     * tracks the English and is never stale. False for a proposal-only language.
     */
    custom: boolean;

    /** True when the translation is soft-deleted. */
    deleted: boolean;

    /**
     * False when the language has only a proposal waiting for review and no
     * saved translation yet. `published`, `stale`, and `deleted` are then false.
     */
    saved: boolean;

    /** True when a proposed translation for this language is waiting for review. */
    proposalPending: boolean;
}
