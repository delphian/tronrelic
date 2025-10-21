import { Schema, model, type Document } from 'mongoose';
import type { IMenuNode } from '@tronrelic/types';

/**
 * Plain field interface for MenuNode documents.
 *
 * Use this when working with `.lean()` queries to avoid type mismatches with
 * Mongoose Document types. Represents the stored data structure for menu nodes
 * in MongoDB without Mongoose-specific properties.
 */
export interface MenuNodeFields {
    label: string;
    url?: string;
    icon?: string;
    order: number;
    parent?: string | null;
    enabled: boolean;
    requiredRole?: string;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Mongoose document interface for MenuNode.
 *
 * Extends both Document (for Mongoose methods like save, remove) and MenuNodeFields
 * (for domain properties). Use this when working with Mongoose model instances.
 */
export interface MenuNodeDoc extends Document, MenuNodeFields {}

/**
 * MongoDB schema for menu node documents.
 *
 * Defines the structure, validation, and indexes for menu nodes stored in the
 * database. Menu nodes support unlimited hierarchical nesting through the parent
 * reference field, which links to another node's _id.
 *
 * Indexes:
 * - parent + order: Efficient querying of children sorted by display order
 * - enabled: Fast filtering of visible vs hidden nodes
 */
const MenuNodeSchema = new Schema<MenuNodeDoc>(
    {
        /**
         * Display label for the menu item.
         * Required field shown in navigation UI.
         */
        label: { type: String, required: true },

        /**
         * Optional navigation URL or route path.
         * Omit for container/category nodes that aren't clickable.
         */
        url: { type: String },

        /**
         * Optional icon identifier for visual representation.
         * Frontend determines rendering (e.g., lucide-react icon name).
         */
        icon: { type: String },

        /**
         * Sort order within the same parent level.
         * Lower numbers appear first. Default 0.
         */
        order: { type: Number, required: true, default: 0 },

        /**
         * Parent node ID for hierarchical organization.
         * Null indicates a root-level node. References another MenuNode's _id.
         */
        parent: { type: String, default: null, index: true },

        /**
         * Visibility flag controlling whether the node appears in navigation.
         * Default true. Disabled nodes remain in tree but hidden from users.
         */
        enabled: { type: Boolean, required: true, default: true },

        /**
         * Optional access control role or permission requirement.
         * Frontend can check this before rendering navigation.
         */
        requiredRole: { type: String },

        /**
         * Timestamp when the node was created.
         */
        createdAt: { type: Date, default: () => new Date() },

        /**
         * Timestamp when the node was last modified.
         */
        updatedAt: { type: Date, default: () => new Date() }
    },
    { versionKey: false }
);

/**
 * Compound index for efficient child node queries sorted by order.
 * Enables fast retrieval of all children under a parent, sorted by display position.
 */
MenuNodeSchema.index({ parent: 1, order: 1 });

/**
 * Index on enabled field for filtering visible nodes.
 * Allows quick queries like "get all enabled root nodes".
 */
MenuNodeSchema.index({ enabled: 1 });

/**
 * Pre-save hook to update the updatedAt timestamp.
 *
 * Automatically sets updatedAt to current date whenever a document is saved,
 * providing an accurate audit trail of modifications.
 */
MenuNodeSchema.pre('save', function menuNodeUpdate(next) {
    this.updatedAt = new Date();
    next();
});

/**
 * MenuNode model for menu system storage.
 *
 * Provides CRUD operations for menu nodes in MongoDB. The MenuService singleton
 * uses this model to persist menu structure changes and load the tree on startup.
 *
 * Example usage:
 * ```typescript
 * const homeNode = await MenuNodeModel.create({
 *     label: 'Home',
 *     url: '/',
 *     icon: 'Home',
 *     order: 0,
 *     parent: null,
 *     enabled: true
 * });
 * ```
 */
export const MenuNodeModel = model<MenuNodeDoc>('MenuNode', MenuNodeSchema);
