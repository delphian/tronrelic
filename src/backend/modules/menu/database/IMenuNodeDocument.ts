import { ObjectId } from 'mongodb';
import type { UserIdentityState } from '@/types';

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
    description?: string;
    url?: string;
    icon?: string;
    order: number;
    parent: ObjectId | null;
    enabled: boolean;
    /**
     * Allow-list of identity states that may see the node. See
     * `IMenuNode.allowedIdentityStates` for semantics.
     */
    allowedIdentityStates?: UserIdentityState[];
    /**
     * Required group memberships (OR-of-membership). See
     * `IMenuNode.requiresGroups` for semantics.
     */
    requiresGroups?: string[];
    /**
     * Admin-only flag, evaluated through `IUserGroupService.isAdmin`. See
     * `IMenuNode.requiresAdmin` for semantics.
     */
    requiresAdmin?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}
