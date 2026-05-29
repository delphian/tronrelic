/**
 * User-group service.
 *
 * Owns the admin-defined group registry (`module_user_groups` collection)
 * and the public `IUserGroupService` contract that plugins discover on the
 * service registry as `'user-groups'` — see
 * `packages/types/src/user/IUserGroupService.ts` for the surface.
 *
 * ## Membership lives on Better Auth
 *
 * This service owns group *definitions*. Membership reads and writes are
 * delegated to {@link GroupService}, the single owner of the `groups`
 * additional field on Better Auth's user collection
 * (`module_user_auth_users`). Keeping definitions here and membership there
 * gives each a single responsibility and a single source of truth: the
 * auth facade, the BA after-create admin promotion, and this service all
 * route membership through one primitive rather than writing the array
 * from several places.
 *
 * ## Admin is a single `admin` group
 *
 * `isAdmin` is membership in the literal `admin` group — no reserved-slug
 * pattern, no admin-derivative tiers. The seeded `admin` row is protected
 * from rename and delete by its `system: true` flag, and the unique index
 * on `id` prevents a second `admin` definition.
 */

import type { Collection } from 'mongodb';
import type {
    IDatabaseService,
    ISystemLogService,
    IUserGroup,
    IUserGroupService,
    ICreateUserGroupInput,
    IUpdateUserGroupInput
} from '@/types';
import type { IUserGroupDocument } from '../database/IUserGroupDocument.js';
import { GroupService, ADMIN_GROUP_ID } from './group.service.js';
import {
    UserGroupValidationError,
    UserGroupNotFoundError,
    UserGroupConflictError,
    UserGroupSystemProtectedError,
    UserGroupMemberNotFoundError
} from './user-group.errors.js';

/**
 * Valid slug pattern for admin-defined group ids. Lowercase letters,
 * digits, and hyphens; must start with a letter and not end in a hyphen.
 */
const SLUG_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;

/**
 * Canonical seeded admin group id. Sourced from {@link ADMIN_GROUP_ID}
 * so the literal `'admin'` has one definition shared with the membership
 * primitive and the auth facade.
 */
const SYSTEM_ADMIN_GROUP_ID = ADMIN_GROUP_ID;

export class UserGroupService implements IUserGroupService {
    private static instance: UserGroupService;
    private readonly groupsCollection: Collection<IUserGroupDocument>;

    private constructor(
        database: IDatabaseService,
        private readonly groupService: GroupService,
        private readonly logger: ISystemLogService
    ) {
        this.groupsCollection = database.getCollection<IUserGroupDocument>('module_user_groups');
    }

    public static setDependencies(database: IDatabaseService, groupService: GroupService, logger: ISystemLogService): void {
        if (!UserGroupService.instance) {
            UserGroupService.instance = new UserGroupService(database, groupService, logger);
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
     * Create indexes on the group-definition collection. Called from
     * `UserModule.init`. The membership index on the Better Auth user
     * collection is owned by {@link GroupService.createIndexes}.
     */
    async createIndexes(): Promise<void> {
        await this.groupsCollection.createIndex({ id: 1 }, { unique: true });
        await this.groupsCollection.createIndex({ system: 1 });
        this.logger.info('User-group definition indexes created');
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

        // Pre-check gives fast feedback in the uncontended case. The unique
        // index on `id` is the actual correctness anchor — see the catch
        // below for the concurrent-insert race. It also blocks a second
        // `admin` definition: the seeded system row already holds the id.
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
        // retry — the definition is still present, the membership $pull is
        // idempotent, and no orphaned references are stranded in any user's
        // groups[]. The reverse order would strand references that
        // removeMember (which validates the definition exists) cannot clear.
        const modified = await this.groupService.removeGroupFromAllMembers(id);
        await this.groupsCollection.deleteOne({ id });
        this.logger.info({ groupId: id, affectedUsers: modified }, 'User group deleted');
    }

    // ==================== Membership (delegated to Better Auth) ====================

    async getUserGroups(userId: string): Promise<string[]> {
        return this.groupService.getUserGroups(userId);
    }

    async isMember(userId: string, groupId: string): Promise<boolean> {
        return this.groupService.isMember(userId, groupId);
    }

    async addMember(userId: string, groupId: string): Promise<void> {
        const group = await this.groupsCollection.findOne({ id: groupId });
        if (!group) {
            throw new UserGroupNotFoundError(groupId);
        }
        const matched = await this.groupService.addMember(userId, groupId);
        if (!matched) {
            throw new UserGroupMemberNotFoundError(userId);
        }
    }

    async removeMember(userId: string, groupId: string): Promise<void> {
        const group = await this.groupsCollection.findOne({ id: groupId });
        if (!group) {
            throw new UserGroupNotFoundError(groupId);
        }
        await this.groupService.removeMember(userId, groupId);
    }

    /**
     * Replace the user's full membership array. See contract JSDoc in
     * `IUserGroupService` for semantics.
     *
     * Validates every id resolves to a real group definition before
     * delegating the atomic `$set` to {@link GroupService}. The set-semantics
     * (concurrent writes between an admin's read and save are deliberately
     * overwritten) live in the primitive; the definition validation lives
     * here because this service owns the registry.
     */
    async setUserGroups(userId: string, groupIds: string[]): Promise<string[]> {
        if (!Array.isArray(groupIds)) {
            throw new UserGroupValidationError('groups must be an array of group ids');
        }

        // Coerce, trim, lowercase, dedupe. Drops empty strings introduced
        // by clients that pass blank inputs.
        const desired = Array.from(new Set(
            groupIds
                .filter((id): id is string => typeof id === 'string')
                .map(id => id.trim().toLowerCase())
                .filter(id => id.length > 0)
        ));

        // Validate every id resolves to a real group definition. A single
        // $in query is cheaper than N findOnes and surfaces unknown ids in
        // one trip (we throw on the first one).
        if (desired.length > 0) {
            const existing = await this.groupsCollection
                .find({ id: { $in: desired } }, { projection: { id: 1 } })
                .toArray();
            const existingIds = new Set(existing.map(g => g.id));
            const unknown = desired.find(id => !existingIds.has(id));
            if (unknown) {
                throw new UserGroupNotFoundError(unknown);
            }
        }

        const matched = await this.groupService.setUserGroups(userId, desired);
        if (!matched) {
            throw new UserGroupMemberNotFoundError(userId);
        }
        this.logger.info(
            { userId, groupCount: desired.length },
            'User group membership replaced'
        );
        return desired;
    }

    /**
     * Paginated member list for a single group. See contract JSDoc in
     * `IUserGroupService` for semantics. Returns Better Auth user ids.
     */
    async getMembers(
        groupId: string,
        options: { limit?: number; skip?: number } = {}
    ): Promise<{ userIds: string[]; total: number }> {
        const group = await this.groupsCollection.findOne({ id: groupId });
        if (!group) {
            throw new UserGroupNotFoundError(groupId);
        }
        return this.groupService.getMembers(groupId, options);
    }

    // ==================== Special: admin ====================

    async isAdmin(userId: string): Promise<boolean> {
        return this.groupService.isAdmin(userId);
    }

    // ==================== Helpers ====================

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

export { SYSTEM_ADMIN_GROUP_ID };
