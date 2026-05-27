/**
 * @fileoverview Group membership service for the Better Auth user store.
 *
 * Reads and writes the `groups` additional field on Better Auth's user
 * collection (`module_user_auth_users`) so plugin authorization can be
 * gated on lightweight named tags without inventing a parallel data
 * model. Phase 1 reserves `admin` as the only seeded group; later
 * phases that allow operator-defined groups still reuse this service
 * for all read/write operations.
 *
 * The service follows the project's singleton pattern
 * (`setDependencies()` / `getInstance()`) because membership state is
 * shared application-wide and configured exactly once at bootstrap.
 *
 * **Storage shape.** Better Auth's `mongodbAdapter` maps the logical
 * `id` field on the User model to MongoDB's `_id` (transparently
 * transforming on read and write), so every query in this service
 * filters by `{ _id: userId }`. The `groups` field is the BA
 * additional field declared in `auth.ts`; nothing else in the codebase
 * writes to it.
 */

import type { Collection } from 'mongodb';
import type { IDatabaseService, ISystemLogService } from '@/types';
import { AUTH_USERS_COLLECTION } from './auth-constants.js';

/**
 * Group id reserved for administrators.
 *
 * Exported for callers that want a symbolic reference rather than a
 * bare string literal. {@link GroupService.isAdmin} delegates to
 * {@link GroupService.isMember} with this value.
 */
export const ADMIN_GROUP_ID = 'admin';

/**
 * Shape of the BA user document this service touches.
 *
 * Restricted to the fields we read/write — BA owns the full schema.
 * Listed explicitly so the raw collection handle is type-checked.
 */
interface IAuthUserDoc {
    /**
     * Better Auth's user id, stored as MongoDB `_id` (string, not
     * ObjectId). The adapter remaps `id` ↔ `_id` transparently when
     * BA itself queries, so the `_id` we see here is the same value
     * BA returns as `user.id` from its session API.
     */
    _id: string;

    /**
     * Group ids the user is a member of. Empty array or missing both
     * mean "no groups." Maintained via `$addToSet` / `$pull` /
     * `$set` writes from this service.
     */
    groups?: string[];
}

/**
 * Group membership service backed by Better Auth's user collection.
 *
 * Singleton; created and configured during `UserModule.init()` via
 * {@link GroupService.setDependencies}. Subsequent calls to
 * {@link GroupService.getInstance} return the configured instance.
 *
 * @example
 * ```typescript
 * // Bootstrap
 * GroupService.setDependencies(database, logger);
 * const groups = GroupService.getInstance();
 *
 * // Add a user to admin
 * await groups.addMember('user_abc123', ADMIN_GROUP_ID);
 *
 * // Check membership
 * if (await groups.isAdmin('user_abc123')) { /* gated work *\/ }
 * ```
 */
export class GroupService {
    /**
     * Singleton instance reference. `null` until {@link setDependencies}
     * runs at bootstrap.
     */
    private static instance: GroupService | null = null;

    /**
     * Logger scoped to this service. Created once at construction.
     */
    private readonly logger: ISystemLogService;

    /**
     * Injected database service. The constructor stores it; every
     * method goes through the abstraction for raw-collection access.
     */
    private readonly database: IDatabaseService;

    /**
     * Construct the service.
     *
     * Private so the only sanctioned creation path is
     * {@link setDependencies}, preserving the singleton contract.
     *
     * @param database - Database abstraction.
     * @param logger - Logger to derive a `component: 'group-service'` child from.
     */
    private constructor(database: IDatabaseService, logger: ISystemLogService) {
        this.database = database;
        this.logger = logger.child({ component: 'group-service' });
    }

    /**
     * Configure the singleton with its dependencies.
     *
     * Must be called exactly once during `UserModule.init()`. Calling
     * a second time is a no-op (the existing instance is kept) so
     * callers cannot accidentally swap dependencies after services
     * have started consuming the singleton.
     *
     * @param database - Database service injected by the module.
     * @param logger - Pino logger from the user module's child scope.
     */
    public static setDependencies(database: IDatabaseService, logger: ISystemLogService): void {
        if (!GroupService.instance) {
            GroupService.instance = new GroupService(database, logger);
        }
    }

    /**
     * Resolve the configured singleton.
     *
     * @returns The shared {@link GroupService} instance.
     * @throws {Error} When called before {@link setDependencies}.
     */
    public static getInstance(): GroupService {
        if (!GroupService.instance) {
            throw new Error(
                'GroupService.setDependencies() must be called before getInstance().'
            );
        }
        return GroupService.instance;
    }

    /**
     * Reset the singleton.
     *
     * Test-only escape hatch. Production code never calls this — the
     * service lives for the process lifetime. Tests use it between
     * suites so a fresh `setDependencies()` configures a clean instance.
     *
     * @internal
     */
    public static resetForTests(): void {
        GroupService.instance = null;
    }

    /**
     * Return the groups a user belongs to.
     *
     * Returns an empty array when the user does not exist or has no
     * groups; missing-user and no-groups are intentionally
     * indistinguishable at this API since callers gating on group
     * membership only care about presence.
     *
     * @param userId - Better Auth user id.
     * @returns Array of group ids, deduplicated by the underlying
     *          $addToSet writes. Order is not guaranteed.
     */
    public async getUserGroups(userId: string): Promise<string[]> {
        const collection = this.getCollection();
        const doc = await collection.findOne(
            { _id: userId },
            { projection: { groups: 1 } }
        );
        const groups = doc?.groups ?? [];
        return groups;
    }

    /**
     * Test whether a user is a member of a given group.
     *
     * @param userId - Better Auth user id.
     * @param groupId - Group id to check.
     * @returns `true` when the user document contains `groupId` in its
     *          `groups` array, `false` otherwise (including missing user).
     */
    public async isMember(userId: string, groupId: string): Promise<boolean> {
        const collection = this.getCollection();
        const count = await collection.countDocuments(
            { _id: userId, groups: groupId },
            { limit: 1 }
        );
        return count > 0;
    }

    /**
     * Test whether a user is an administrator.
     *
     * Sugar for {@link isMember} with {@link ADMIN_GROUP_ID}. Kept as
     * its own method so callers that gate on admin status read clearly
     * and so the facade in `services/auth-facade.ts` can route
     * `isAdmin(req)` to a single primitive.
     *
     * @param userId - Better Auth user id.
     * @returns `true` when the user is in the `admin` group.
     */
    public async isAdmin(userId: string): Promise<boolean> {
        const result = await this.isMember(userId, ADMIN_GROUP_ID);
        return result;
    }

    /**
     * Add a user to a group.
     *
     * Idempotent — uses `$addToSet` so repeated calls leave the
     * `groups` array unchanged once membership is established. Throws
     * when the underlying write fails (other than missing-user, which
     * is silently ignored because the matched-count is zero and the
     * upstream caller has the user context to react).
     *
     * @param userId - Better Auth user id.
     * @param groupId - Group id to add.
     */
    public async addMember(userId: string, groupId: string): Promise<void> {
        const collection = this.getCollection();
        await collection.updateOne(
            { _id: userId },
            { $addToSet: { groups: groupId } }
        );
    }

    /**
     * Remove a user from a group.
     *
     * Idempotent — removing a non-member is a no-op via `$pull`.
     *
     * @param userId - Better Auth user id.
     * @param groupId - Group id to remove.
     */
    public async removeMember(userId: string, groupId: string): Promise<void> {
        const collection = this.getCollection();
        await collection.updateOne(
            { _id: userId },
            { $pull: { groups: groupId } }
        );
    }

    /**
     * Replace the user's complete group membership atomically.
     *
     * Used by admin tooling that presents a checkbox list and saves
     * the full intended state in one write. Plugins should prefer
     * {@link addMember} / {@link removeMember} for single-group
     * transitions because they avoid clobbering concurrent edits.
     *
     * @param userId - Better Auth user id.
     * @param groupIds - Complete list of group ids the user should belong to.
     */
    public async setUserGroups(userId: string, groupIds: string[]): Promise<void> {
        const collection = this.getCollection();
        const unique = Array.from(new Set(groupIds));
        await collection.updateOne(
            { _id: userId },
            { $set: { groups: unique } }
        );
    }

    /**
     * Resolve the raw `module_user_auth_users` collection handle.
     *
     * Better Auth's adapter populates this collection; we read and
     * write the `groups` additional field directly because the
     * Mongoose model registry is not used for BA-owned tables.
     *
     * @returns Typed collection handle.
     */
    private getCollection(): Collection<IAuthUserDoc> {
        return this.database.getCollection<IAuthUserDoc>(AUTH_USERS_COLLECTION);
    }
}
