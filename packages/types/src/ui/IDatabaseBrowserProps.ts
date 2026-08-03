/**
 * Published props for the database and ClickHouse browsers exposed to plugins
 * on `context.system`.
 *
 * These surfaces began as route-local components inside the system console,
 * hardcoded to the whole deployment. Publishing them lets a plugin embed a
 * Database tab scoped to its own storage, so an operator can inspect and
 * correct the plugin's data without leaving the plugin's admin section.
 *
 * Both interfaces are deliberately narrow — a subset of what the components
 * accept — per the platform's policy of publishing a curated surface rather
 * than core's full internal API. The implementations extend these interfaces,
 * so the published subset is a real subset rather than a hand-copied
 * description that drifts.
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
     * Heading for the collection list. Defaults to "Collections". Override it
     * when the surrounding page would otherwise leave the scope ambiguous.
     */
    title?: string;
}

/**
 * Props accepted by the ClickHouse table browser.
 *
 * There is no edit or delete counterpart by design: ClickHouse mutations run
 * as asynchronous `ALTER TABLE ... DELETE` operations whose effects are not
 * immediately visible, which makes them a poor fit for a point-and-click admin
 * surface. Viewing is what operations debugging actually needs.
 */
export interface IClickHouseTableBrowserProps {
    /**
     * Restricts the browser to tables whose name starts with this string.
     * Filtered in SQL, so an unscoped inventory never leaves the server. Omit
     * for the whole-database view.
     */
    prefix?: string;

    /**
     * Heading for the table list. Defaults to "Tables".
     */
    title?: string;

    /**
     * Hides the component entirely when no table matches `prefix`, instead of
     * rendering an empty panel. Defaults to false.
     *
     * Set true when embedding in a page that may or may not have ClickHouse
     * tables — a plugin storing only in MongoDB should show nothing here
     * rather than an empty ClickHouse section implying something is missing.
     */
    hideWhenEmpty?: boolean;
}
