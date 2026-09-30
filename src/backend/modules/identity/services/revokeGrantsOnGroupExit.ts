/**
 * @fileoverview Revokes a user's connected apps once they are no longer in the
 * group that allows connecting apps.
 *
 * Leaving `mcp-users` already stops a user's apps: the MCP endpoint checks
 * membership on every request, and token refresh refuses non-members. But the
 * consents and refresh tokens stay stored, and the Connected apps tab on the
 * profile page is hidden from non-members. If an admin later added the user
 * back while a refresh token was still valid, the app would resume without the
 * user consenting again, and in the meantime the user had no way to revoke it.
 * Deleting the grants when the user leaves closes both gaps.
 */

import type { IConnectedAppsService, ISystemLogService } from '@/types';

/**
 * The one membership check this helper needs. `GroupService` satisfies it.
 */
export interface IGroupMembershipReader {
    /**
     * Whether a user is currently in a group.
     *
     * @param userId - Better Auth user id.
     * @param groupId - Group id to check.
     * @returns True when the user is a member.
     */
    isMember(userId: string, groupId: string): Promise<boolean>;
}

/**
 * Revoke all of a user's connected apps if they are not in the given group.
 *
 * The group membership listener calls this after every membership write, so
 * it reads the current membership rather than trusting what the write was. A
 * user removed and added back before this runs is a member again and keeps
 * their apps. The promise never rejects, because the membership write that
 * triggered it has already succeeded and must not appear to fail; a failure is
 * logged at error level instead, since it leaves grants in place that should
 * have been removed.
 *
 * @param userId - Better Auth user id whose membership changed.
 * @param groupId - The group that allows connecting apps (`mcp-users`).
 * @param groups - Reads the user's current membership.
 * @param connectedApps - Revokes the user's grants.
 * @param logger - Module logger, for the revocation count and any failure.
 * @returns Resolves when the check, and any revocation, is done.
 */
export async function revokeGrantsOnGroupExit(
    userId: string,
    groupId: string,
    groups: IGroupMembershipReader,
    connectedApps: Pick<IConnectedAppsService, 'revokeAllForUser'>,
    logger: ISystemLogService
): Promise<void> {
    try {
        const stillMember = await groups.isMember(userId, groupId);
        if (!stillMember) {
            const revoked = await connectedApps.revokeAllForUser(userId);
            if (revoked > 0) {
                logger.info({ userId, groupId, revoked }, 'Revoked connected apps after the user left the group');
            }
        }
    } catch (error) {
        logger.error({ error, userId, groupId }, 'Failed to revoke connected apps after a group membership change');
    }
}
