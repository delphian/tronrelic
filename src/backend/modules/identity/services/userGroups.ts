/**
 * @fileoverview Reads the group list Better Auth carries on a user record.
 *
 * Shared by the OAuth callbacks in `auth.ts` and the consent gate, so every
 * place that decides "is this user in group X" reads the field the same way.
 */

/**
 * Read the `groups` field Better Auth carries on a user record.
 *
 * The field is one of this module's additional user fields, so Better Auth
 * types it loosely in plugin callbacks and hooks; this narrows it to a string
 * list so a malformed value can never grant membership.
 *
 * @param user - A user record passed to a plugin callback or read from a session.
 * @returns The user's group ids, or an empty list when the field is absent.
 */
export function userGroups(user: Record<string, unknown> | null | undefined): string[] {
    const groups = user?.groups;
    return Array.isArray(groups) ? groups.filter((group): group is string => typeof group === 'string') : [];
}
