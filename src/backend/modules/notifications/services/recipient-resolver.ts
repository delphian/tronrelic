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
     * audience group. A caller testing more than one audience for the same
     * user should call {@link audienceTest} instead, which reads those groups
     * once for all of the tests.
     *
     * @param audience - Groups and/or explicit user ids the category targets.
     * @param userId - Better Auth id of the user being checked.
     * @returns True when the user is listed explicitly or is in one of the groups.
     */
    async includes(audience: INotificationAudience, userId: string): Promise<boolean> {
        let included = (audience.userIds ?? []).includes(userId);

        if (!included && (audience.groups ?? []).length > 0) {
            const matches = await this.audienceTest(userId);
            included = matches(audience);
        }

        return included;
    }

    /**
     * Build a reusable audience test for one user.
     *
     * Checking a whole catalog of categories one `includes()` call at a time
     * costs one membership lookup per category, and every one of those lookups
     * is the same MongoDB read for the same user. Because categories are
     * extensible by modules and plugins, that cost grows with the registry.
     * Reading the user's groups once here and returning a synchronous test
     * keeps a request that checks every category down to a single lookup.
     *
     * @param userId - Better Auth id of the user every test will be about.
     * @returns A test reporting whether a given audience includes that user.
     */
    async audienceTest(userId: string): Promise<(audience: INotificationAudience) => boolean> {
        const memberOf = await this.groupsOf(userId);

        /**
         * Answer the membership question from the already-loaded group set, so
         * no further lookup happens however many audiences the caller tests.
         *
         * @param audience - Groups and/or explicit user ids to test against.
         * @returns True when the user is listed explicitly or is in one of the groups.
         */
        const matches = (audience: INotificationAudience): boolean => {
            const listed = (audience.userIds ?? []).includes(userId);
            const inGroup = (audience.groups ?? []).some((groupId) => memberOf.has(groupId));
            return listed || inGroup;
        };

        return matches;
    }

    /**
     * Read the groups one user belongs to, as a set for repeated membership
     * tests.
     *
     * Kept separate so the one-off and the batched check share one lookup path
     * and one failure policy. When the `'user-groups'` service is unavailable
     * or the lookup fails, the result is an empty set, so group membership
     * counts as false — the same degradation `resolve` applies when it treats
     * an unresolvable group as contributing nobody rather than failing the
     * caller.
     *
     * @param userId - Better Auth id of the user whose memberships are needed.
     * @returns The user's group ids, empty when they cannot be read.
     */
    private async groupsOf(userId: string): Promise<Set<string>> {
        let memberOf = new Set<string>();

        const service = this.getUserGroups();
        if (!service) {
            this.logger.warn({ userId }, 'Cannot check notification group audience: user-groups service unavailable');
        } else {
            try {
                memberOf = new Set(await service.getUserGroups(userId));
            } catch (error) {
                this.logger.warn({ error, userId }, 'Failed to read user groups for notification audience check');
            }
        }

        return memberOf;
    }
}
