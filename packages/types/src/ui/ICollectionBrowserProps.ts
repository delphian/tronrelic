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
     * Heading for the collection list. Omitted by default, because the
     * embedding page usually supplies its own and a built-in heading would read
     * as a duplicate. Set it when the surrounding page would otherwise leave
     * the scope ambiguous.
     */
    title?: string;
}
