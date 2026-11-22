/**
 * @fileoverview Definition of one CMS page the tools module can create.
 */

import type { IPageProposal } from '@/types';

/**
 * A page the tools module ships, as listed on the Bootstrap tab of
 * `/system/tools`. The module never creates it on its own: an admin clicks
 * Create, and the page goes to the curation queue like any proposed page.
 */
export interface IToolsBootstrapItem {
    /** Stable id, used in the create endpoint's path. */
    id: string;

    /** Short name shown on the row. */
    label: string;

    /** One sentence saying what the page is for. */
    description: string;

    /**
     * The page to propose. Its `slug` is the page's default address, which
     * admins may change later under the CMS's redirect rules.
     */
    proposal: IPageProposal & { slug: string };
}
