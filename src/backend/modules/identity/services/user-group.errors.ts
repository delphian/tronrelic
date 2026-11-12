/**
 * Typed errors thrown by `UserGroupService`.
 *
 * The controller maps each class to a specific HTTP status via `instanceof`
 * checks, so service messages stay human-readable for log output and never
 * drive status-code selection.
 */

/**
 * Client-side validation failure (missing field, malformed slug, reserved
 * name, empty rename, etc.). Maps to HTTP 400.
 */
export class UserGroupValidationError extends Error {
    readonly name = 'UserGroupValidationError';
    constructor(message: string) {
        super(message);
    }
}

/**
 * Requested group does not exist. Maps to HTTP 404.
 */
export class UserGroupNotFoundError extends Error {
    readonly name = 'UserGroupNotFoundError';
    constructor(public readonly groupId: string) {
        super(`Group "${groupId}" does not exist`);
    }
}

/**
 * Group already exists. Thrown by `createGroup` when the slug is taken,
 * either via the pre-insert check or via a MongoDB duplicate-key error
 * (code 11000) from a concurrent insert. Maps to HTTP 409.
 */
export class UserGroupConflictError extends Error {
    readonly name = 'UserGroupConflictError';
    constructor(public readonly groupId: string) {
        super(`Group "${groupId}" already exists`);
    }
}

/**
 * Operation rejected because the target group is flagged `system: true`.
 * System groups can only be modified by platform code, not by operators.
 * Maps to HTTP 403.
 */
export class UserGroupSystemProtectedError extends Error {
    readonly name = 'UserGroupSystemProtectedError';
    constructor(public readonly groupId: string, action: 'modify' | 'delete') {
        super(`Group "${groupId}" is a system group and cannot be ${action === 'modify' ? 'modified' : 'deleted'}`);
    }
}

/**
 * A membership write would have left the `admin` group with no live member.
 * With no admin, nobody can sign in to the admin pages to add one back, so
 * the write is refused and nothing is changed. Maps to HTTP 409.
 */
export class UserGroupLastAdminError extends Error {
    readonly name = 'UserGroupLastAdminError';
    constructor(public readonly userId: string) {
        super(`User "${userId}" is the only admin, so they cannot be removed from the admin group`);
    }
}

/**
 * Membership write target user does not exist. Maps to HTTP 404.
 */
export class UserGroupMemberNotFoundError extends Error {
    readonly name = 'UserGroupMemberNotFoundError';
    constructor(public readonly userId: string) {
        super(`User "${userId}" does not exist`);
    }
}
