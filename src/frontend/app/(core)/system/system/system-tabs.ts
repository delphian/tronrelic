/**
 * @fileoverview The /system/system page's tab ids, shared by the server entry and the client shell.
 *
 * The server entry needs to know which tab a request opens so it fetches the
 * Pipeline payload only when that tab will render; the client shell needs the
 * same rule to pick its first panel. Keeping the rule here stops the two from
 * disagreeing about which tab a URL means.
 */

/** Every tab the page renders; the `?tab=` value carried by each submenu node. */
export type SystemTabId = 'pipeline' | 'server' | 'config' | 'schedules' | 'logs' | 'websockets' | 'mongo' | 'clickhouse';

/** Tab shown for an absent or unrecognized `?tab=` value. */
export const DEFAULT_SYSTEM_TAB: SystemTabId = 'pipeline';

/**
 * Every valid tab id. A Set so an unknown value falls back to the default
 * rather than rendering a blank panel, since `?tab=` values are user-editable.
 */
const TAB_IDS = new Set<string>(['pipeline', 'server', 'config', 'schedules', 'logs', 'websockets', 'mongo', 'clickhouse']);

/**
 * Old tab ids still found in bookmarks, mapped to the tab that replaced them.
 * `overview` held the Server and Blockchain consoles; the blockchain half is
 * now the Pipeline tab, which is what someone checking the page most often
 * wants.
 */
const LEGACY_TAB_IDS: Record<string, SystemTabId> = {
    overview: 'pipeline'
};

/**
 * Resolve a raw `?tab=` value to a known tab id.
 *
 * @param tab - A value from a URL or a submenu node.
 * @returns The matching tab id, a legacy id's replacement, or the default.
 */
export function toTabId(tab: string | undefined): SystemTabId {
    let resolved: SystemTabId = DEFAULT_SYSTEM_TAB;

    if (tab && TAB_IDS.has(tab)) {
        resolved = tab as SystemTabId;
    } else if (tab && LEGACY_TAB_IDS[tab]) {
        resolved = LEGACY_TAB_IDS[tab];
    }

    return resolved;
}
