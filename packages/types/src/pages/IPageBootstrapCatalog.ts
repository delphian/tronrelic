/**
 * @fileoverview One component's list of CMS pages it can create.
 */

import type { IPageBootstrapCreateResult } from './IPageBootstrapCreateResult.js';
import type { IPageBootstrapRow } from './IPageBootstrapRow.js';

/**
 * The pages one module or plugin offers on its Bootstrap tab, bound to the
 * pages module. Built by `IPageBootstrapService.createCatalog`; the owner's
 * admin routes call it to list the rows and to create one.
 */
export interface IPageBootstrapCatalog {
    /**
     * Every entry with the current state of its address.
     *
     * @returns One row per entry, in the order the entries were given.
     */
    list(): Promise<IPageBootstrapRow[]>;

    /**
     * Propose one entry's page for curator review, if its address is free.
     *
     * The page is written as a non-curator, so it always waits in
     * `/system/curation` and visitors see nothing until a curator approves
     * it. Two requests racing past the address check still create one page,
     * because the pages module refuses the second.
     *
     * @param id - The entry to create.
     * @returns The updated row and curation item, or the reason nothing was created.
     * @throws Only on a failure with no known cause, such as a database error.
     */
    create(id: string): Promise<IPageBootstrapCreateResult>;
}
