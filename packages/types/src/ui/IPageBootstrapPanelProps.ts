/**
 * @file IPageBootstrapPanelProps.ts
 *
 * Props of the core Bootstrap panel, `PageBootstrapPanel`. Declared here so
 * the component, the tools module's Bootstrap tab, and the plugin-facing
 * `context.system.PageBootstrapPanel` share one shape.
 */

import type { IPageBootstrapRow } from '../pages/IPageBootstrapRow.js';

/**
 * The rows a Bootstrap tab lists and the request that creates one.
 *
 * The panel draws the table, the Create button, and the toast that reports
 * the outcome. The owner supplies the rows and the call to its own admin
 * route, because a module and a plugin reach the backend through different
 * clients.
 */
export interface IPageBootstrapPanelProps {
    /**
     * The rows to list, held by the owning page so they survive a tab switch;
     * null when they could not be loaded, which the panel says rather than
     * showing an empty list an admin could mistake for "nothing to create".
     */
    rows: IPageBootstrapRow[] | null;

    /**
     * Called with the row the backend returned after a create, so the owner
     * can replace its copy and the page is still shown as created after the
     * admin visits another tab.
     */
    onRowUpdated: (row: IPageBootstrapRow) => void;

    /**
     * Ask the owner's admin route to create one entry's page. Resolve with
     * the updated row; reject with an `Error` whose message is the backend's
     * explanation, which the panel shows the admin.
     *
     * @param id - The entry to create.
     * @returns The entry's row after the page was proposed.
     */
    onCreate: (id: string) => Promise<IPageBootstrapRow>;

    /**
     * One line under the panel title saying what the pages are. Defaults to a
     * sentence that fits any owner.
     */
    meta?: string;
}
