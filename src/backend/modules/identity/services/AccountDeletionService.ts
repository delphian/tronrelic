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
import type { AdminRemovalOutcome } from './group.service.js';
import { toUserKey, userIdFromKey } from './user-id.js';

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
     * Take the target out of the `admin` group unless they are the only live
     * admin. The group service owns this rule and applies it the same way for
     * the group editor, so two requests running together cannot remove the
     * last admin between them.
     *
     * @param userId - Better Auth user id of the account being deleted.
     * @returns `last-admin` when the deletion must be refused.
     */
    removeAdminKeepingOne(userId: string): Promise<AdminRemovalOutcome>;

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
     * The target id is converted to its canonical lowercase hex form before
     * any rule is applied, because sessions, OAuth rows, and socket rooms are
     * keyed by that exact string. An id that differs from the caller's only in
     * letter case names the same account, so comparing the raw string would
     * let an admin delete their own account and then revoke nothing.
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
            const targetUserId = userIdFromKey(key);
            const refusal = this.findRefusal(request, doc, targetUserId);
            if (refusal) {
                outcome = refusal;
            } else if ((await this.deps.groups.removeAdminKeepingOne(targetUserId)) === 'last-admin') {
                // Deleting the only admin would leave nobody able to sign in
                // to the admin pages. This runs last among the refusals
                // because it is the one check that writes: on success the
                // target has already left the admin group.
                outcome = 'last-admin';
            } else {
                if (!doc.deletedAt) {
                    await this.authUsers.updateOne(
                        { _id: key, deletedAt: null },
                        { $set: { deletedAt: new Date(), deletedBy: request.actorUserId, groupsAtDeletion: doc.groups ?? [] } }
                    );
                }
                await this.revokeAccess(targetUserId);
                outcome = 'deleted';
            }
        }
        return outcome;
    }

    /**
     * Apply the rules that refuse a deletion without reading or writing
     * anything else. The last-admin rule is not here: it has to remove the
     * target from the admin group to be safe against two requests running
     * together, so `softDelete` applies it after these pass.
     *
     * The email check comes first so a wrong address is reported as that,
     * whatever else is true of the account.
     *
     * @param request - The deletion request.
     * @param doc - The target's stored user row.
     * @param targetUserId - The target's canonical id, so a target that differs
     *   from the caller's id only in letter case is still recognized as the caller.
     * @returns The reason to refuse, or null when the deletion may go ahead.
     */
    private findRefusal(request: IAccountDeletionRequest, doc: IDeletableUserDocument, targetUserId: string): AccountDeletionOutcome | null {
        let refusal: AccountDeletionOutcome | null = null;
        if (request.confirmEmail.trim().toLowerCase() !== doc.email.toLowerCase()) {
            refusal = 'email-mismatch';
        } else if (targetUserId === request.actorUserId) {
            refusal = 'self';
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
