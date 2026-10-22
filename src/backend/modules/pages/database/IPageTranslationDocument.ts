/**
 * @fileoverview MongoDB document shape for CMS page translations.
 *
 * A translation is managed content (`core:page-translation`), so, like a page,
 * it keeps two versions: the top-level fields hold the latest edit and the
 * `approved` snapshot holds what visitors see while a newer edit waits for
 * review.
 */

import type { ObjectId } from 'mongodb';
import type { IContentPayloadRecord } from '@/types';

/**
 * The frozen copy of a translation as a curator last approved it.
 */
export interface IPageTranslationVersionDocument {
    title: string;
    content: string;
    description: string;
    keywords: string[];
    published: boolean;
    ogImage: string | null;
    /** Fingerprint of the English text this version was written against. */
    sourceHash: string;
    /** When the core content service asked for this version to be approved. */
    approvedAt: Date;
}

/**
 * One page translated into one language, stored in `module_pages_translations`.
 *
 * `(pageId, language)` is unique across live and soft-deleted documents, so a
 * deleted translation is brought back with a restore rather than created again.
 */
export interface IPageTranslationDocument extends IContentPayloadRecord {
    _id: ObjectId;
    /** Core content id of the page this translates. */
    pageId: string;
    /** Language code, such as `zh`. */
    language: string;
    title: string;
    /** Markdown including the frontmatter block. */
    content: string;
    description: string;
    keywords: string[];
    published: boolean;
    ogImage: string | null;
    /** Fingerprint of the English text the latest edit was written against. */
    sourceHash: string;
    createdAt: Date;
    updatedAt: Date;
    /** The approved snapshot, or null when no version has been approved. */
    approved: IPageTranslationVersionDocument | null;
}
