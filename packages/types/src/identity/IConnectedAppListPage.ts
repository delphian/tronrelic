/**
 * @file IConnectedAppListPage.ts
 *
 * One page of the admin list of connected apps.
 */

import type { IConnectedAppAdminRow } from './IConnectedAppAdminRow.js';

/**
 * The answer to `IConnectedAppsService.listAll`: one page of grants and enough
 * about the whole list for the admin page to draw its pager and to say when a
 * search could not cover every matching account.
 */
export interface IConnectedAppListPage {
    /** The page of grants, newest first. */
    apps: IConnectedAppAdminRow[];

    /** Grants matching the request across every page, for the pager. */
    total: number;

    /**
     * True when more accounts matched the search than one search reads. The
     * grants listed then belong to the most recently active of the matching
     * accounts only, so the admin page asks for a more specific search. Always
     * false without a search.
     */
    searchTruncated: boolean;
}
