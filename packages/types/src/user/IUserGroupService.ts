/**
 * Public service contract for the admin-defined user-group system.
 *
 * The user module registers a concrete implementation of this interface
 * on the service registry as `'user-groups'`. Consumers (other modules
 * or plugins) discover it via `context.services.get<IUserGroupService>(
 * 'user-groups')` for one-shot reads, or `context.services.watch(...)`
 * when their behavior depends on the service being present over time.
 *
 * Groups are *light tags*: this contract gives consumers the ability to
 * list/inspect group definitions, check membership, and mutate membership
 * programmatically. Permission semantics are the consumer's responsibility
 * — the platform does not interpret group membership beyond the special
 * `isAdmin` predicate, which always reflects membership in any
 * system-flagged group whose id matches the reserved-admin pattern.
 *
 * @module @/types/user
 */

import type {
    IUserGroup,
    ICreateUserGroupInput,
    IUpdateUserGroupInput
} from './IUserGroup.js';

export interface IUserGroupService {
    // -------- Definition CRUD --------

    /**
     * List all defined groups, system rows included.
     *
     * Ordering is stable (system groups first, then admin-defined groups
     * by id ascending) so admin UIs can render without sorting.
     */
    listGroups(): Promise<IUserGroup[]>;

    /**
     * Look up a single group by id. Returns `null` when the id is unknown.
     */
    getGroup(id: string): Promise<IUserGroup | null>;

    /**
     * Create a new admin-defined group.
     *
     * Throws when the `id` matches the reserved-admin pattern, when the
     * `id` is already in use, or when the input fails basic validation
     * (empty id, invalid slug shape, missing name).
     */
    createGroup(input: ICreateUserGroupInput): Promise<IUserGroup>;

    /**
     * Update name or description of an existing admin-defined group.
     *
     * Throws when the group does not exist or when the target row is a
     * system group. Group ids are immutable — there is no rename API.
     */
    updateGroup(id: string, input: IUpdateUserGroupInput): Promise<IUserGroup>;

    /**
     * Delete an admin-defined group and remove its id from every user's
     * membership array.
     *
     * Throws when the group does not exist or when the target row is a
     * system group.
     */
    deleteGroup(id: string): Promise<void>;

    // -------- Membership --------

    /**
     * Return the list of group ids the user currently belongs to.
     *
     * Returns an empty array for unknown users so callers can treat the
     * result as authoritative without a separate existence check.
     */
    getUserGroups(userId: string): Promise<string[]>;

    /**
     * Test whether the user is a member of the given group.
     *
     * Returns `false` for unknown users, unknown groups, or any other
     * absence — never throws on input that simply does not exist.
     */
    isMember(userId: string, groupId: string): Promise<boolean>;

    /**
     * Add the user to the group. Idempotent; adding twice is a no-op.
     *
     * Throws when the group does not exist or when the user does not
     * exist. Plugins should treat the absence of a group as a deployment
     * mistake rather than a runtime fallback.
     */
    addMember(userId: string, groupId: string): Promise<void>;

    /**
     * Remove the user from the group. Idempotent; removing a non-member
     * is a no-op.
     *
     * Throws when the group does not exist. Removing from a non-existent
     * user is also a no-op.
     */
    removeMember(userId: string, groupId: string): Promise<void>;

    /**
     * Replace the user's complete set of group memberships with `groupIds`.
     *
     * Set-semantics. Implementations must validate that every id in
     * `groupIds` refers to an existing group (throws on the first unknown
     * id) and that the target user exists (throws otherwise). The new
     * array is deduplicated and order is not preserved. Returns the
     * resulting membership array so callers can write a before/after
     * audit record without re-reading.
     *
     * Suitable for admin UIs that present a "tick which groups this user
     * is in" view. Plugins managing single-group transitions should keep
     * using `addMember` / `removeMember`.
     */
    setUserGroups(userId: string, groupIds: string[]): Promise<string[]>;

    /**
     * List users currently belonging to the group, paginated.
     *
     * Excludes merged tombstones — `mergedInto`-flagged user documents
     * never appear in the result, so consumers don't need to follow
     * pointer chains to display canonical identities.
     *
     * Throws when the group does not exist so admin UIs can distinguish
     * "no members" from "you typed the wrong slug".
     */
    getMembers(
        groupId: string,
        options?: { limit?: number; skip?: number }
    ): Promise<{ userIds: string[]; total: number }>;

    // -------- Special: admin --------

    /**
     * Return `true` when the user is a member of any system-flagged group
     * whose id matches the reserved-admin pattern (today: just the seeded
     * `admin` group; future system-seeded admin variants are picked up
     * automatically).
     *
     * This predicate exists so plugins can gate admin-only flows without
     * coupling to the specific list of admin-derived group slugs.
     */
    isAdmin(userId: string): Promise<boolean>;
}
