import { ObjectId } from 'mongodb';

/**
 * MongoDB document interface for admin-defined user groups.
 *
 * Stored in the `module_user_groups` collection (module id `user`, logical
 * name `groups` — see system-database.md namespace conventions). The `id`
 * field is the stable kebab-case slug consumers reference (`'vip-traders'`);
 * the MongoDB `_id` is internal. System rows (`system: true`) are seeded by
 * the platform — admins cannot rename or delete them.
 *
 * ## Indexes
 * - `{ id: 1 }` — unique, primary lookup
 * - `{ system: 1 }` — supports listGroups ordering (system rows first)
 */
export interface IUserGroupDocument {
    _id: ObjectId;
    /** Stable kebab-case slug used by plugins. */
    id: string;
    /** Human-readable label shown in admin UIs. */
    name: string;
    /** Admin-authored description (empty string when unset). */
    description: string;
    /** True for platform-seeded rows; admin UI treats these as read-only. */
    system: boolean;
    /** Document creation timestamp. */
    createdAt: Date;
    /** Last modification timestamp. */
    updatedAt: Date;
}
