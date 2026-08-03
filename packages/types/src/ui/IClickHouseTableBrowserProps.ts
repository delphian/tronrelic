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
     * Restricts the browser to tables whose name starts with this string.
     * Filtered in SQL, so an unscoped inventory never leaves the server. Omit
     * for the whole-database view.
     */
    prefix?: string;

    /**
     * Heading rendered above the table list. There is no default — omit it and
     * the component renders no heading at all.
     *
     * This differs deliberately from the collection browser, which always
     * labels its list. That browser puts its heading inside a card below a
     * separate overview card, so the label distinguishes two panels. This one
     * puts the heading at the very top, where an embedding page has usually
     * already supplied a heading of its own (the system console's ClickHouse
     * section does exactly that), and a built-in default would read as a
     * duplicate. Pass a title only when the surrounding page would otherwise
     * leave the scope ambiguous.
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
