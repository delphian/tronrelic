/**
 * @fileoverview Resolves a notification audience to a concrete set of Better
 * Auth user ids. This is where "all admins" becomes a list of accounts: groups
 * expand through the identity module's `'user-groups'` service, explicit user
 * ids pass through, and the union is deduplicated. Resolution is server-side on
 * purpose — it is the precondition for honoring per-user silencing without
 * trusting the client. Offline recipients stay in the list; delivery to their
 * (empty) socket room is simply a no-op.
 */

import type { INotificationAudience, IUserGroupService, ISystemLogService } from '@/types';
import { MAX_AUDIENCE_GROUP_MEMBERS } from '../config.js';

/** Lazily resolves the `'user-groups'` service, or undefined when unavailable. */
export type UserGroupServiceResolver = () => IUserGroupService | undefined;

/**
 * Expands audiences to recipient ids. Plain class; the module injects a resolver
 * that reads `'user-groups'` from the service registry at call time so boot
 * order and operator churn are both tolerated.
 */
export class RecipientResolver {
    /**
     * @param getUserGroups - Lazy accessor for the `'user-groups'` service.
     * @param logger - Scoped logger.
     */
    constructor(
        private readonly getUserGroups: UserGroupServiceResolver,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Resolve an audience to deduplicated recipient user ids.
     *
     * A group that cannot be enumerated (service absent, or the group does not
     * exist) contributes nobody rather than throwing — a misconfigured audience
     * degrades to fewer recipients, never a failed dispatch.
     *
     * @param audience - Groups and/or explicit user ids to target.
     * @returns Deduplicated Better Auth user ids.
     */
    async resolve(audience: INotificationAudience): Promise<string[]> {
        const ids = new Set<string>();

        for (const userId of audience.userIds ?? []) {
            if (userId) {
                ids.add(userId);
            }
        }

        const groups = audience.groups ?? [];
        if (groups.length > 0) {
            const service = this.getUserGroups();
            if (!service) {
                this.logger.warn({ groups }, 'Cannot resolve notification group audience: user-groups service unavailable');
            } else {
                for (const groupId of groups) {
                    try {
                        const { userIds } = await service.getMembers(groupId, { limit: MAX_AUDIENCE_GROUP_MEMBERS });
                        for (const userId of userIds) {
                            ids.add(userId);
                        }
                    } catch (error) {
                        this.logger.warn({ error, groupId }, 'Failed to resolve notification group members; skipping group');
                    }
                }
            }
        }

        return Array.from(ids);
    }

    /**
     * Test whether one user belongs to an audience.
     *
     * The preferences surface needs this so a user is only offered opt-outs
     * for categories that can actually reach them. Showing an admin-only
     * category to an ordinary user offers a switch that does nothing. This
     * answers the same question as {@link resolve} for a single user, but asks
     * for that user's groups once instead of enumerating every member of every
     * audience group. When the `'user-groups'` service is unavailable or the
     * lookup fails, group membership counts as false, matching how `resolve`
     * treats an unresolvable group as contributing nobody.
     *
     * @param audience - Groups and/or explicit user ids the category targets.
     * @param userId - Better Auth id of the user being checked.
     * @returns True when the user is listed explicitly or is in one of the groups.
     */
    async includes(audience: INotificationAudience, userId: string): Promise<boolean> {
        let included = (audience.userIds ?? []).includes(userId);

        const groups = audience.groups ?? [];
        if (!included && groups.length > 0) {
            const service = this.getUserGroups();
            if (!service) {
                this.logger.warn({ groups }, 'Cannot check notification group audience: user-groups service unavailable');
            } else {
                try {
                    const memberOf = new Set(await service.getUserGroups(userId));
                    included = groups.some((groupId) => memberOf.has(groupId));
                } catch (error) {
                    this.logger.warn({ error, userId }, 'Failed to read user groups for notification audience check');
                }
            }
        }

        return included;
    }
}
