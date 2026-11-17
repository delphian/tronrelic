/**
 * Published props for the ClickHouse table browser exposed to plugins on
 * `context.system`.
 *
 * Publishing it lets a plugin embed a Database tab scoped to its own tables,
 * so an operator inspecting the plugin's analytical storage never leaves the
 * plugin's admin section.
 *
 * The interface is deliberately narrow — a subset of what the component
 * accepts — per the platform's policy of publishing a curated surface rather
 * than core's full internal API. The implementation extends this interface, so
 * the published subset is a real subset rather than a hand-copied description
 * that drifts.
 */

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
     * Scopes the browser to one plugin's tables, identified by its
     * `manifest.id` — `'dust-tracker'`, not the `trp-dust-tracker` directory
     * name. The component derives the table prefix with `pluginPrefix()`.
     *
     * Prefer this over `prefix`. A hand-written prefix drifts when a plugin's
     * identifier changes, and the mistake is not reported — a prefix matching
     * no table renders an empty browser rather than an error. Passing the id
     * lets the component derive the name that is correct by construction.
     */
    pluginId?: string;

    /**
     * Scopes the browser to exactly these table names. This is how a core
     * module scopes its Database tab: module tables such as `price_history`
     * or `account_transactions` follow no shared naming prefix the way plugin
     * tables do, so the module names its own tables, normally from the table
     * constants in its `database/index.ts`.
     *
     * Filtered in SQL by exact name, so a table added later by another
     * component can never appear here by sharing the opening of a name. An
     * empty list is a caller mistake and is reported rather than treated as
     * "no filter", which would list the whole deployment. `pluginId` wins
     * when both are supplied.
     */
    tables?: string[];

    /**
     * Restricts the browser to tables whose name starts with this string.
     * Filtered in SQL, so an unscoped inventory never leaves the server. Omit
     * for the whole-database view.
     *
     * @deprecated Pass `pluginId` for a plugin or `tables` for a module.
     * Retained so existing callers keep working while they migrate; either of
     * those wins when supplied alongside it.
     */
    prefix?: string;

    /**
     * Title of the browser's panel, on the header row beside the summary.
     * Defaults to "Tables". The browser draws its own panel, the same as the
     * collection browser, so both read as one kind of surface on a Database
     * tab. In the collapsible form the title is also the control that opens
     * the browser.
     */
    title?: string;

    /**
     * Whether to render the browser behind a disclosure heading that starts
     * closed. Defaults to false, the always-expanded form. Set it where the
     * inventory is one surface among several — the unscoped system console lists
     * every table in every database. A closed browser does not request its
     * statistics until opened, unless `hideWhenEmpty` is also set, which needs the
     * table count to decide whether to render at all.
     */
    collapsible?: boolean;

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
