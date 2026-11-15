/**
 * @fileoverview A filter the call detail panel asks the Activity feed to apply,
 * such as "every call by this caller".
 *
 * The panel knows which caller or tool the admin is looking at, while the feed
 * owns the filters. This type is what passes between them, so the panel can
 * offer the shortcut without knowing how the feed stores its filters.
 */

/** One filter the detail panel asks the Activity feed to apply. */
export interface IInvocationFilter {
    /** Show only calls counted against this caller: a user id, or an anonymous caller's network hash. */
    principalId?: string;

    /** How to name that caller in the filter chip, such as an email address. */
    principalLabel?: string;

    /** Show only calls to this tool. */
    toolName?: string;
}
