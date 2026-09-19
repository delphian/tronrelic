import { ObjectId } from 'mongodb';
import type { IContentPayloadRecord } from '@/types';

/**
 * The frozen copy of a page as a curator last approved it.
 *
 * Pages are managed content, so the pages module keeps two versions of every
 * page: the top-level fields of `IPageDocument` hold the latest edit, and this
 * snapshot holds the approved one. Visitors are served this snapshot while a
 * newer edit waits for review, which is what keeps an approved page live
 * during a re-review.
 */
export interface IPageVersionDocument {
    title: string;
    slug: string;
    oldSlugs: string[];
    content: string;
    description: string;
    keywords: string[];
    published: boolean;
    ogImage: string | null;
    /** When the core content service asked for this version to be approved. */
    approvedAt: Date;
}

/**
 * MongoDB document interface for pages.
 *
 * Represents the database schema for custom pages with MongoDB-specific fields.
 * The _id field is stored as ObjectId in the database but converted to string
 * in the IPage interface for framework independence. Every other module and
 * route addresses a page by `contentId`, the core content id.
 *
 * This interface is used with the native MongoDB driver (not Mongoose) to provide
 * direct collection access through the IDatabaseService dependency injection pattern.
 *
 * @example
 * ```typescript
 * const collection = database.getCollection<IPageDocument>('pages');
 * const page = await collection.findOne({ contentId });
 * ```
 */
export interface IPageDocument extends Partial<IContentPayloadRecord> {
    _id: ObjectId;
    title: string;
    slug: string;
    oldSlugs: string[];
    content: string;
    description: string;
    keywords: string[];
    published: boolean;
    ogImage: string | null;
    authorId: string | null;
    createdAt: Date;
    updatedAt: Date;
    /**
     * The approved snapshot, or null/absent when no version has been approved.
     * Only the content service's `approve` step writes it.
     */
    approved?: IPageVersionDocument | null;
}
