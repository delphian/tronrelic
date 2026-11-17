/**
 * @file IConnectedAppListOptions.ts
 *
 * What the admin list of connected apps is asked for: one page, optionally
 * narrowed to the users matching a search.
 */

/**
 * Paging and search for `IConnectedAppsService.listAll`.
 *
 * Every grant across every user can run to thousands of rows, so the admin
 * page reads one page at a time and finds one person's apps by searching for
 * them rather than by scrolling.
 */
export interface IConnectedAppListOptions {
    /** Most grants to return. The caller bounds it; the admin route allows 1 to 200. */
    limit: number;

    /** Grants to skip, newest first, so a caller can reach any page. */
    offset: number;

    /**
     * Text to find in the account's email address or display name, matched
     * case-insensitively anywhere in either. Only grants held by matching
     * accounts are listed. Omit it, or pass blank text, to list every grant.
     */
    search?: string;
}
