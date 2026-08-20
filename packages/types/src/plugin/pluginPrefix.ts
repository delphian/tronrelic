/**
 * @fileoverview The single rule saying where a plugin's stored data lives,
 * shared by every store rather than restated once per store.
 *
 * MongoDB has always prefixed a plugin's collections with `plugin_<id>_`,
 * keeping the identifier exactly as the manifest declares it — the live
 * collections are named `plugin_dust-tracker_*` and `plugin_resource-markets_*`.
 * ClickHouse had no equivalent, so plugins named their tables by hand and core
 * had nothing to enumerate against when it needed to know what a plugin owns,
 * such as for an uninstall sweep or per-plugin storage accounting. Rather than
 * give ClickHouse a second rule to diverge from this one, both stores use this.
 *
 * Keeping the identifier verbatim is what makes the scheme safe, and it is
 * worth understanding before anyone is tempted to "clean up" the hyphens. The
 * delimiter between the id and the name that follows is `_`, and a plugin id
 * may not contain `_` — see `PLUGIN_ID_PATTERN`. Because the delimiter cannot
 * occur inside the field it delimits, the `_` after the id is an unambiguous
 * boundary, so no plugin's prefix can ever be the opening of another plugin's
 * prefix. Converting the hyphens to underscores would put the delimiter inside
 * that field and destroy the property: `dust` would derive `plugin_dust_`,
 * which is the opening of `plugin_dust_tracker_`, and a listing filtered by the
 * first would return the second plugin's data.
 */

/**
 * Builds the prefix that every collection and table belonging to a plugin
 * starts with.
 *
 * Call this rather than writing `plugin_<id>_` by hand. A hand-written literal
 * is what drifts when an identifier changes, and the mistake does not announce
 * itself — it surfaces as a query that quietly matches nothing.
 *
 * @param pluginId - The plugin's `manifest.id`, not its directory or repository
 *                   name. Those carry a `trp-` prefix that the identifier does
 *                   not, and using one would build a prefix matching no stored
 *                   data at all.
 * @returns The prefix to prepend to a logical collection or table name, and the
 *          value to filter a listing by when enumerating what a plugin owns.
 * @throws If `pluginId` is empty or not a string, because an empty prefix would
 *         match every collection and table in the deployment, core's included.
 */
export const pluginPrefix = (pluginId: string): string => {
    if (!pluginId || typeof pluginId !== 'string') {
        throw new Error('pluginPrefix requires a non-empty plugin id');
    }

    const result = `plugin_${pluginId}_`;

    return result;
};
