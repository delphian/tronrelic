'use client';

/**
 * @fileoverview Client shell for /system/ai-tools — the AI tool governance dashboard.
 *
 * Holds the interactive surface: the in-page tab row and the four panels (Query —
 * the default — Registry, Activity, Approvals). The tab row is the menu module's
 * Submenu Pattern — a namespaced menu rendered with `MenuNavClient`, not a
 * hand-rolled button array — so it inherits per-user gating, ordering, and live
 * `menu:update` refresh. The server entry (`page.tsx`) fetches that namespace tree
 * SSR-first and passes it in, mirroring how `MenuNavSSR` feeds `MenuNavClient`.
 * Clicking a tab drives local state via `onItemSelect` rather than navigating;
 * `activeUrl` highlights the active tab since the route is identical across them.
 *
 * When holds are already waiting on first load the shell opens on Approvals
 * instead of Query, so the operator lands on the decision that needs them — unless
 * a `?tab=` deep link already named a tab, in which case that choice wins. A menu
 * node cannot carry a live count, so the pending-approval tally rides a summary
 * badge above the tab row rather than on the Approvals node itself. Governed
 * events arrive as WebSocket refetch signals — the count itself always comes from
 * the gated REST feed, never a global broadcast.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { Page, PageHeader } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { MenuNavClient } from '../../../../components/layout/MenuNav/MenuNavClient';
import { getSocket } from '../../../../lib/socketClient';
import { getApprovalsCount } from '../../../../modules/ai-tools';
import { RegistryTab } from './tabs/RegistryTab';
import { ActivityTab } from './tabs/ActivityTab';
import { ApprovalsTab } from './tabs/ApprovalsTab';
import { QueryTab } from './tabs/QueryTab';
import styles from './page.module.scss';

/** The dashboard tabs; the `?tab=` value carried by each submenu node. */
type TabId = 'query' | 'registry' | 'activity' | 'approvals';

/** The menu namespace the module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'ai-tools';

/**
 * Narrow an arbitrary `?tab=` string to a known TabId, so the deep-link seeding
 * and the click routing share one source of truth for valid tabs.
 *
 * @param tab - The raw `?tab=` value.
 * @returns True when the value names a real tab.
 */
function isTabId(tab: string | undefined): tab is TabId {
    return tab === 'query' || tab === 'registry' || tab === 'activity' || tab === 'approvals';
}

/**
 * Resolve a submenu node's `?tab=` value to a known TabId, defaulting to `query`
 * for an unrecognized or missing value so a malformed node can never leave the
 * page on a blank panel.
 *
 * @param url - The clicked node's url (e.g. `/system/ai-tools?tab=registry`).
 * @returns The matching tab id.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'query';
}

/**
 * Stable no-op for RegistryTab's required `onChanged`. The callback used to
 * re-check the trifecta banner after a registry change; with that banner removed
 * there is nothing left for the page to do, and a module-level constant keeps
 * RegistryTab's memoized callbacks from re-creating each render.
 */
const noop = (): void => {};

/**
 * Props for the client shell.
 */
interface IAiToolsAdminClientProps {
    /** SSR-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree, seeded onto the menu Redux slice. */
    submenuGeneratedAt: string;
    /**
     * The `?tab=` value from the request URL, read SSR-first in `page.tsx` so a
     * refreshed, bookmarked, or shared deep link opens on the right panel. An
     * unknown or absent value resolves to `query` and lets the pending-approval
     * auto-route decide the initial panel.
     */
    initialTab?: string;
}

/**
 * AI tool governance admin client shell.
 *
 * @param props - SSR submenu tree, its timestamp, and the deep-linked initial tab.
 * @returns The page.
 */
export function AiToolsAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: IAiToolsAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'query');
    const [pending, setPending] = useState(0);
    /** True once the initial pending fetch has auto-routed, so it fires at most once. */
    const autoRoutedRef = useRef(false);
    /**
     * True once the operator drives a tab choice — or a `?tab=` deep link already
     * named one — so the initial auto-route to Approvals never yanks them away.
     */
    const userPickedRef = useRef(isTabId(initialTab));

    const refreshPending = useCallback(async (): Promise<number | null> => {
        try {
            const count = await getApprovalsCount();
            setPending(count);
            return count;
        } catch {
            return null;
        }
    }, []);

    // On first load, if holds are already waiting, open on Approvals rather than
    // the default Query — unless a deep link or the operator already chose a tab.
    useEffect(() => {
        void (async () => {
            const count = await refreshPending();
            if (count && count > 0 && !autoRoutedRef.current && !userPickedRef.current) {
                autoRoutedRef.current = true;
                setActiveTab('approvals');
                window.history.replaceState(null, '', '/system/ai-tools?tab=approvals');
            }
        })();
    }, [refreshPending]);

    // Keep the pending-approvals badge live regardless of which tab is open.
    useEffect(() => {
        const socket = getSocket();
        const onApprovals = () => { void refreshPending(); };
        socket.on('ai-tools:approvals-changed', onApprovals);
        return () => {
            socket.off('ai-tools:approvals-changed', onApprovals);
        };
    }, [refreshPending]);

    /**
     * Activate the clicked tab and keep its URL a real deep link.
     *
     * `MenuNavClient` suppresses the <Link> navigation when `onItemSelect` is set,
     * so this both drives `activeTab` and rewrites the address in place with
     * `history.replaceState` (no server round-trip) so the registered `?tab=` URLs
     * become true deep links; `page.tsx` reads that value SSR-first to seed the
     * panel on next load. Recording the pick also locks out the pending-approval
     * auto-route so it can never override the operator's choice.
     *
     * @param item - The clicked submenu node, carrying its `?tab=` url.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        userPickedRef.current = true;
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/ai-tools?tab=${tab}`);
    }, []);

    return (
        <Page>
            <PageHeader title="AI Tools" subtitle="Govern every tool an AI agent can invoke — registry, activity, approvals, and per-tool policy." />

            {pending > 0 && (
                <div className={styles.summary}>
                    <Badge tone="warning">{pending} pending approval{pending === 1 ? '' : 's'}</Badge>
                </div>
            )}

            <div className={styles.submenu}>
                <MenuNavClient
                    namespace={SUBMENU_NAMESPACE}
                    items={submenuTree}
                    generatedAt={submenuGeneratedAt}
                    ariaLabel="AI tool governance sections"
                    activeUrl={`/system/ai-tools?tab=${activeTab}`}
                    onItemSelect={handleTabSelect}
                />
            </div>

            <div className={styles.content}>
                {activeTab === 'query' && <QueryTab />}
                {activeTab === 'registry' && <RegistryTab onChanged={noop} />}
                {activeTab === 'activity' && <ActivityTab />}
                {activeTab === 'approvals' && <ApprovalsTab onChanged={refreshPending} />}
            </div>
        </Page>
    );
}
