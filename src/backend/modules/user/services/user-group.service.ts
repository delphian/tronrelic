/**
 * User-group service.
 *
 * Owns the admin-defined group registry (`module_user_groups` collection)
 * and all membership reads/writes against the user document's `groups[]`
 * array. Plugins discover this service on the registry as `'user-groups'`
 * and consume it through the `IUserGroupService` contract — see
 * `packages/types/src/user/IUserGroupService.ts` for the public surface.
 *
 * ## Reserved-admin namespace
 *
 * Naked `admin` and admin-derivative slugs without further context are
 * platform-reserved: only the user module itself may seed them, and only
 * with `system: true`. The deny pattern matches `admin`, `admins`,
 * `administrator(s)`, `super-admin(s)`, `superadmin(s)`, `sub-admin(s)`,
 * `subadmin(s)`, and `root(s)`. Context-scoped names (`market-admin`,
 * `plugin-admins`) are admin-creatable and treated as ordinary groups.
 *
 * ## isAdmin trust caveat
 *
 * `isAdmin(userId)` reflects membership in any system-flagged admin-pattern
 * group. Membership is keyed by user UUID, which is a knowledge factor only
 * (cookies are client-controlled). The predicate is suitable for plugin
 * UX gating but is **not** equivalent to the platform's `requireAdmin`
 * token check; sensitive operations should still require the token or pair
 * group membership with `hasVerifiedWallet`.
 */

import type { Collection } from 'mongodb';
import type {
    IDatabaseService,
    ICacheService,
    ISystemLogService,
    IUserGroup,
    IUserGroupService,
    ICreateUserGroupInput,
    IUpdateUserGroupInput
} from '@/types';
import type { IUserGroupDocument } from '../database/IUserGroupDocument.js';
import type { IUserDocument } from '../database/IUserDocument.js';
import {
    UserGroupValidationError,
    UserGroupNotFoundError,
    UserGroupConflictError,
    UserGroupSystemProtectedError,
    UserGroupMemberNotFoundError
} from './user-group.errors.js';

/**
 * Reserved-admin slug pattern. See module JSDoc for matched cases.
 */
const RESERVED_ADMIN_PATTERN =
    /^(super[-_]?|sub[-_]?)?admin(istrator)?s?$|^roots?$/i;

/**
 * Valid slug pattern for admin-defined group ids. Lowercase letters,
 * digits, and hyphens; must start with a letter and not end in a hyphen.
 */
const SLUG_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;

/**
 * Canonical seeded admin group id. Other system admin groups may exist
 * later; `isAdmin` detects all of them via the reserved-admin pattern,
 * not by hardcoding this constant.
 */
const SYSTEM_ADMIN_GROUP_ID = 'admin';

export class UserGroupService implements IUserGroupService {
    private static instance: UserGroupService;
    private readonly groupsCollection: Collection<IUserGroupDocument>;
    private readonly usersCollection: Collection<IUserDocument>;

    private constructor(
        database: IDatabaseService,
        private readonly cacheService: ICacheService,
        private readonly logger: ISystemLogService
    ) {
        this.groupsCollection = database.getCollection<IUserGroupDocument>('module_user_groups');
        this.usersCollection = database.getCollection<IUserDocument>('users');
    }

    public static setDependencies(database: IDatabaseService, cacheService: ICacheService, logger: ISystemLogService): void {
        if (!UserGroupService.instance) {
            UserGroupService.instance = new UserGroupService(database, cacheService, logger);
        }
    }

    public static getInstance(): UserGroupService {
        if (!UserGroupService.instance) {
            throw new Error('UserGroupService.setDependencies() must be called before getInstance()');
        }
        return UserGroupService.instance;
    }

    public static resetInstance(): void {
        UserGroupService.instance = undefined as any;
    }

    /**
     * Create indexes on the groups collection. Called from `UserModule.init`.
     */
    async createIndexes(): Promise<void> {
        await this.groupsCollection.createIndex({ id: 1 }, { unique: true });
        await this.groupsCollection.createIndex({ system: 1 });
        await this.usersCollection.createIndex({ groups: 1 });
        this.logger.info('User-group indexes created');
    }

    /**
     * Idempotently seed the canonical `admin` system group. Safe to call
     * on every startup; updates `updatedAt` only on first creation.
     */
    async seedSystemGroups(): Promise<void> {
        const now = new Date();
        const result = await this.groupsCollection.updateOne(
            { id: SYSTEM_ADMIN_GROUP_ID },
            {
                $setOnInsert: {
                    id: SYSTEM_ADMIN_GROUP_ID,
                    name: 'Admin',
                    description: 'Platform administrators. Reserved system group; cannot be renamed or deleted.',
                    system: true,
                    createdAt: now,
                    updatedAt: now
                }
            },
            { upsert: true }
        );
        if (result.upsertedCount > 0) {
            this.logger.info({ groupId: SYSTEM_ADMIN_GROUP_ID }, 'System admin group seeded');
        } else {
            this.logger.debug({ groupId: SYSTEM_ADMIN_GROUP_ID }, 'System admin group already present');
        }
    }

    // ==================== Definition CRUD ====================

    async listGroups(): Promise<IUserGroup[]> {
        const docs = await this.groupsCollection
            .find({})
            .sort({ system: -1, id: 1 })
            .toArray();
        return docs.map(this.toPublicGroup);
    }

    async getGroup(id: string): Promise<IUserGroup | null> {
        const doc = await this.groupsCollection.findOne({ id });
        return doc ? this.toPublicGroup(doc) : null;
    }

    async createGroup(input: ICreateUserGroupInput): Promise<IUserGroup> {
        // Defensively coerce. The controller hands `req.body` fields straight
        // through, so non-string values (arrays, numbers, null) reach here
        // unfiltered — guard before calling string methods.
        const id = typeof input.id === 'string' ? input.id.trim().toLowerCase() : '';
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        const description = typeof input.description === 'string' ? input.description.trim() : '';

        if (!id) throw new UserGroupValidationError('Group id is required');
        if (!name) throw new UserGroupValidationError('Group name is required');
        if (!SLUG_PATTERN.test(id)) {
            throw new UserGroupValidationError(
                `Invalid group id "${id}": must be lowercase letters, digits, and hyphens, starting with a letter`
            );
        }
        if (RESERVED_ADMIN_PATTERN.test(id)) {
            throw new UserGroupValidationError(
                `Group id "${id}" is reserved for platform-defined admin groups; choose a context-scoped name (e.g. "market-admin")`
            );
        }

        // Pre-check gives fast feedback in the uncontended case. The unique
        // index on `id` is the actual correctness anchor — see the catch
        // below for the concurrent-insert race.
        const existing = await this.groupsCollection.findOne({ id });
        if (existing) {
            throw new UserGroupConflictError(id);
        }

        const now = new Date();
        const doc: Omit<IUserGroupDocument, '_id'> = {
            id,
            name,
            description,
            system: false,
            createdAt: now,
            updatedAt: now
        };
        try {
            await this.groupsCollection.insertOne(doc as any);
        } catch (error) {
            // MongoDB duplicate-key — concurrent insert won the race after
            // our findOne returned null. Translate to the same conflict
            // error the controller maps to HTTP 409.
            if (error && typeof error === 'object' && (error as { code?: number }).code === 11000) {
                throw new UserGroupConflictError(id);
            }
            throw error;
        }
        this.logger.info({ groupId: id }, 'User group created');
        return this.toPublicGroup(doc as IUserGroupDocument);
    }

    async updateGroup(id: string, input: IUpdateUserGroupInput): Promise<IUserGroup> {
        const existing = await this.groupsCollection.findOne({ id });
        if (!existing) {
            throw new UserGroupNotFoundError(id);
        }
        if (existing.system) {
            throw new UserGroupSystemProtectedError(id, 'modify');
        }

        const updates: Partial<IUserGroupDocument> = { updatedAt: new Date() };
        if (input.name !== undefined) {
            // Defensively coerce — same reasoning as `createGroup` above.
            if (typeof input.name !== 'string') {
                throw new UserGroupValidationError('Group name must be a string');
            }
            const name = input.name.trim();
            if (!name) throw new UserGroupValidationError('Group name cannot be empty');
            updates.name = name;
        }
        if (input.description !== undefined) {
            if (typeof input.description !== 'string') {
                throw new UserGroupValidationError('Group description must be a string');
            }
            updates.description = input.description.trim();
        }

        await this.groupsCollection.updateOne({ id }, { $set: updates });
        const updated = await this.groupsCollection.findOne({ id });
        return this.toPublicGroup(updated!);
    }

    async deleteGroup(id: string): Promise<void> {
        const existing = await this.groupsCollection.findOne({ id });
        if (!existing) {
            throw new UserGroupNotFoundError(id);
        }
        if (existing.system) {
            throw new UserGroupSystemProtectedError(id, 'delete');
        }

        // Cascade first so that a partial failure leaves a recoverable
        // state. If the definition delete below fails, the operator can
        // retry — the definition is still present, $pull on already-clean
        // arrays is a no-op, and no orphaned references are stranded in
        // user.groups[]. The reverse order would strand references that
        // removeMember (which validates the definition exists) cannot clear.
        //
        // Enumerate affected user ids before the cascade so we can invalidate
        // their UserService caches after the write. Otherwise consumers
        // reading via UserService would see stale `groups[]` until the
        // 1-hour TTL expires.
        const affectedUsers = await this.usersCollection
            .find({ groups: id }, { projection: { id: 1 } })
            .toArray();
        await this.usersCollection.updateMany(
            { groups: id },
            { $pull: { groups: id } as any, $set: { updatedAt: new Date() } }
        );
        await this.groupsCollection.deleteOne({ id });
        await Promise.all(affectedUsers.map(u => this.invalidateUserCache(u.id)));
        this.logger.info({ groupId: id, affectedUsers: affectedUsers.length }, 'User group deleted');
    }

    // ==================== Membership ====================

    async getUserGroups(userId: string): Promise<string[]> {
        const canonicalId = await this.resolveCanonicalUserId(userId);
        const doc = await this.usersCollection.findOne(
            { id: canonicalId },
            { projection: { groups: 1 } }
        );
        return doc?.groups ?? [];
    }

    async isMember(userId: string, groupId: string): Promise<boolean> {
        const canonicalId = await this.resolveCanonicalUserId(userId);
        const count = await this.usersCollection.countDocuments(
            { id: canonicalId, groups: groupId },
            { limit: 1 }
        );
        return count > 0;
    }

    async addMember(userId: string, groupId: string): Promise<void> {
        const group = await this.groupsCollection.findOne({ id: groupId });
        if (!group) {
            throw new UserGroupNotFoundError(groupId);
        }
        const canonicalId = await this.resolveCanonicalUserId(userId);
        const result = await this.usersCollection.updateOne(
            { id: canonicalId },
            { $addToSet: { groups: groupId } as any, $set: { updatedAt: new Date() } }
        );
        if (result.matchedCount === 0) {
            throw new UserGroupMemberNotFoundError(userId);
        }
        await this.invalidateUserCache(canonicalId);
    }

    async removeMember(userId: string, groupId: string): Promise<void> {
        const group = await this.groupsCollection.findOne({ id: groupId });
        if (!group) {
            throw new UserGroupNotFoundError(groupId);
        }
        const canonicalId = await this.resolveCanonicalUserId(userId);
        await this.usersCollection.updateOne(
            { id: canonicalId },
            { $pull: { groups: groupId } as any, $set: { updatedAt: new Date() } }
        );
        await this.invalidateUserCache(canonicalId);
    }

    // ==================== Special: admin ====================

    async isAdmin(userId: string): Promise<boolean> {
        // Resolve the user's group ids in one query, then test each id
        // against the reserved-admin pattern with system: true on the
        // group definition. This handles future system-seeded admin
        // variants without code changes.
        const canonicalId = await this.resolveCanonicalUserId(userId);
        const user = await this.usersCollection.findOne(
            { id: canonicalId },
            { projection: { groups: 1 } }
        );
        const groupIds = user?.groups ?? [];
        if (groupIds.length === 0) return false;

        const adminCandidates = groupIds.filter(g => RESERVED_ADMIN_PATTERN.test(g));
        if (adminCandidates.length === 0) return false;

        const matched = await this.groupsCollection.countDocuments(
            { id: { $in: adminCandidates }, system: true },
            { limit: 1 }
        );
        return matched > 0;
    }

    // ==================== Helpers ====================

    /**
     * Follow a single `mergedInto` hop to the canonical user id.
     *
     * Identity reconciliation in `UserService` flattens pointer chains during
     * the merge (every UUID already pointing at the loser is rewritten to
     * point at the winner), so a single hop is always sufficient — no loop
     * required.
     *
     * Plugins commonly retain a pre-merge UUID (cookie, persisted reference,
     * cached value). Resolving the pointer here keeps membership reads and
     * writes accurate after a wallet-driven identity swap, instead of
     * silently operating on the loser tombstone — whose `groups[]` array
     * is whatever the loser had at merge time and is never updated again.
     */
    private async resolveCanonicalUserId(userId: string): Promise<string> {
        const doc = await this.usersCollection.findOne(
            { id: userId },
            { projection: { mergedInto: 1 } }
        );
        return doc?.mergedInto ?? userId;
    }

    /**
     * Drop the affected user's `UserService` cache entry so consumers
     * reading via `/api/user/:id` and other UserService paths see the
     * updated `groups[]` array immediately. UserService caches users
     * with the tag `user:${userId}` and a 1-hour TTL — without this
     * call, membership changes lag behind by up to an hour.
     */
    private async invalidateUserCache(userId: string): Promise<void> {
        await this.cacheService.invalidate(`user:${userId}`);
    }


    private toPublicGroup(doc: IUserGroupDocument | Omit<IUserGroupDocument, '_id'>): IUserGroup {
        return {
            id: doc.id,
            name: doc.name,
            description: doc.description ?? '',
            system: doc.system,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
        };
    }
}

export { RESERVED_ADMIN_PATTERN, SYSTEM_ADMIN_GROUP_ID };
