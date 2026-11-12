/**
 * @fileoverview Soft deletion of a Better Auth account by an admin.
 *
 * Deleting an account must not erase who did what. Audit logs, sign-in events,
 * and content records all name the user id, so the user row is kept and marked
 * with `deletedAt` and `deletedBy` instead of being removed. Everything that
 * lets the account act is taken away: its sessions, its connected apps, its
 * group memberships, and its open WebSocket connections. `auth.ts` refuses a
 * new session for a marked account, so it cannot sign in again, and the kept
 * row keeps the email address reserved.
 *
 * The business rules live here, not in the controller, so they hold for any
 * caller: an admin cannot delete their own account, the last member of the
 * `admin` group cannot be deleted, and the caller must repeat the account's
 * email address.
 */

import type { Collection, ObjectId } from 'mongodb';
import type { IDatabaseService, ISystemLogService } from '@/types';
import { AUTH_USERS_COLLECTION } from './auth-constants.js';
import { ADMIN_GROUP_ID } from './group.service.js';
import { toUserKey } from './user-id.js';

/**
 * How a deletion request ended. Every value other than `deleted` means nothing
 * was changed.
 */
export type AccountDeletionOutcome = 'deleted' | 'not-found' | 'email-mismatch' | 'self' | 'last-admin';

/**
 * One request to delete an account.
 */
export interface IAccountDeletionRequest {
    /** Better Auth user id of the account to delete. */
    targetUserId: string;

    /** Better Auth user id of the signed-in admin making the request, stored as `deletedBy`. */
    actorUserId: string;

    /**
     * The account's email address as the admin typed it. The service compares
     * it with the stored address, so a request built from the wrong row or a
     * guessed id changes nothing.
     */
    confirmEmail: string;
}

/**
 * The group operations deletion needs. `GroupService` satisfies it; tests pass
 * a double.
 */
export interface IAccountDeletionGroups {
    /**
     * Count the members of a group, to tell whether the target is the last admin.
     *
     * @param groupId - Group to count.
     * @param options - Page window; only the total is read.
     * @returns The unpaginated member total.
     */
    getMembers(groupId: string, options?: { limit?: number; skip?: number }): Promise<{ userIds: string[]; total: number }>;

    /**
     * Replace a user's memberships. Called with an empty list so a deleted
     * account holds no group, which also stops it counting as an admin.
     *
     * @param userId - Better Auth user id.
     * @param groupIds - The complete new membership list.
     * @returns True when the user existed.
     */
    setUserGroups(userId: string, groupIds: string[]): Promise<boolean>;
}

/**
 * What the deletion service is built from. Each revocation is a narrow
 * function, so the service never holds the auth instance or a socket server.
 */
export interface IAccountDeletionDependencies {
    /** Database service; the service marks the row in `module_user_auth_users`. */
    database: IDatabaseService;

    /** Group membership reads and the write that clears the account's groups. */
    groups: IAccountDeletionGroups;

    /**
     * Delete every session of the account, so each signed-in device is signed
     * out at once.
     *
     * @param userId - Better Auth user id.
     */
    revokeSessions(userId: string): Promise<void>;

    /**
     * Revoke every connected app of the account, with its OAuth tokens.
     *
     * @param userId - Better Auth user id.
     * @returns How many apps were revoked.
     */
    revokeConnectedApps(userId: string): Promise<number>;

    /**
     * Drop the account's open WebSocket connections, which would otherwise
     * keep receiving that user's events until they reconnect.
     *
     * @param userId - Better Auth user id.
     */
    disconnectSockets(userId: string): Promise<void>;

    /** Identity-module logger. */
    logger: ISystemLogService;
}

/**
 * The fields of the Better Auth user row this service reads and writes.
 */
interface IDeletableUserDocument {
    _id: ObjectId;
    email: string;
    groups?: string[];
    /** When the account was deleted; missing or null on a live account. */
    deletedAt?: Date | null;
    /** Better Auth user id of the admin who deleted the account. */
    deletedBy?: string | null;
    /** The groups the account held when it was deleted, kept for the record. */
    groupsAtDeletion?: string[];
}

/**
 * Soft-deletes accounts for the admin users page.
 */
export class AccountDeletionService {
    /** Better Auth user collection handle. */
    private readonly authUsers: Collection<IDeletableUserDocument>;

    /** Logger scoped to this service. */
    private readonly logger: ISystemLogService;

    /**
     * @param deps - The database, group operations, and revocation functions
     *   described on {@link IAccountDeletionDependencies}.
     */
    constructor(private readonly deps: IAccountDeletionDependencies) {
        this.authUsers = deps.database.getCollection<IDeletableUserDocument>(AUTH_USERS_COLLECTION);
        this.logger = deps.logger.child({ component: 'account-deletion-service' });
    }

    /**
     * Soft-delete one account.
     *
     * The row is marked first, because that is what stops a new sign-in, and
     * the sessions, groups, connected apps, and sockets are removed after it.
     * Repeating the call for an account that is already marked runs the
     * removals again and keeps the original `deletedAt` and `deletedBy`, so a
     * request that failed partway can be retried.
     *
     * @param request - The target, the acting admin, and the typed email.
     * @returns `deleted` on success, or the reason nothing was changed.
     * @throws When a database write or a revocation fails. The account may
     *   then be marked but not fully revoked; repeating the request finishes it.
     */
    async softDelete(request: IAccountDeletionRequest): Promise<AccountDeletionOutcome> {
        const key = toUserKey(request.targetUserId);
        const doc = key ? await this.authUsers.findOne({ _id: key }) : null;
        let outcome: AccountDeletionOutcome = 'not-found';
        if (key && doc) {
            const refusal = await this.findRefusal(request, doc);
            if (refusal) {
                outcome = refusal;
            } else {
                if (!doc.deletedAt) {
                    await this.authUsers.updateOne(
                        { _id: key, deletedAt: null },
                        { $set: { deletedAt: new Date(), deletedBy: request.actorUserId, groupsAtDeletion: doc.groups ?? [] } }
                    );
                }
                await this.revokeAccess(request.targetUserId);
                outcome = 'deleted';
            }
        }
        return outcome;
    }

    /**
     * Apply the rules that refuse a deletion.
     *
     * The email check comes first so a wrong address is reported as that,
     * whatever else is true of the account.
     *
     * @param request - The deletion request.
     * @param doc - The target's stored user row.
     * @returns The reason to refuse, or null when the deletion may go ahead.
     */
    private async findRefusal(request: IAccountDeletionRequest, doc: IDeletableUserDocument): Promise<AccountDeletionOutcome | null> {
        let refusal: AccountDeletionOutcome | null = null;
        if (request.confirmEmail.trim().toLowerCase() !== doc.email.toLowerCase()) {
            refusal = 'email-mismatch';
        } else if (request.targetUserId === request.actorUserId) {
            refusal = 'self';
        } else if ((doc.groups ?? []).includes(ADMIN_GROUP_ID)) {
            // Deleting the only admin would leave nobody able to sign in to
            // the admin pages.
            const { total } = await this.deps.groups.getMembers(ADMIN_GROUP_ID, { limit: 1 });
            if (total <= 1) {
                refusal = 'last-admin';
            }
        }
        return refusal;
    }

    /**
     * Remove everything that lets the account act: sessions, groups, connected
     * apps, and open sockets. Every step is safe to repeat.
     *
     * @param userId - Better Auth user id of the deleted account.
     */
    private async revokeAccess(userId: string): Promise<void> {
        await this.deps.revokeSessions(userId);
        await this.deps.groups.setUserGroups(userId, []);
        await this.deps.revokeConnectedApps(userId);
        try {
            await this.deps.disconnectSockets(userId);
        } catch (error) {
            // The sessions are already gone, so a socket that survives cannot
            // re-authenticate. Failing the request here would report a
            // completed deletion as failed.
            this.logger.warn({ error, userId }, 'Failed to disconnect sockets for a deleted account');
        }
    }
}
