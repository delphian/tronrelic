/**
 * @fileoverview The page that holds an address, and how it holds it.
 */

import type { IPage } from './IPage';

/**
 * The answer to "which page owns this address?", returned by
 * `IPageService.findPageHoldingSlug`.
 *
 * A new page can only take an address no other page holds, and the pages
 * module counts a soft-deleted page and a page whose proposal was rejected as
 * holding theirs, because deletion is soft and there is no purge. A caller
 * that offers to create a page uses this to say why it cannot, before it
 * tries.
 */
export interface IPageSlugHolder {
    /** The holding page's latest edit, whatever its review or deletion state. */
    page: IPage;

    /**
     * `slug` when the address is the page's own (latest edit or approved
     * version); `redirect` when it is in the page's redirect history, so a
     * request for it is sent on to the page's current address.
     */
    holds: 'slug' | 'redirect';
}
