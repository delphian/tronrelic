'use client';

/**
 * @fileoverview /system/ai-tools — the AI tool governance dashboard.
 *
 * Five tabs (Query — the default — then Registry, Activity, Approvals,
 * Curation) plus a lethal-trifecta banner and a live pending-approval count on
 * the Approvals tab. Per-tool policy editing is not its own tab — each Registry
 * tool row expands to its policy editor — so this shell carries no Policy tab.
 * Admin-gated by the /system layout; like the other system pages it is a client
 * component that fetches over the cookie-authenticated admin API. Governed
 * events arrive as WebSocket refetch signals — the data itself always comes from
 * the gated REST feed, never a global broadcast.
 */

import { useEffect, useState, useCallback } from 'react';
import type { ITrifectaStatus } from '@/types';
import { Page, PageHeader } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { getSocket } from '../../../../lib/socketClient';
import { getTrifecta, getApprovalsCount, getCurationsCount } from '../../../../modules/ai-tools';
import { TrifectaPanel } from './components/TrifectaPanel';
import { RegistryTab } from './tabs/RegistryTab';
import { ActivityTab } from './tabs/ActivityTab';
import { ApprovalsTab } from './tabs/ApprovalsTab';
import { CurationTab } from './tabs/CurationTab';
import { QueryTab } from './tabs/QueryTab';
import styles from './page.module.scss';

/** The dashboard tabs. */
type TabId = 'registry' | 'query' | 'activity' | 'approvals' | 'curation';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
    { id: 'query', label: 'Query' },
    { id: 'registry', label: 'Registry' },
    { id: 'activity', label: 'Activity' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'curation', label: 'Curation' }
];

/**
 * AI tool governance dashboard page.
 *
 * @returns The page.
 */
export default function AiToolsAdminPage() {
    const [activeTab, setActiveTab] = useState<TabId>('query');
    const [trifecta, setTrifecta] = useState<ITrifectaStatus | null>(null);
    const [pending, setPending] = useState(0);
    const [pendingCuration, setPendingCuration] = useState(0);

    const refreshTrifecta = useCallback(async () => {
        try {
            setTrifecta(await getTrifecta());
        } catch {
            /* secondary data — leave the banner absent on failure */
        }
    }, []);

    const refreshPending = useCallback(async () => {
        try {
            setPending(await getApprovalsCount());
        } catch {
            /* secondary data — leave the count as-is on failure */
        }
    }, []);

    const refreshPendingCuration = useCallback(async () => {
        try {
            setPendingCuration(await getCurationsCount());
        } catch {
            /* secondary data — leave the count as-is on failure */
        }
    }, []);

    useEffect(() => {
        void refreshTrifecta();
        void refreshPending();
        void refreshPendingCuration();
    }, [refreshTrifecta, refreshPending, refreshPendingCuration]);

    // Keep both pending badges live regardless of which tab is open.
    useEffect(() => {
        const socket = getSocket();
        const onApprovals = () => { void refreshPending(); };
        const onCurations = () => { void refreshPendingCuration(); };
        socket.on('ai-tools:approvals-changed', onApprovals);
        socket.on('ai-tools:curations-changed', onCurations);
        return () => {
            socket.off('ai-tools:approvals-changed', onApprovals);
            socket.off('ai-tools:curations-changed', onCurations);
        };
    }, [refreshPending, refreshPendingCuration]);

    return (
        <Page>
            <PageHeader title="AI Tools" subtitle="Govern every tool an AI agent can invoke — registry, activity, approvals, and per-tool policy." />
            <div className={styles.container}>
                {trifecta && <TrifectaPanel status={trifecta} />}

                <div className={styles.tabs} role="tablist" aria-label="AI tool governance sections">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            className={activeTab === tab.id ? styles.tab__active : styles.tab}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                            {tab.id === 'approvals' && pending > 0 && (
                                <> <Badge tone="warning">{pending}</Badge></>
                            )}
                            {tab.id === 'curation' && pendingCuration > 0 && (
                                <> <Badge tone="warning">{pendingCuration}</Badge></>
                            )}
                        </button>
                    ))}
                </div>

                <div className={styles.content}>
                    {activeTab === 'registry' && <RegistryTab onChanged={refreshTrifecta} />}
                    {activeTab === 'query' && <QueryTab />}
                    {activeTab === 'activity' && <ActivityTab />}
                    {activeTab === 'approvals' && <ApprovalsTab onChanged={refreshPending} />}
                    {activeTab === 'curation' && <CurationTab onChanged={refreshPendingCuration} />}
                </div>
            </div>
        </Page>
    );
}
