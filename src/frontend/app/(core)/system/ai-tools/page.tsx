'use client';

/**
 * @fileoverview /system/ai-tools — the AI tool governance dashboard.
 *
 * Four tabs (Query — the default — then Registry, Activity, Approvals) plus a
 * lethal-trifecta banner and a live pending-approval count on the Approvals tab.
 * When holds are already waiting on first load the shell opens on Approvals
 * instead of Query, so the operator lands on the decision that needs them. The
 * trifecta banner renders a degraded state on load failure rather than vanishing
 * — an absent security signal must never read as "safe". Curation moved to its
 * own surface at /system/curation. Per-tool policy editing is not its own tab —
 * the Registry slide-over carries it — so this shell has no Policy tab.
 * Admin-gated by the /system layout; like the other system pages it is a client
 * component that fetches over the cookie-authenticated admin API. Governed events
 * arrive as WebSocket refetch signals — the data itself always comes from the
 * gated REST feed, never a global broadcast.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ITrifectaStatus } from '@/types';
import { Page, PageHeader } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { getSocket } from '../../../../lib/socketClient';
import { getTrifecta, getApprovalsCount } from '../../../../modules/ai-tools';
import { TrifectaPanel } from './components/TrifectaPanel';
import { RegistryTab } from './tabs/RegistryTab';
import { ActivityTab } from './tabs/ActivityTab';
import { ApprovalsTab } from './tabs/ApprovalsTab';
import { QueryTab } from './tabs/QueryTab';
import styles from './page.module.scss';

/** The dashboard tabs. */
type TabId = 'registry' | 'query' | 'activity' | 'approvals';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
    { id: 'query', label: 'Query' },
    { id: 'registry', label: 'Registry' },
    { id: 'activity', label: 'Activity' },
    { id: 'approvals', label: 'Approvals' }
];

/**
 * AI tool governance dashboard page.
 *
 * @returns The page.
 */
export default function AiToolsAdminPage() {
    const [activeTab, setActiveTab] = useState<TabId>('query');
    const [trifecta, setTrifecta] = useState<ITrifectaStatus | null>(null);
    const [trifectaError, setTrifectaError] = useState(false);
    const [pending, setPending] = useState(0);
    /** True once the initial pending fetch has auto-routed, so it fires at most once. */
    const autoRoutedRef = useRef(false);
    /** True once the operator picks a tab, so auto-routing never yanks them away. */
    const userPickedRef = useRef(false);

    const refreshTrifecta = useCallback(async () => {
        try {
            setTrifecta(await getTrifecta());
            setTrifectaError(false);
        } catch {
            // Surface an explicit degraded banner — a missing trifecta signal
            // must not be mistaken for a clean one.
            setTrifectaError(true);
        }
    }, []);

    const refreshPending = useCallback(async (): Promise<number | null> => {
        try {
            const count = await getApprovalsCount();
            setPending(count);
            return count;
        } catch {
            return null;
        }
    }, []);

    // On first load, evaluate the trifecta and, if holds are already waiting,
    // open on Approvals rather than the default Query — unless the operator has
    // already chosen a tab.
    useEffect(() => {
        void refreshTrifecta();
        void (async () => {
            const count = await refreshPending();
            if (count && count > 0 && !autoRoutedRef.current && !userPickedRef.current) {
                autoRoutedRef.current = true;
                setActiveTab('approvals');
            }
        })();
    }, [refreshTrifecta, refreshPending]);

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
     * Select a tab and record that the operator drove the choice, so the initial
     * auto-route to Approvals cannot later override their pick.
     *
     * @param id - The tab to open.
     */
    const pickTab = useCallback((id: TabId) => {
        userPickedRef.current = true;
        setActiveTab(id);
    }, []);

    return (
        <Page>
            <PageHeader title="AI Tools" subtitle="Govern every tool an AI agent can invoke — registry, activity, approvals, and per-tool policy." />
            <div className={styles.container}>
                {trifecta
                    ? <TrifectaPanel status={trifecta} />
                    : trifectaError && (
                        <div className={styles.trifecta_degraded} role="status">
                            <AlertTriangle size={16} aria-hidden="true" />
                            Trifecta status unavailable — the enabled tool set could not be evaluated. Retry from any tab action.
                        </div>
                    )}

                <div className={styles.tabs} role="tablist" aria-label="AI tool governance sections">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            className={activeTab === tab.id ? styles.tab__active : styles.tab}
                            onClick={() => pickTab(tab.id)}
                        >
                            {tab.label}
                            {tab.id === 'approvals' && pending > 0 && (
                                <> <Badge tone="warning">{pending}</Badge></>
                            )}
                        </button>
                    ))}
                </div>

                <div className={styles.content}>
                    {activeTab === 'registry' && <RegistryTab onChanged={refreshTrifecta} />}
                    {activeTab === 'query' && <QueryTab />}
                    {activeTab === 'activity' && <ActivityTab />}
                    {activeTab === 'approvals' && <ApprovalsTab onChanged={refreshPending} />}
                </div>
            </div>
        </Page>
    );
}
