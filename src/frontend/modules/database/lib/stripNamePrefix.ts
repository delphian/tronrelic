/**
 * @fileoverview The name a storage browser shows for a collection or table once
 * the prefix it is scoped by is taken off the front.
 *
 * A scoped browser lists only names that begin with its prefix, such as
 * `plugin_<id>_` or `module_<id>_`. Repeating that prefix on every row spends
 * most of a phone's line on text that is the same in every row, and pushes each
 * name onto extra lines under its expand control. The browsers therefore show
 * the part after the prefix and state the prefix once in their header.
 *
 * Only the displayed text changes. API calls, React keys, and sorting keep using
 * the full stored name.
 */

/**
 * Remove the browser's scope prefix from a name for display.
 *
 * The name comes back unchanged when there is no prefix, when the name does not
 * start with it, or when removing it would leave nothing, so a row is never
 * labelled with an empty string.
 *
 * @param name - The collection or table name as stored.
 * @param prefix - The prefix the browser is scoped by; omitted for an unscoped
 * browser, which has no shared prefix to remove.
 * @returns The text to show for the row.
 */
export function stripNamePrefix(name: string, prefix?: string): string {
    let label = name;
    if (prefix && name.startsWith(prefix) && name.length > prefix.length) {
        label = name.slice(prefix.length);
    }
    return label;
}
