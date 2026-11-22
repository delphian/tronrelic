/**
 * @fileoverview A CMS page the tools module can create, with its current state.
 */

import type { ToolsBootstrapPageState } from './ToolsBootstrapPageState.js';

/**
 * One row of the Bootstrap tab on `/system/tools`: a page the tools module
 * ships, the address it would take, and whether a page already holds that
 * address. Returned by `GET /api/admin/tools/bootstrap` and by the create
 * endpoint after it proposes the page.
 */
export interface IToolsBootstrapPage {
    /** Stable id of the bootstrap entry, used in the create endpoint's path. */
    id: string;

    /** Short name shown on the row. */
    label: string;

    /** One sentence saying what the page is for. */
    description: string;

    /** The address the page is created at. Admins may change it later, under the CMS's redirect rules. */
    slug: string;

    /** Whether a page holds the address, and in what state. */
    state: ToolsBootstrapPageState;

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
