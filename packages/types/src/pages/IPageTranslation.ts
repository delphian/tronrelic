/**
 * @file IPageTranslation.ts
 *
 * A page translation as the admin API returns it. It carries the latest edit,
 * the review and deletion state from the core content service, and whether the
 * English page has changed since the translation was written, which is what
 * the editor needs to show a translator what to work on next.
 */

import type { ContentCurationState } from '../content/ContentCurationState.js';

/**
 * One page translation, latest edit, as the `/system/pages` editor shows it.
 */
export interface IPageTranslation {
    /** Core content id of the translation itself. */
    contentId: string;

    /** Core content id of the page this translates. */
    pageId: string;

    /** Language code of the translation, such as `zh`. */
    language: string;

    /** Translated title, from the frontmatter. */
    title: string;

    /** Full markdown including the frontmatter block. */
    content: string;

    /** Translated SEO description. */
    description: string;

    /** Translated SEO keywords. */
    keywords: string[];

    /** Whether the latest edit is marked published in its frontmatter. */
    published: boolean;

    /** Open Graph image URL for this language, when one is set. */
    ogImage?: string;

    /**
     * True when the English page has changed since this translation was last
     * saved. A stale translation is still served; the flag only tells the
     * translator it may need updating.
     */
    stale: boolean;

    /** Review state of the latest edit. Absent when the translation never entered review. */
    curation?: ContentCurationState;

    /** Whether a curator has approved some version, which visitors then see. */
    hasApprovedVersion?: boolean;

    /** When the translation was soft-deleted; absent while it is live. */
    deletedAt?: Date;

    /** When the translation was created. */
    createdAt: Date;

    /** When the translation was last changed. */
    updatedAt: Date;
}
