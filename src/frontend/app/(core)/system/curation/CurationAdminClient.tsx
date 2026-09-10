'use client';

/**
 * @fileoverview Client shell for /system/curation — the central curation queue.
 *
 * Holds the page's interactive frame: a visually hidden page heading, the live
 * count of items waiting for review, the in-page tab row, and the active panel
 * (Pending, History, or Database). The Database panel is the core collection
 * browser scoped to this module's collections, the same one `/system/database`
 * uses, so an operator never has to leave the page to inspect curation storage.
 * The tab row is the menu module's Submenu Pattern — a
 * namespaced menu rendered with `MenuNavClient`, not a hand-rolled button pair —
 * so it inherits per-user gating, ordering, and live `menu:update` refresh. The
 * server entry (`page.tsx`) fetches that tree and passes it in.
 *
 * Clicking a tab changes local state through `onItemSelect` rather than
 * navigating, and rewrites the address in place so `?tab=` stays a real deep
 * link. A menu node cannot carry a live number, so the waiting count sits in a
 * badge above the tab row. It refreshes on the `curation:changed` WebSocket
 * signal; the count itself always comes from the admin-gated REST endpoint.
 */

import { useCallback, useEffect, useState } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { Page, Section } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { MenuNavClient } from '../../../../components/layout/MenuNav/MenuNavClient';
import { getSocket } from '../../../../lib/socketClient';
import { getCurationsCount } from '../../../../modules/curation';
import { CollectionBrowser } from '../../../../modules/database';
import { PendingTab } from './tabs/PendingTab';
import { HistoryTab } from './tabs/HistoryTab';
import styles from './page.module.scss';

/** The page's tabs; the `?tab=` value carried by each submenu node. */
type TabId = 'pending' | 'history' | 'database';

/** The menu namespace CurationModule registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'curation';

/**
 * Physical MongoDB collection prefix covering everything this module owns —
 * the held and decided items and the per-type default destinations. Scoping
 * the browser to it keeps the panel on curation's data instead of the whole
 * deployment's inventory. Key-value entries live in the shared `_kv`
 * collection, which falls outside this prefix and stays on `/system/database`.
 */
const COLLECTION_PREFIX = 'module_curation_';

/**
 * Narrow an arbitrary `?tab=` string to a known tab, so the deep-link seed and
 * the click handler share one definition of what a valid tab is.
 *
 * @param tab - The raw `?tab=` value.
 * @returns True when the value names a real tab.
 */
function isTabId(tab: string | undefined): tab is TabId {
    return tab === 'pending' || tab === 'history' || tab === 'database';
}

/**
 * Resolve a clicked submenu node to its tab, falling back to Pending so a
 * malformed node can never leave the page on an empty panel.
 *
 * @param url - The clicked node's url, e.g. `/system/curation?tab=history`.
 * @returns The matching tab id.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'pending';
}

/** Props for {@link CurationAdminClient}. */
interface ICurationAdminClientProps {
    /** Server-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree, seeded onto the menu Redux slice. */
    submenuGeneratedAt: string;
    /**
     * The `?tab=` value from the request URL, read on the server so a refreshed
     * or shared link opens on the same panel. Unknown values fall back to Pending.
     */
    initialTab?: string;
}

/**
 * Curation admin client shell.
 *
 * @param props - See {@link ICurationAdminClientProps}.
 * @returns The page.
 */
export function CurationAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: ICurationAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'pending');
    const [pending, setPending] = useState(0);

    /**
     * Re-read the waiting count for the badge above the tab row. The count is
     * secondary information, so a failed read leaves the last value in place
     * rather than interrupting the page.
     */
    const refreshPending = useCallback(async () => {
        try {
            setPending(await getCurationsCount());
        } catch {
            /* secondary data — keep the previous count */
        }
    }, []);

    /** Load the waiting count once the shell mounts. */
    useEffect(() => {
        void refreshPending();
    }, [refreshPending]);

    /**
     * Keep the waiting count live whichever tab is open, by refetching on the
     * module's `curation:changed` signal.
     */
    useEffect(() => {
        const socket = getSocket();
        const onCurations = () => { void refreshPending(); };
        socket.on('curation:changed', onCurations);
        return () => { socket.off('curation:changed', onCurations); };
    }, [refreshPending]);

    /**
     * Activate the clicked tab and keep its address a real deep link.
     * `MenuNavClient` suppresses its link navigation when `onItemSelect` is set,
     * so this both switches the panel and rewrites the address in place, with no
     * server round trip; `page.tsx` reads that value on the next load.
     *
     * @param item - The clicked submenu node, carrying its `?tab=` url.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/curation?tab=${tab}`);
    }, []);

    return (
        <Page>
            {/* The System layout supplies navigation but no heading, so this
                names the page for screen readers. It stays visually hidden
                because a visible title would only repeat the menu entry and
                the active tab. */}
            <h1 className={styles.sr_only}>Curation</h1>

            {pending > 0 && (
                <div className={styles.summary}>
                    <Badge tone="warning">{pending} waiting for review</Badge>
                </div>
            )}

            {/* The tab row and its panel share one Section so the gap between
                them is a section gap, not the larger page gap. */}
            <Section gap="md">
                <MenuNavClient
                    namespace={SUBMENU_NAMESPACE}
                    items={submenuTree}
                    generatedAt={submenuGeneratedAt}
                    ariaLabel="Curation sections"
                    activeUrl={`/system/curation?tab=${activeTab}`}
                    onItemSelect={handleTabSelect}
                />

                <div className={styles.content}>
                    {activeTab === 'pending' && <PendingTab onChanged={refreshPending} />}
                    {activeTab === 'history' && <HistoryTab />}

                    {/* Read-only on purpose. A decided item is the permanent
                        audit record of who approved what and where it went, and
                        the module offers no delete route for that reason; a
                        pending item must change only through the decision gate.
                        Editing or deleting documents here would bypass both. */}
                    {activeTab === 'database' && (
                        <CollectionBrowser prefix={COLLECTION_PREFIX} allowEdit={false} allowDelete={false} />
                    )}
                </div>
            </Section>
        </Page>
    );
}
