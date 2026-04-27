/**
 * Admin-defined user-group definition.
 *
 * Groups are lightweight named tags. Plugins read group membership via
 * `IUserGroupService` and decide for themselves what permissions a group
 * confers — the platform owns the namespace, not the policy.
 *
 * The `id` is a stable kebab-case slug used by plugins (`'vip-traders'`).
 * The `name` is the human label shown in the admin UI. `system: true`
 * marks rows the platform owns; admins cannot rename or delete them and
 * the seeded `admin` group is the canonical example.
 *
 * @module @/types/user
 */
export interface IUserGroup {
    /** Stable kebab-case slug used by plugins for membership lookups. */
    id: string;
    /** Human-readable label shown in admin UIs. */
    name: string;
    /** Optional admin-authored description of the group's purpose. */
    description: string;
    /**
     * True for platform-seeded groups. System groups are read-only from the
     * admin UI and cannot be deleted or renamed by operators. The reserved
     * admin namespace (`admin`, `super-admin`, etc.) is always system.
     */
    system: boolean;
    /** Document creation timestamp. */
    createdAt: Date;
    /** Last modification timestamp. */
    updatedAt: Date;
}

/**
 * Input shape for creating a new admin-defined group.
 *
 * The service rejects any `id` matching the reserved-admin pattern
 * (`admin`, `admins`, `administrator(s)`, `super-admin(s)`, `sub-admin(s)`,
 * `superadmin(s)`, `root(s)`); those names are platform-reserved and only
 * the user module itself may seed groups using them.
 */
export interface ICreateUserGroupInput {
    /** Stable kebab-case slug. Must be unique and not match the reserved-admin pattern. */
    id: string;
    /** Human-readable label. */
    name: string;
    /** Optional description. Defaults to empty string. */
    description?: string;
}

/**
 * Input shape for updating an existing admin-defined group.
 *
 * The `id` cannot be changed — groups are referenced by id from plugin
 * code, so renaming the slug would break consumers silently. The service
 * also refuses updates to system groups.
 */
export interface IUpdateUserGroupInput {
    /** Updated label. */
    name?: string;
    /** Updated description. */
    description?: string;
}
