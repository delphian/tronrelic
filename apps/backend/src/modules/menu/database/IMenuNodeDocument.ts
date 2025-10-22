import { ObjectId } from 'mongodb';

/**
 * MongoDB document interface for menu nodes.
 *
 * Represents the database schema for menu nodes with MongoDB-specific fields.
 * The _id field is stored as ObjectId in the database but converted to string
 * in the IMenuNode interface for framework independence.
 *
 * This interface is used with the native MongoDB driver (not Mongoose) to provide
 * direct collection access through the IPluginDatabase dependency injection pattern.
 *
 * @example
 * ```typescript
 * const collection = database.getCollection<IMenuNodeDocument>('menu_nodes');
 * const nodes = await collection.find({}).toArray();
 * ```
 */
export interface IMenuNodeDocument {
    _id: ObjectId;
    namespace: string;
    label: string;
    url?: string;
    icon?: string;
    order: number;
    parent: ObjectId | null;
    enabled: boolean;
    requiredRole?: string;
    createdAt?: Date;
    updatedAt?: Date;
}
