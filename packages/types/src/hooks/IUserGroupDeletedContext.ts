/**
 * @fileoverview Payload for the `http.groupDeleted` observer hook.
 *
 * Group ids are reusable slugs: once an admin deletes a group, a new group can
 * be created under the same id. Anything another component stored against the
 * old group's id (the MCP module's tool grants and group settings, for
 * example) would then apply to the new group without anyone approving it
 * again. Identity fires this observer seam after a group is deleted so those
 * components can remove what they keyed to it, without identity depending on
 * them.
 *
 * @module types/hooks/IUserGroupDeletedContext
 */

/**
 * Context handed to handlers of the `http.groupDeleted` hook.
 */
export interface IUserGroupDeletedContext {
    /** Id of the group that was just deleted. A later group may reuse it. */
    groupId: string;
}
