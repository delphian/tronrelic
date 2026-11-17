/**
 * Published props for the MongoDB collection browser exposed to plugins on
 * `context.system`.
 *
 * This surface began as a route-local component inside the system console,
 * hardcoded to the whole deployment. Publishing it lets a plugin embed a
 * Database tab scoped to its own storage, so an operator can inspect and
 * correct the plugin's data without leaving the plugin's admin section.
 *
 * The interface is deliberately narrow — a subset of what the component
 * accepts — per the platform's policy of publishing a curated surface rather
 * than core's full internal API. The implementation extends this interface, so
 * the published subset is a real subset rather than a hand-copied description
 * that drifts.
 */

/**
 * Props accepted by the MongoDB collection browser.
 */
export interface ICollectionBrowserProps {
    /**
     * Restricts the browser to collections whose name starts with this string,
     * e.g. `plugin_my-plugin_`. Filtering happens server-side, so a scoped
     * caller never receives the rest of the deployment's inventory. Omit for
     * the whole-database view the system console uses.
     */
    prefix?: string;

    /**
     * Whether documents may be edited in place. Defaults to true.
     *
     * Set false when a plugin maintains invariants across collections that a
     * raw edit would break — where the plugin's own admin actions are the
     * supported way to mutate, an edit box is a footgun rather than a feature.
     */
    allowEdit?: boolean;

    /**
     * Whether documents may be deleted. Defaults to true.
     *
     * The same caution applies as `allowEdit`, more sharply: deleting a row
     * that other collections derive from can strand data nothing recomputes.
     */
    allowDelete?: boolean;

    /**
     * Title of the browser's panel, on the header row beside the summary.
     * Defaults to "Collections". The browser draws its own panel, so place it
     * directly on the page or tab rather than inside a card. In the
     * collapsible form the title is also the control that opens the browser.
     */
    title?: string;

    /**
     * Whether to render the browser behind a disclosure heading that starts
     * closed. Defaults to false, which is the always-expanded form.
     *
     * Set it on a page where the inventory is one surface among several and its
     * full height would push everything below it off screen — the unscoped
     * system console view lists every collection in the deployment. It also
     * saves work: the statistics request runs one `collStats` command per
     * collection in scope, and a collapsed browser does not send it until the
     * operator opens the browser.
     */
    collapsible?: boolean;
}
