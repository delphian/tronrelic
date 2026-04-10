import { ObjectId } from 'mongodb';

/**
 * MongoDB document interface for menu node overrides.
 *
 * Stores user-customized properties for memory-only menu nodes (plugin-registered).
 * Keyed by (namespace, url) to match plugin re-registrations across restarts.
 * When a plugin registers a menu item, the service checks this collection and
 * applies any stored overrides so user customizations survive deployments.
 */
export interface IMenuNodeOverrideDocument {
    _id: ObjectId;
    namespace: string;
    url: string;
    order?: number;
    icon?: string;
    label?: string;
    enabled?: boolean;
    createdAt: Date;
    updatedAt: Date;
}
