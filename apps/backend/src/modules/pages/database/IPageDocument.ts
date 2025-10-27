import { ObjectId } from 'mongodb';

/**
 * MongoDB document interface for pages.
 *
 * Represents the database schema for custom pages with MongoDB-specific fields.
 * The _id field is stored as ObjectId in the database but converted to string
 * in the IPage interface for framework independence.
 *
 * This interface is used with the native MongoDB driver (not Mongoose) to provide
 * direct collection access through the IDatabaseService dependency injection pattern.
 *
 * @example
 * ```typescript
 * const collection = database.getCollection<IPageDocument>('pages');
 * const pages = await collection.find({ published: true }).toArray();
 * ```
 */
export interface IPageDocument {
    _id: ObjectId;
    title: string;
    slug: string;
    content: string;
    description: string;
    keywords: string[];
    published: boolean;
    ogImage: string | null;
    authorId: string | null;
    createdAt: Date;
    updatedAt: Date;
}
