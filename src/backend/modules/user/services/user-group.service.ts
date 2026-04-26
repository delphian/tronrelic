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
    ISystemLogService,
    IUserGroup,
    IUserGroupService,
    ICreateUserGroupInput,
    IUpdateUserGroupInput
} from '@/types';
import type { IUserGroupDocument } from '../database/IUserGroupDocument.js';
import type { IUserDocument } from '../database/IUserDocument.js';

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
        private readonly logger: ISystemLogService
    ) {
        this.groupsCollection = database.getCollection<IUserGroupDocument>('module_user_groups');
        this.usersCollection = database.getCollection<IUserDocument>('users');
    }

    public static setDependencies(database: IDatabaseService, logger: ISystemLogService): void {
        if (!UserGroupService.instance) {
            UserGroupService.instance = new UserGroupService(database, logger);
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
        await this.groupsCollection.updateOne(
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
        this.logger.info({ groupId: SYSTEM_ADMIN_GROUP_ID }, 'System admin group seeded');
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
        const id = (input.id ?? '').trim().toLowerCase();
        const name = (input.name ?? '').trim();
        const description = (input.description ?? '').trim();

        if (!id) throw new Error('Group id is required');
        if (!name) throw new Error('Group name is required');
        if (!SLUG_PATTERN.test(id)) {
            throw new Error(
                `Invalid group id "${id}": must be lowercase letters, digits, and hyphens, starting with a letter`
            );
        }
        if (RESERVED_ADMIN_PATTERN.test(id)) {
            throw new Error(
                `Group id "${id}" is reserved for platform-defined admin groups; choose a context-scoped name (e.g. "market-admin")`
            );
        }

        const existing = await this.groupsCollection.findOne({ id });
        if (existing) {
            throw new Error(`Group "${id}" already exists`);
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
        await this.groupsCollection.insertOne(doc as any);
        this.logger.info({ groupId: id }, 'User group created');
        return this.toPublicGroup(doc as IUserGroupDocument);
    }

    async updateGroup(id: string, input: IUpdateUserGroupInput): Promise<IUserGroup> {
        const existing = await this.groupsCollection.findOne({ id });
        if (!existing) {
            throw new Error(`Group "${id}" does not exist`);
        }
        if (existing.system) {
            throw new Error(`Group "${id}" is a system group and cannot be modified`);
        }

        const updates: Partial<IUserGroupDocument> = { updatedAt: new Date() };
        if (input.name !== undefined) {
            const name = input.name.trim();
            if (!name) throw new Error('Group name cannot be empty');
            updates.name = name;
        }
        if (input.description !== undefined) {
            updates.description = input.description.trim();
        }

        await this.groupsCollection.updateOne({ id }, { $set: updates });
        const updated = await this.groupsCollection.findOne({ id });
        return this.toPublicGroup(updated!);
    }

    async deleteGroup(id: string): Promise<void> {
        const existing = await this.groupsCollection.findOne({ id });
        if (!existing) {
            throw new Error(`Group "${id}" does not exist`);
        }
        if (existing.system) {
            throw new Error(`Group "${id}" is a system group and cannot be deleted`);
        }

        await this.groupsCollection.deleteOne({ id });
        // Cascade: pull this id from every user's groups array so we don't
        // leak references to a group that no longer exists.
        await this.usersCollection.updateMany(
            { groups: id },
            { $pull: { groups: id } as any, $set: { updatedAt: new Date() } }
        );
        this.logger.info({ groupId: id }, 'User group deleted');
    }

    // ==================== Membership ====================

    async getUserGroups(userId: string): Promise<string[]> {
        const doc = await this.usersCollection.findOne(
            { id: userId },
            { projection: { groups: 1 } }
        );
        return doc?.groups ?? [];
    }

    async isMember(userId: string, groupId: string): Promise<boolean> {
        const count = await this.usersCollection.countDocuments(
            { id: userId, groups: groupId },
            { limit: 1 }
        );
        return count > 0;
    }

    async addMember(userId: string, groupId: string): Promise<void> {
        const group = await this.groupsCollection.findOne({ id: groupId });
        if (!group) {
            throw new Error(`Group "${groupId}" does not exist`);
        }
        const result = await this.usersCollection.updateOne(
            { id: userId },
            { $addToSet: { groups: groupId } as any, $set: { updatedAt: new Date() } }
        );
        if (result.matchedCount === 0) {
            throw new Error(`User "${userId}" does not exist`);
        }
    }

    async removeMember(userId: string, groupId: string): Promise<void> {
        const group = await this.groupsCollection.findOne({ id: groupId });
        if (!group) {
            throw new Error(`Group "${groupId}" does not exist`);
        }
        await this.usersCollection.updateOne(
            { id: userId },
            { $pull: { groups: groupId } as any, $set: { updatedAt: new Date() } }
        );
    }

    // ==================== Special: admin ====================

    async isAdmin(userId: string): Promise<boolean> {
        // Resolve the user's group ids in one query, then test each id
        // against the reserved-admin pattern with system: true on the
        // group definition. This handles future system-seeded admin
        // variants without code changes.
        const user = await this.usersCollection.findOne(
            { id: userId },
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
