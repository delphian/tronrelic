'use client';

/**
 * @fileoverview Client shell for /system/price-history.
 *
 * The price series is otherwise invisible, so this surface answers the operator's
 * questions: is each asset's backfill seeded and complete, how fresh is the
 * series, and the pacing dials to throttle if CoinGecko rate-limits — plus manual
 * backfill/forward triggers to price a newly tracked token without waiting for
 * cron. The tab row is the menu module's Submenu Pattern (a namespaced menu
 * rendered with `MenuNavClient`), fed SSR-first by `page.tsx`. Stats refetch on
 * mount and after each action (no WebSocket nudge; the data changes slowly).
 */

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ArrowUpToLine, Save } from 'lucide-react';
import type { MenuNodeSerialized } from '@/shared';
import type { IPriceHistoryStats, IPriceHistorySettings, IPriceCoverageDiagnostics } from '@/types';
import { Page, PageHeader, Stack, Grid } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { useToast } from '../../../../components/ui/ToastProvider';
import { MenuNavClient } from '../../../../components/layout/MenuNav/MenuNavClient';
import { getSocket } from '../../../../lib/socketClient';
import { getStats, getDiagnostics, getSettings, updateSettings, runBackfill, runForward } from '../../../../modules/price-history';

/** The page's tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'coverage' | 'diagnostics' | 'settings';

/** The menu namespace the module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'price-history';

/**
 * Props for the client shell.
 */
interface IPriceHistoryAdminClientProps {
    /** SSR-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree. */
    submenuGeneratedAt: string;
    /** The `?tab=` deep link from the request URL; unknown values resolve to `coverage`. */
    initialTab?: string;
}

/**
 * Resolve a tab id from a submenu node URL's `?tab=` param.
 *
 * @param url - The node URL.
 * @returns The tab id, defaulting to `coverage`.
 */
function tabFromUrl(url: string): TabId {
    if (url.includes('tab=settings')) {
        return 'settings';
    }
    if (url.includes('tab=diagnostics')) {
        return 'diagnostics';
    }
    return 'coverage';
}

/**
 * The admin shell for the price-history coverage and settings surface.
 *
 * @param props - {@link IPriceHistoryAdminClientProps}.
 * @returns The page.
 */
export function PriceHistoryAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: IPriceHistoryAdminClientProps) {
    const { push } = useToast();
    const [activeTab, setActiveTab] = useState<TabId>(tabFromUrl(`tab=${initialTab ?? ''}`));
    const [stats, setStats] = useState<IPriceHistoryStats | null>(null);
    const [diagnostics, setDiagnostics] = useState<IPriceCoverageDiagnostics | null>(null);
    const [draft, setDraft] = useState<IPriceHistorySettings | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    /**
     * Refetch the coverage snapshot and seed the settings draft from it.
     */
    const loadStats = useCallback(async (): Promise<void> => {
        try {
            const next = await getStats();
            setStats(next);
            setDraft(next.settings);
        } catch (error) {
            push({ tone: 'danger', title:error instanceof Error ? error.message : 'Failed to load stats' });
        }
    }, [push]);

    useEffect(() => {
        void loadStats();
    }, [loadStats]);

    // After hydration, refetch coverage whenever an ingestion tick nudges. The
    // signal is timestamp-only; the snapshot is read over the requireAdmin feed.
    useEffect(() => {
        const socket = getSocket();
        const onStats = (): void => {
            void loadStats();
        };
        socket.on('price-history:stats', onStats);
        return () => {
            socket.off('price-history:stats', onStats);
        };
    }, [loadStats]);

    // Lazily load coverage diagnostics when the tab opens (it runs a DISTINCT over
    // the snapshot tokens, so it is not fetched until needed).
    useEffect(() => {
        if (activeTab !== 'diagnostics') {
            return;
        }
        getDiagnostics()
            .then(setDiagnostics)
            .catch((error) => push({ tone: 'danger', title: error instanceof Error ? error.message : 'Failed to load diagnostics' }));
    }, [activeTab, push]);

    /**
     * Drive the active panel from a tab click, deep-linking via the URL.
     *
     * @param item - The selected submenu node.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized): void => {
        const tab = tabFromUrl(item.url ?? '');
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/price-history?tab=${tab}`);
    }, []);

    /**
     * Run a bounded action (backfill / forward) and refresh on success.
     *
     * @param key - Busy key + label discriminator.
     * @param action - The api call to run.
     */
    const runAction = useCallback(
        async (key: string, action: () => Promise<void>): Promise<void> => {
            setBusy(key);
            try {
                await action();
                push({ tone: 'success', title:`${key === 'backfill' ? 'Backfill' : 'Forward sync'} started` });
                await loadStats();
            } catch (error) {
                push({ tone: 'danger', title:error instanceof Error ? error.message : 'Action failed' });
            } finally {
                setBusy(null);
            }
        },
        [push, loadStats]
    );

    /**
     * Persist the pacing settings draft.
     */
    const saveSettings = useCallback(async (): Promise<void> => {
        if (!draft) {
            return;
        }
        setBusy('save');
        try {
            const saved = await updateSettings(draft);
            setDraft(saved);
            push({ tone: 'success', title:'Settings saved' });
            await loadStats();
        } catch (error) {
            push({ tone: 'danger', title:error instanceof Error ? error.message : 'Failed to save settings' });
        } finally {
            setBusy(null);
        }
    }, [draft, push, loadStats]);

    return (
        <Page>
            <PageHeader title="Price History" subtitle="Local daily USD price series for portfolio valuation" />

            <MenuNavClient
                namespace={SUBMENU_NAMESPACE}
                items={submenuTree}
                generatedAt={submenuGeneratedAt}
                ariaLabel="Price history sections"
                activeUrl={`/system/price-history?tab=${activeTab}`}
                onItemSelect={handleTabSelect}
            />

            {activeTab === 'coverage' && (
                <Stack gap="md">
                    <Grid columns="responsive" gap="md">
                        <Card padding="md">
                            <div className="stat-card__label">Tracked assets</div>
                            <div className="stat-card__value">{stats?.totals.assetCount ?? '—'}</div>
                        </Card>
                        <Card padding="md">
                            <div className="stat-card__label">Oldest day</div>
                            <div className="stat-card__value">{stats?.totals.oldestDay ?? '—'}</div>
                        </Card>
                        <Card padding="md">
                            <div className="stat-card__label">Newest day</div>
                            <div className="stat-card__value">{stats?.totals.newestDay ?? '—'}</div>
                        </Card>
                        <Card padding="md">
                            <div className="stat-card__label">Stale assets</div>
                            <div className="stat-card__value">
                                {!stats ? '—' : stats.totals.staleAssets > 0 ? <Badge tone="warning">{stats.totals.staleAssets}</Badge> : 0}
                            </div>
                        </Card>
                    </Grid>

                    <Stack direction="horizontal" gap="sm">
                        <Button variant="secondary" size="sm" icon={<RefreshCw size={18} aria-hidden />} loading={busy === 'backfill'} disabled={!!busy} onClick={() => runAction('backfill', runBackfill)}>
                            Run backfill
                        </Button>
                        <Button variant="secondary" size="sm" icon={<ArrowUpToLine size={18} aria-hidden />} loading={busy === 'forward'} disabled={!!busy} onClick={() => runAction('forward', runForward)}>
                            Run forward sync
                        </Button>
                    </Stack>

                    <Card padding="md">
                        <Table variant="compact">
                            <Thead>
                                <Tr>
                                    <Th>Asset</Th>
                                    <Th align="right">Days</Th>
                                    <Th>Oldest</Th>
                                    <Th>Newest</Th>
                                    <Th>Status</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {!stats || stats.assets.length === 0 ? (
                                    <Tr>
                                        <Td colSpan={5}><span className="text-muted">No assets tracked yet — TRX is added on the first backfill tick.</span></Td>
                                    </Tr>
                                ) : (
                                    stats.assets.map((asset) => (
                                        <Tr key={asset.asset}>
                                            <Td>{asset.asset}</Td>
                                            <Td align="right">{asset.dayCount.toLocaleString()}</Td>
                                            <Td>{asset.oldestDay ?? '—'}</Td>
                                            <Td>{asset.newestDay ?? '—'}</Td>
                                            <Td>
                                                {asset.backfillComplete ? (
                                                    <Badge tone="success">Complete</Badge>
                                                ) : asset.recentSeeded ? (
                                                    <Badge tone="info">Backfilling</Badge>
                                                ) : (
                                                    <Badge tone="warning">Queued</Badge>
                                                )}
                                            </Td>
                                        </Tr>
                                    ))
                                )}
                            </Tbody>
                        </Table>
                    </Card>
                </Stack>
            )}

            {activeTab === 'diagnostics' && (
                <Stack gap="md">
                    <Grid columns="responsive" gap="md">
                        <Card padding="md">
                            <div className="stat-card__label">Held tokens</div>
                            <div className="stat-card__value">{diagnostics?.heldTokenCount ?? '—'}</div>
                        </Card>
                        <Card padding="md">
                            <div className="stat-card__label">Priced</div>
                            <div className="stat-card__value">{diagnostics?.pricedTokenCount ?? '—'}</div>
                        </Card>
                        <Card padding="md">
                            <div className="stat-card__label">Unpriced</div>
                            <div className="stat-card__value">
                                {!diagnostics ? '—' : diagnostics.unpricedTokens.length > 0 ? <Badge tone="warning">{diagnostics.unpricedTokens.length}</Badge> : 0}
                            </div>
                        </Card>
                    </Grid>
                    <Card padding="md">
                        {!diagnostics ? (
                            <span className="text-muted">Loading…</span>
                        ) : diagnostics.unpricedTokens.length === 0 ? (
                            <span className="text-muted">All held tokens have local price coverage.</span>
                        ) : (
                            <Table variant="compact">
                                <Thead>
                                    <Tr><Th>Unpriced token contract (excluded from USD totals)</Th></Tr>
                                </Thead>
                                <Tbody>
                                    {diagnostics.unpricedTokens.map((asset) => (
                                        <Tr key={asset}><Td>{asset}</Td></Tr>
                                    ))}
                                </Tbody>
                            </Table>
                        )}
                    </Card>
                </Stack>
            )}

            {activeTab === 'settings' && (
                <Card padding="md">
                    <Stack gap="md">
                        <label>
                            <input
                                type="checkbox"
                                checked={draft?.ingestionEnabled ?? false}
                                disabled={!draft || !!busy}
                                onChange={(event) => setDraft((current) => (current ? { ...current, ingestionEnabled: event.target.checked } : current))}
                            />{' '}
                            Ingestion enabled
                        </label>
                        <label>
                            Days per tick (deep-backfill calls)
                            <input
                                type="number"
                                min={1}
                                value={draft?.daysPerTick ?? 0}
                                disabled={!draft || !!busy}
                                onChange={(event) => setDraft((current) => (current ? { ...current, daysPerTick: Number(event.target.value) } : current))}
                            />
                        </label>
                        <label>
                            Tokens per tick
                            <input
                                type="number"
                                min={1}
                                value={draft?.tokensPerTick ?? 0}
                                disabled={!draft || !!busy}
                                onChange={(event) => setDraft((current) => (current ? { ...current, tokensPerTick: Number(event.target.value) } : current))}
                            />
                        </label>
                        <Stack direction="horizontal" gap="sm">
                            <Button variant="primary" size="sm" icon={<Save size={18} aria-hidden />} loading={busy === 'save'} disabled={!draft || !!busy} onClick={saveSettings}>
                                Save settings
                            </Button>
                        </Stack>
                    </Stack>
                </Card>
            )}
        </Page>
    );
}
