/**
 * @fileoverview One page of the admin page list.
 */

import type { IPage } from './IPage.js';

/**
 * The answer to `IPageService.listPages`: one page of pages and how many match
 * the filters across every page, so the admin list can draw its pager.
 */
export interface IPageListPage {
    /** The pages on this page, newest first, decorated with review state. */
    pages: IPage[];

    /** Pages matching the filters across every page. */
    total: number;
}
