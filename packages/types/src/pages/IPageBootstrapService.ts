/**
 * @fileoverview The pages module's service for components that ship CMS pages.
 */

import type { ISystemLogService } from '../system-log/index.js';
import type { IPageBootstrapCatalog } from './IPageBootstrapCatalog.js';
import type { IPageBootstrapItem } from './IPageBootstrapItem.js';

/**
 * Lets a module or plugin offer default CMS pages that an admin creates from
 * a Bootstrap tab, such as a tool page whose text and search metadata admins
 * then edit without a deploy.
 *
 * Published on the service registry as `'page-bootstrap'`
 * (`PAGE_BOOTSTRAP_SERVICE`). It is the only page access the registry offers.
 * It can read which page holds an address and propose a page for review,
 * and nothing else: the full `IPageService` would let a caller write as a
 * curator, which publishes without review, and change the list of addresses
 * pages may never take.
 */
export interface IPageBootstrapService {
    /**
     * Bind a component's entries to the pages module.
     *
     * @param items - The pages the component offers, in display order. Ids
     *   must be unique within the list.
     * @param logger - The component's own logger, so a created page is
     *   recorded on the component's Logs tab.
     * @returns The catalog the component's admin routes list and create through.
     * @throws When two entries share an id, which is a mistake in the code
     *   that offers them.
     */
    createCatalog(items: ReadonlyArray<IPageBootstrapItem>, logger: ISystemLogService): IPageBootstrapCatalog;
}
