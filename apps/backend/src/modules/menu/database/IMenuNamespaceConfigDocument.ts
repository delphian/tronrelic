import { ObjectId } from 'mongodb';

/**
 * MongoDB document interface for menu namespace configurations.
 *
 * Represents the database schema for namespace-level menu configurations with
 * MongoDB-specific fields. The _id field is stored as ObjectId in the database
 * but converted to string in the IMenuNamespaceConfig interface for framework
 * independence.
 *
 * This interface is used with the native MongoDB driver (not Mongoose) to provide
 * direct collection access through the IPluginDatabase dependency injection pattern.
 *
 * Each namespace can have at most one configuration document. The namespace field
 * should have a unique index to enforce this constraint.
 *
 * @example
 * ```typescript
 * const collection = database.getCollection<IMenuNamespaceConfigDocument>('menu_namespace_config');
 * const config = await collection.findOne({ namespace: 'main' });
 * ```
 */
export interface IMenuNamespaceConfigDocument {
    /**
     * MongoDB-assigned unique identifier.
     */
    _id: ObjectId;

    /**
     * Menu namespace this configuration applies to.
     *
     * Should have a unique index to ensure one config per namespace.
     */
    namespace: string;

    /**
     * Hamburger menu (collapsed mobile navigation) settings.
     */
    hamburgerMenu?: {
        enabled: boolean;
        triggerWidth: number;
    };

    /**
     * Icon display settings for menu items.
     */
    icons?: {
        enabled: boolean;
        position?: 'left' | 'right' | 'top';
    };

    /**
     * Layout and structural settings.
     */
    layout?: {
        orientation: 'horizontal' | 'vertical';
        maxItems?: number;
    };

    /**
     * Visual styling hints.
     */
    styling?: {
        compact?: boolean;
        showLabels?: boolean;
    };

    /**
     * Timestamp when configuration was created.
     */
    createdAt?: Date;

    /**
     * Timestamp when configuration was last updated.
     */
    updatedAt?: Date;
}
