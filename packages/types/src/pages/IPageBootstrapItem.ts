/**
 * @fileoverview Definition of one CMS page a module or plugin can create.
 */

import type { IPageProposal } from './IPageProposal.js';

/**
 * A page a module or plugin ships, as listed on its admin page's Bootstrap
 * tab. Nothing creates it on its own: an admin clicks Create, and the page
 * goes to the curation queue like any proposed page.
 */
export interface IPageBootstrapItem {
    /** Stable id, unique within its catalog and used in the create endpoint's path. */
    id: string;

    /** Short name shown on the row. */
    label: string;

    /** One sentence saying what the page is for. */
    description: string;

    /**
     * The page to propose. Its `slug` is the page's default address, which
     * admins may change later under the CMS's redirect rules. Set `source`
     * to the owning module or plugin, so a curator can see where the page
     * came from.
     */
    proposal: IPageProposal & { slug: string };
}
