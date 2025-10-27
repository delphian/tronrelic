import { ObjectId } from 'mongodb';

/**
 * MongoDB document interface for uploaded files.
 *
 * Represents the database schema for files uploaded via the pages module.
 * The _id field is stored as ObjectId in the database but converted to string
 * in the IPageFile interface for framework independence.
 *
 * This interface is used with the native MongoDB driver (not Mongoose) to provide
 * direct collection access through the IDatabaseService dependency injection pattern.
 *
 * @example
 * ```typescript
 * const collection = database.getCollection<IPageFileDocument>('page_files');
 * const files = await collection.find({ mimeType: /^image\// }).toArray();
 * ```
 */
export interface IPageFileDocument {
    _id: ObjectId;
    originalName: string;
    storedName: string;
    mimeType: string;
    size: number;
    path: string;
    uploadedBy: string | null;
    uploadedAt: Date;
}
