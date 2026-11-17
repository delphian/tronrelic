'use client';

/**
 * @fileoverview Client shell for /system/ai-tools — the AI tool governance dashboard.
 *
 * Holds the interactive surface: the in-page tab row and the seven panels (Query —
 * the default — Registry, Activity, Approvals, Schedules, Database, Logs). The
 * last three are core components scoped to this module, not panels written for
 * this page, so the authority behind them is the same one `/system/scheduler`,
 * `/system/database`, and `/system/logs` use. The tab row is the menu module's
 * Submenu Pattern — a namespaced menu rendered with `MenuNavClient`, not a
 * hand-rolled button array — so it inherits per-user gating, ordering, and live
 * `menu:update` refresh. The server entry (`page.tsx`) fetches that namespace tree
 * SSR-first and passes it in, mirroring how `MenuNavSSR` feeds `MenuNavClient`.
 * Clicking a tab drives local state via `onItemSelect` rather than navigating;
 * `activeUrl` highlights the active tab since the route is identical across them.
 *
 * The Query tab stays mounted behind the other tabs rather than being torn
 * down on a tab switch. It holds a live conversation and possibly a stream in
 * flight, and unmounting it discarded both — an operator who glanced at
 * Approvals came back to an empty chat. The other tabs are cheap to rebuild
 * and re-fetch on open, so they still mount on demand.
 *
 * When holds are already waiting on first load the shell opens on Approvals
 * instead of Query, so the operator lands on the decision that needs them — unless
 * the address already named a destination, with either a `?tab=` deep link or a
 * `?conversation=` one that only the Query tab can show, in which case that
 * choice wins. A menu
 * node cannot carry a live count, so the pending-approval tally rides a badge
 * beside the page title rather than on the Approvals node itself. The page
 * renders in the shared `AdminPage` shell, which holds the header, the tab row,
 * and the active panel one stack gap apart, as every admin page does. Governed
 * events arrive as WebSocket refetch signals — the count itself always comes from
 * the gated REST feed, never a global broadcast.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { AdminPage } from '../../../../../../components/layout';
import { Badge } from '../../../../../../components/ui/Badge';
import { MenuNavClient } from '../../../../../../components/layout/MenuNav/MenuNavClient';
import { getSocket } from '../../../../../../lib/socketClient';
import { getApprovalsCount } from '../../../../../../modules/ai-tools';
import { CollectionBrowser } from '../../../../../../modules/database';
import { SystemLogsMonitor } from '../../../../../../modules/logs';
import { SchedulerMonitor, type SchedulerJob } from '../../../../../../modules/scheduler';
import { RegistryTab } from './tabs/RegistryTab';
import { ActivityTab } from './tabs/ActivityTab';
import { ApprovalsTab } from './tabs/ApprovalsTab';
import { QueryTab } from './tabs/QueryTab';
import { writeAiToolsSearchParam } from './tabs/aiToolsUrl';
import styles from './page.module.scss';

/** The dashboard tabs; the `?tab=` value carried by each submenu node. */
type TabId = 'query' | 'registry' | 'activity' | 'approvals' | 'schedules' | 'database' | 'logs';

/** The menu namespace the module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'ai-tools';

/**
 * Name prefix shared by every scheduler job the module registers
 * (`ai-tools:prune-audit` and `ai-tools:run-scheduled-prompts`).
 *
 * The Schedules tab filters on the prefix rather than listing job names, so a
 * job the module adds later appears here without a matching edit to this file.
 * The literal is repeated from `AiToolsModule.ts` because frontend code cannot
 * import backend code.
 */
const JOB_PREFIX = 'ai-tools:';

/**
 * Physical MongoDB collection prefix covering the module's six collections:
 * the invocation audit trail, the approval queue, query history, saved
 * prompts, static prompt variables, and the audience-scoped system prompts.
 * The module's tool states, policy overrides, master system prompt, and screen
 * settings are key-value entries in the shared `_kv` collection, which falls
 * outside this prefix and stays reachable from `/system/database`.
 */
const COLLECTION_PREFIX = 'module_ai-tools_';

/** Log service name the module's `logger.child({ module: 'ai-tools' })` records under. */
const LOG_SERVICE = 'tronrelic:ai-tools';

/**
 * Narrow an arbitrary `?tab=` string to a known TabId, so the deep-link seeding
 * and the click routing share one source of truth for valid tabs.
 */
function isTabId(tab: string | undefined): tab is TabId {
    return tab === 'query' || tab === 'registry' || tab === 'activity' || tab === 'approvals'
        || tab === 'schedules' || tab === 'database' || tab === 'logs';
}

/**
 * Select this module's scheduler jobs for the Schedules tab. A predicate on the
 * name prefix rather than a fixed list, so the tab keeps showing every job the
 * module owns when one is added.
 */
function isAiToolsJob(job: SchedulerJob): boolean {
    return job.name.startsWith(JOB_PREFIX);
}

/**
 * Resolve a submenu node's `?tab=` value to a known TabId, defaulting to `query`
 * for an unrecognized or missing value so a malformed node can never leave the
 * page on a blank panel.
 *
 * @param url - The clicked node's url (e.g. `/system/ai-tools?tab=registry`).
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'query';
}

/**
 * Stable no-op for RegistryTab's required `onChanged`, which the page has no use for. A
 * module-level constant keeps RegistryTab's memoized callbacks from re-creating each render.
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
     * unknown or absent value resolves to `query` and, unless a conversation was
     * deep-linked, lets the pending-approval auto-route decide the initial panel.
     */
    initialTab?: string;
    /**
     * The `?conversation=` value from the request URL, read SSR-first so a
     * refreshed or shared address reopens the conversation that was on screen.
     * Handed straight to the Query tab, which owns the conversation, and also
     * treated as an explicit destination, since only that tab can display it.
     */
    initialConversationId?: string | null;
}

/**
 * AI tool governance admin client shell.
 *
 * @param props - SSR submenu tree, its timestamp, and the deep-linked initial
 *   tab and conversation.
 * @returns The page.
 */
export function AiToolsAdminClient({ submenuTree, submenuGeneratedAt, initialTab, initialConversationId = null }: IAiToolsAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'query');
    const [pending, setPending] = useState(0);
    /** True once the initial pending fetch has auto-routed, so it fires at most once. */
    const autoRoutedRef = useRef(false);
    /**
     * True once the operator drives a tab choice — or the request URL already
     * named a destination, either with `?tab=` or with a `?conversation=` deep
     * link that only the Query tab can display — so the initial auto-route to
     * Approvals never yanks them away from what they asked for.
     */
    const userPickedRef = useRef(isTabId(initialTab) || Boolean(initialConversationId));

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
                writeAiToolsSearchParam('tab', 'approvals');
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
     * so this both drives `activeTab` and rewrites the address in place (no
     * server round-trip) so the registered `?tab=` URLs become true deep links;
     * `page.tsx` reads that value SSR-first to seed the panel on next load. Only
     * the `tab` key is written, so the Query tab's `?conversation=` survives a
     * visit to another tab. Recording the pick also locks out the
     * pending-approval auto-route so it can never override the operator's choice.
     *
     * @param item - The clicked submenu node, carrying its `?tab=` url.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        userPickedRef.current = true;
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        writeAiToolsSearchParam('tab', tab);
    }, []);

    return (
        <AdminPage
            title="AI Tools"
            subtitle="The tools an AI model may call, their policies and audit trail, and a chat to run them."
            actions={pending > 0
                ? <Badge tone="warning">{pending} pending approval{pending === 1 ? '' : 's'}</Badge>
                : undefined}
        >
            <MenuNavClient
                namespace={SUBMENU_NAMESPACE}
                items={submenuTree}
                generatedAt={submenuGeneratedAt}
                ariaLabel="AI tool governance sections"
                activeUrl={`/system/ai-tools?tab=${activeTab}`}
                onItemSelect={handleTabSelect}
            />

            <div className={styles.content}>
                {/* Hidden rather than unmounted while another tab is open, so the
                    conversation and any in-flight stream survive the visit. */}
                <div hidden={activeTab !== 'query'}>
                    <QueryTab active={activeTab === 'query'} initialConversationId={initialConversationId} />
                </div>
                {activeTab === 'registry' && <RegistryTab onChanged={noop} />}
                {activeTab === 'activity' && <ActivityTab />}
                {activeTab === 'approvals' && <ApprovalsTab onChanged={refreshPending} />}
                {activeTab === 'schedules' && (
                    <SchedulerMonitor jobFilter={isAiToolsJob} title="AI Tools Schedules" hideStats />
                )}
                {/* Editing stays enabled, as on /system/database. Prefer the
                    Registry and Query tabs for ordinary work, because they go
                    through the module's services and keep its in-memory
                    registries in step with what is stored; treat this browser
                    as the escape hatch for a document those tabs cannot reach. */}
                {activeTab === 'database' && (
                    <CollectionBrowser prefix={COLLECTION_PREFIX} title="AI Tools Collections" />
                )}
                {activeTab === 'logs' && <SystemLogsMonitor service={LOG_SERVICE} title="AI Tools Logs" />}
            </div>
        </AdminPage>
    );
}
