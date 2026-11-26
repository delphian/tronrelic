/**
 * @fileoverview A CMS page a component offers to create, with the state of its address.
 */

import type { PageBootstrapState } from './PageBootstrapState.js';

/**
 * One row of a Bootstrap tab: a page a module or plugin ships, the address
 * it would take, and whether a page already holds that address. A catalog
 * returns these from `list()` and from `create()` after it proposes a page,
 * and the admin route serving the tab sends them unchanged.
 */
export interface IPageBootstrapRow {
    /** Stable id of the bootstrap entry, used in the create endpoint's path. */
    id: string;

    /** Short name shown on the row. */
    label: string;

    /** One sentence saying what the page is for. */
    description: string;

    /** The address the page is created at. Admins may change it later, under the CMS's redirect rules. */
    slug: string;

    /** Whether a page holds the address, and in what state. */
    state: PageBootstrapState;

    /**
     * The page holding the address, so the admin can find it on
     * `/system/pages`; null when the state is `absent`.
     */
    holder: {
        /** Core content id; absent on a page the adoption migration has not reached. */
        contentId?: string;
        title: string;
        slug: string;
    } | null;
}
