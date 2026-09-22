'use client';

/**
 * @fileoverview Client shell for /system/price-history.
 *
 * The price series is otherwise invisible, so this surface answers the operator's
 * questions: is each asset's backfill seeded and complete, which vendor is
 * pricing it, how fresh is the series, which vendors are tried in which order
 * for TRX and for tokens, and the pacing dials to throttle if a vendor
 * rate-limits — plus manual backfill/forward triggers and a per-asset reset to
 * re-seed a token after a new source is configured. The tab row is the menu
 * module's Submenu Pattern (a namespaced menu rendered with `MenuNavClient`),
 * fed SSR-first by `page.tsx`. Stats refetch on mount, after each action, and
 * on the `price-history:stats` nudge each ingestion tick emits.
 *
 * The Schedules, Database, and Logs panels are core components scoped to this
 * module rather than anything written for this page. Every component with an
 * admin page surfaces its own jobs, storage, and log entries there, and reusing
 * the core components means the authority behind each tab is the one
 * `/system/scheduler`, `/system/database`, and `/system/logs` use.
 */

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ArrowUpToLine, Save, RotateCcw, ArrowUp, ArrowDown } from 'lucide-react';
import type { MenuNodeSerialized } from '@/shared';
import type { IPriceHistoryStats, IPriceHistorySettings, IPriceCoverageDiagnostics, IPriceSourceInfo, IPriceAssetCoverage } from '@/types';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { IconButton } from '../../../../components/ui/IconButton';
import { Badge } from '../../../../components/ui/Badge';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { TronContractAddress } from '../../../../components/ui/TronContractAddress';
import { isValidTronAddress } from '../../../../lib/tronAddress';
import { StatTile, StatGrid } from '../../../../components/ui/StatTile';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { useToast } from '../../../../components/ui/ToastProvider';
import { MenuNavClient } from '../../../../components/layout/MenuNav/MenuNavClient';
import { getSocket } from '../../../../lib/socketClient';
import { CollectionBrowser, ClickHouseTableBrowser } from '../../../../modules/database';
import { SchedulerMonitor, type SchedulerJob } from '../../../../modules/scheduler';
import { SystemLogsMonitor } from '../../../../modules/logs';
import {
    getStats,
    getDiagnostics,
    getSettings,
    getSources,
    updateSettings,
    resetAsset,
    runBackfill,
    runForward
} from '../../../../modules/price-history';

/** The page's tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'coverage' | 'diagnostics' | 'schedules' | 'database' | 'logs' | 'settings';

/** The menu namespace the module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'price-history';

/**
 * Name prefix shared by every scheduler job the module registers.
 *
 * The Schedules tab filters on the prefix rather than listing job names, so a
 * job the module adds later appears here without a matching edit to this file.
 * The literal is repeated from `PriceHistoryModule.ts` because frontend code
 * cannot import backend code; the module's lifecycle test asserts every
 * registered job name starts with it, which keeps the two copies in step.
 */
const JOB_PREFIX = 'price-history:';

/**
 * Physical MongoDB collection prefix covering the module's settings and
 * per-asset cursor collections. Scoping the browser to it keeps the panel on
 * this module's storage instead of the whole deployment's inventory.
 */
const COLLECTION_PREFIX = 'module_price-history_';

/**
 * The ClickHouse tables this module owns, holding the price series itself.
 * Module tables share no naming prefix, so the browser is scoped by exact
 * name. The literal is repeated from `PRICE_TABLE` in the module's
 * `database/index.ts` because frontend code cannot import backend code; the
 * module's lifecycle test pins that constant to this value.
 */
const CLICKHOUSE_TABLES = ['price_history'];

/**
 * The service name this module's log entries are stored under. The logs module
 * derives it from the `module: 'price-history'` binding on the module's child
 * logger, producing `tronrelic:<module id>`, so scoping the viewer to it shows
 * every entry the module and its vendor adapters write.
 */
const LOG_SERVICE = 'tronrelic:price-history';

/**
 * Type guard narrowing an arbitrary `?tab=` string to a known TabId, so the
 * deep-link seeding and click routing share one list of valid tabs.
 *
 * @param tab - The raw `?tab=` value.
 * @returns True when the value names a real tab.
 */
function isTabId(tab: string | undefined): tab is TabId {
    return tab === 'coverage'
        || tab === 'diagnostics'
        || tab === 'schedules'
        || tab === 'database'
        || tab === 'logs'
        || tab === 'settings';
}

/**
 * Select this module's scheduler jobs for the Schedules tab. A predicate
 * rather than a fixed list of names, so the tab keeps showing every job the
 * module owns when another one is added.
 *
 * @param job - A job row supplied by the scheduler monitor.
 * @returns True when the job belongs to this module.
 */
function isPriceHistoryJob(job: SchedulerJob): boolean {
    return job.name.startsWith(JOB_PREFIX);
}

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
 * Resolve a submenu node's `?tab=` value to a known TabId, defaulting to
 * `coverage` for an unrecognized or missing value so a malformed node can never
 * leave the page on a blank panel.
 *
 * @param url - The clicked node's URL, such as `/system/price-history?tab=logs`.
 * @returns The matching tab id.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'coverage';
}

/**
 * Shorten a vendor handle that is not an address, such as CoinGecko's
 * `tron/contract/<address>` path, so the row stays readable; the full value is
 * in the cell's title. A handle that is an address renders through
 * `TronContractAddress` instead and never reaches this.
 *
 * @param ref - The handle.
 * @returns The shortened handle.
 */
function shortRef(ref: string): string {
    return ref.length > 14 ? `${ref.slice(0, 6)}…${ref.slice(-4)}` : ref;
}

/**
 * Render a price asset's identifier. A token asset is its TRC20 contract
 * address, so it gets the standard contract chip, with copy, the Tronscan
 * contract link, and the admin tag editor. TRX is the native coin and has no
 * contract, so it stays plain text. The checksum test decides which is which
 * instead of comparing against `'TRX'`, so a malformed stored value never
 * renders as a contract link that leads nowhere.
 *
 * @param asset - The stored asset id: `'TRX'` or a token contract address.
 * @returns The contract chip for a token, or the plain id otherwise.
 */
function renderAsset(asset: string) {
    return isValidTronAddress(asset) ? <TronContractAddress address={asset} /> : asset;
}

/**
 * Render the vendor handle behind an asset's latest fetch. GeckoTerminal's
 * handle is the SunSwap pool the price came from, which is itself a contract,
 * so it gets the contract chip. Any other handle is a vendor lookup key, not
 * an address, and is shown shortened and muted.
 *
 * @param ref - The `sourceRef` stored on the asset's cursor.
 * @returns The contract chip for a pool address, or the shortened key otherwise.
 */
function renderSourceRef(ref: string) {
    return isValidTronAddress(ref)
        ? <TronContractAddress address={ref} />
        : <span className="text-muted" title={ref}>{shortRef(ref)}</span>;
}

/** Props for one ordered source list in the settings form. */
interface ISourceOrderEditorProps {
    /** Which asset class this list routes. */
    label: string;
    /** Every vendor that can serve the class, in registration order. */
    eligible: IPriceSourceInfo[];
    /** The current ordered vendor ids. */
    value: string[];
    /** Whether the controls are disabled. */
    disabled: boolean;
    /** Called with the new ordered list. */
    onChange: (next: string[]) => void;
}

/**
 * Edit one asset class's ordered vendor list. Included vendors appear first in
 * the order they are tried, each with move buttons; excluded eligible vendors
 * follow, unchecked. A vendor the operator has disabled on its configuration
 * card is flagged, because the router will skip it whatever its position.
 *
 * @param props - {@link ISourceOrderEditorProps}.
 * @returns The list.
 */
function SourceOrderEditor({ label, eligible, value, disabled, onChange }: ISourceOrderEditorProps) {
    const included = value.map((id) => eligible.find((source) => source.id === id)).filter((source): source is IPriceSourceInfo => !!source);
    const excluded = eligible.filter((source) => !value.includes(source.id));

    /**
     * Swap a vendor with its neighbour in the included list. Positions are
     * resolved back to `value` by id, because `value` may carry a registered
     * vendor that is not eligible for this class and so does not appear in
     * `included`; indexing `value` directly would then swap the wrong entries.
     *
     * @param index - Position in the included list.
     * @param delta - -1 to move up, +1 to move down.
     */
    const move = (index: number, delta: number): void => {
        const target = index + delta;
        if (target < 0 || target >= included.length) {
            return;
        }
        const next = [...value];
        const from = next.indexOf(included[index].id);
        const to = next.indexOf(included[target].id);
        [next[from], next[to]] = [next[to], next[from]];
        onChange(next);
    };

    return (
        <Card padding="sm" noBackgroundImage>
            <Stack gap="sm">
                <strong>{label}</strong>
                <span className="text-muted">Tried top to bottom; the first vendor with prices for a range wins.</span>
                <Table variant="compact" flush>
                    <Tbody>
                        {included.map((source, index) => (
                            <Tr key={source.id}>
                                <Td>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked
                                            disabled={disabled}
                                            onChange={() => onChange(value.filter((id) => id !== source.id))}
                                        />{' '}
                                        {index + 1}. {source.label}
                                    </label>
                                </Td>
                                <Td>{!source.enabled && <Badge tone="warning">Disabled in providers</Badge>}</Td>
                                <Td>
                                    <IconButton onClick={() => move(index, -1)} disabled={disabled || index === 0} aria-label={`Move ${source.label} up`}>
                                        <ArrowUp size={18} />
                                    </IconButton>
                                    <IconButton onClick={() => move(index, 1)} disabled={disabled || index === included.length - 1} aria-label={`Move ${source.label} down`}>
                                        <ArrowDown size={18} />
                                    </IconButton>
                                </Td>
                            </Tr>
                        ))}
                        {excluded.map((source) => (
                            <Tr key={source.id}>
                                <Td>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={false}
                                            disabled={disabled}
                                            onChange={() => onChange([...value, source.id])}
                                        />{' '}
                                        <span className="text-muted">{source.label}</span>
                                    </label>
                                </Td>
                                <Td>{!source.enabled && <Badge tone="neutral">Disabled in providers</Badge>}</Td>
                                <Td />
                            </Tr>
                        ))}
                        {eligible.length === 0 && (
                            <Tr><Td colSpan={3}><span className="text-muted">No vendor can serve this asset class.</span></Td></Tr>
                        )}
                    </Tbody>
                </Table>
            </Stack>
        </Card>
    );
}

/**
 * Render the status badge for one asset's coverage row. A parked asset shows
 * when it will next be tried, in both phases: an unseeded asset no source could
 * price, and a seeded asset whose deep walk was left unanswered while a source
 * in its routing order was switched off. Without the second case an operator
 * would read a paused walk as a running one and wonder why coverage stopped.
 *
 * @param asset - The coverage row.
 * @returns The badge, with a retry time for a parked asset.
 */
function statusBadge(asset: IPriceAssetCoverage) {
    if (asset.backfillComplete) {
        return <Badge tone="success">Complete</Badge>;
    }
    const parked = asset.unpricedAttempts > 0;
    if (asset.recentSeeded) {
        return parked
            ? (
                <span>
                    <Badge tone="warning">Backfill paused</Badge>{' '}
                    {asset.nextAttemptAt && (
                        <span className="text-muted">retry after <ClientTime date={asset.nextAttemptAt} format="short" /></span>
                    )}
                </span>
            )
            : <Badge tone="info">Backfilling</Badge>;
    }
    if (parked) {
        return (
            <span>
                <Badge tone="warning">Unpriced</Badge>{' '}
                {asset.nextAttemptAt && (
                    <span className="text-muted">retry after <ClientTime date={asset.nextAttemptAt} format="short" /></span>
                )}
            </span>
        );
    }
    return <Badge tone="neutral">Queued</Badge>;
}

/**
 * The admin shell for the price-history coverage and settings surface.
 *
 * @param props - {@link IPriceHistoryAdminClientProps}.
 * @returns The page.
 */
export function PriceHistoryAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: IPriceHistoryAdminClientProps) {
    const { push } = useToast();
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'coverage');
    const [stats, setStats] = useState<IPriceHistoryStats | null>(null);
    const [diagnostics, setDiagnostics] = useState<IPriceCoverageDiagnostics | null>(null);
    const [sources, setSources] = useState<IPriceSourceInfo[] | null>(null);
    const [draft, setDraft] = useState<IPriceHistorySettings | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    /**
     * Refetch the coverage snapshot, and seed the settings draft from it only
     * while no draft exists yet. This runs on every `price-history:stats`
     * nudge, which each five-minute ingestion tick emits, so overwriting an
     * existing draft here would throw away the operator's unsaved edits on the
     * Settings tab mid-edit. The Settings tab refreshes the draft itself when
     * it opens, and a save replaces it with what the server stored.
     */
    const loadStats = useCallback(async (): Promise<void> => {
        try {
            const next = await getStats();
            setStats(next);
            setDraft((current) => current ?? next.settings);
        } catch (error) {
            push({ tone: 'danger', title: error instanceof Error ? error.message : 'Failed to load stats' });
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

    // Lazily load the vendor list and a fresh settings copy when the settings
    // tab opens, so the routing form reflects a vendor enabled moments ago.
    useEffect(() => {
        if (activeTab !== 'settings') {
            return;
        }
        Promise.all([getSources(), getSettings()])
            .then(([list, settings]) => {
                setSources(list);
                setDraft(settings);
            })
            .catch((error) => push({ tone: 'danger', title: error instanceof Error ? error.message : 'Failed to load price sources' }));
    }, [activeTab, push]);

    /**
     * Drive the active panel from a tab click, deep-linking via the URL.
     *
     * @param item - The selected submenu node.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized): void => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/price-history?tab=${tab}`);
    }, []);

    /**
     * Run a bounded action and refresh on success.
     *
     * @param key - Busy key discriminator.
     * @param label - Toast label on success.
     * @param action - The api call to run.
     */
    const runAction = useCallback(
        async (key: string, label: string, action: () => Promise<void>): Promise<void> => {
            setBusy(key);
            try {
                await action();
                push({ tone: 'success', title: label });
                await loadStats();
            } catch (error) {
                push({ tone: 'danger', title: error instanceof Error ? error.message : 'Action failed' });
            } finally {
                setBusy(null);
            }
        },
        [push, loadStats]
    );

    /**
     * Persist the settings draft.
     */
    const saveSettings = useCallback(async (): Promise<void> => {
        if (!draft) {
            return;
        }
        setBusy('save');
        try {
            const saved = await updateSettings(draft);
            setDraft(saved);
            push({ tone: 'success', title: 'Settings saved' });
            await loadStats();
        } catch (error) {
            push({ tone: 'danger', title: error instanceof Error ? error.message : 'Failed to save settings' });
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
                    <StatGrid>
                        <StatTile
                            label="Tracked assets"
                            value={stats?.totals.assetCount ?? '—'}
                        />
                        <StatTile
                            label="Oldest day"
                            value={stats?.totals.oldestDay ?? '—'}
                        />
                        <StatTile
                            label="Newest day"
                            value={stats?.totals.newestDay ?? '—'}
                        />
                        <StatTile
                            label="Stale assets"
                            value={!stats ? '—' : stats.totals.staleAssets > 0 ? <Badge tone="warning">{stats.totals.staleAssets}</Badge> : 0}
                        />
                        <StatTile
                            label="Provider errors"
                            value={!stats
                                    ? '—'
                                    : stats.totals.providerErrors > 0
                                        ? <Badge tone="danger">{stats.totals.providerErrors} / {stats.totals.providerCalls} calls</Badge>
                                        : `0 / ${stats.totals.providerCalls} calls`}
                        />
                    </StatGrid>

                    <Stack direction="horizontal" gap="sm">
                        <Button variant="secondary" size="sm" icon={<RefreshCw size={18} aria-hidden />} loading={busy === 'backfill'} disabled={!!busy} onClick={() => runAction('backfill', 'Backfill started', runBackfill)}>
                            Run backfill
                        </Button>
                        <Button variant="secondary" size="sm" icon={<ArrowUpToLine size={18} aria-hidden />} loading={busy === 'forward'} disabled={!!busy} onClick={() => runAction('forward', 'Forward sync started', runForward)}>
                            Run forward sync
                        </Button>
                    </Stack>

                    <Card padding="md">
                        <Table variant="compact" flush>
                            <Thead>
                                <Tr>
                                    <Th>Asset</Th>
                                    <Th>Source</Th>
                                    <Th numeric>Days</Th>
                                    <Th>Oldest</Th>
                                    <Th>Newest</Th>
                                    <Th numeric>Days left</Th>
                                    <Th>Status</Th>
                                    <Th>Actions</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {!stats || stats.assets.length === 0 ? (
                                    <Tr>
                                        <Td colSpan={8}><span className="text-muted">No assets tracked yet — TRX is added on the first backfill tick.</span></Td>
                                    </Tr>
                                ) : (
                                    stats.assets.map((asset) => (
                                        <Tr key={asset.asset}>
                                            <Td>{renderAsset(asset.asset)}</Td>
                                            <Td>
                                                {asset.source ?? '—'}
                                                {asset.sourceRef && (
                                                    <>{' '}{renderSourceRef(asset.sourceRef)}</>
                                                )}
                                            </Td>
                                            <Td numeric>{asset.dayCount.toLocaleString()}</Td>
                                            <Td>{asset.oldestDay ?? '—'}</Td>
                                            <Td>{asset.newestDay ?? '—'}</Td>
                                            <Td numeric>
                                                {asset.estimatedDaysRemaining === null ? '—' : asset.estimatedDaysRemaining.toLocaleString()}
                                            </Td>
                                            <Td>{statusBadge(asset)}</Td>
                                            <Td>
                                                <IconButton
                                                    onClick={() => runAction(`reset:${asset.asset}`, `${asset.asset} reset; it re-seeds on the next tick`, () => resetAsset(asset.asset))}
                                                    disabled={!!busy}
                                                    aria-label={`Reset ${asset.asset} backfill cursor`}
                                                    title="Reset cursor and re-seed through the current sources"
                                                >
                                                    <RotateCcw size={18} />
                                                </IconButton>
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
                    <StatGrid>
                        <StatTile
                            label="Held tokens"
                            value={diagnostics?.heldTokenCount ?? '—'}
                        />
                        <StatTile
                            label="Priced"
                            value={diagnostics?.pricedTokenCount ?? '—'}
                        />
                        <StatTile
                            label="Unpriced"
                            value={!diagnostics ? '—' : diagnostics.unpricedTokens.length > 0 ? <Badge tone="warning">{diagnostics.unpricedTokens.length}</Badge> : 0}
                        />
                    </StatGrid>
                    <Card padding="md">
                        {!diagnostics ? (
                            <span className="text-muted">Loading…</span>
                        ) : diagnostics.unpricedTokens.length === 0 ? (
                            <span className="text-muted">All held tokens have local price coverage.</span>
                        ) : (
                            <Table variant="compact" flush>
                                <Thead>
                                    <Tr><Th>Unpriced token contract (excluded from USD totals)</Th></Tr>
                                </Thead>
                                <Tbody>
                                    {diagnostics.unpricedTokens.map((asset) => (
                                        <Tr key={asset}><Td>{renderAsset(asset)}</Td></Tr>
                                    ))}
                                </Tbody>
                            </Table>
                        )}
                    </Card>
                </Stack>
            )}

            {activeTab === 'schedules' && (
                <SchedulerMonitor
                    jobFilter={isPriceHistoryJob}
                    title="Price History Schedules"
                    hideStats
                />
            )}

            {/* Editing and deletion stay enabled on the MongoDB browser, as on
              * every Database tab. Prefer the Coverage tab's per-asset reset
              * for re-queuing an asset, because it goes through the service;
              * treat this browser as the escape hatch for a cursor or settings
              * document that surface cannot reach. The ClickHouse browser is
              * read-only by design. */}
            {activeTab === 'database' && (
                <Stack gap="lg">
                    <CollectionBrowser
                        prefix={COLLECTION_PREFIX}
                        title="Price History Collections"
                    />
                    <ClickHouseTableBrowser
                        tables={CLICKHOUSE_TABLES}
                        title="Price History Tables"
                    />
                </Stack>
            )}

            {activeTab === 'logs' && (
                <SystemLogsMonitor service={LOG_SERVICE} />
            )}

            {activeTab === 'settings' && (
                <Stack gap="md">
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
                                Chunk days (one deep-backfill range request per tick)
                                <input
                                    type="number"
                                    min={1}
                                    max={1000}
                                    value={draft?.chunkDays ?? 0}
                                    disabled={!draft || !!busy}
                                    onChange={(event) => setDraft((current) => (current ? { ...current, chunkDays: Number(event.target.value) } : current))}
                                />
                            </label>
                            <label>
                                Tokens seeded per tick
                                <input
                                    type="number"
                                    min={1}
                                    value={draft?.tokensPerTick ?? 0}
                                    disabled={!draft || !!busy}
                                    onChange={(event) => setDraft((current) => (current ? { ...current, tokensPerTick: Number(event.target.value) } : current))}
                                />
                            </label>
                        </Stack>
                    </Card>

                    <SourceOrderEditor
                        label="TRX price sources"
                        eligible={(sources ?? []).filter((source) => source.supportsTrx)}
                        value={draft?.trxSources ?? []}
                        disabled={!draft || !sources || !!busy}
                        onChange={(next) => setDraft((current) => (current ? { ...current, trxSources: next } : current))}
                    />
                    <SourceOrderEditor
                        label="Token price sources"
                        eligible={(sources ?? []).filter((source) => source.supportsTokens)}
                        value={draft?.tokenSources ?? []}
                        disabled={!draft || !sources || !!busy}
                        onChange={(next) => setDraft((current) => (current ? { ...current, tokenSources: next } : current))}
                    />
                    <span className="text-muted">Vendor credentials and base URLs are edited on the System page&apos;s Configuration tab.</span>

                    <Stack direction="horizontal" gap="sm">
                        <Button variant="primary" size="sm" icon={<Save size={18} aria-hidden />} loading={busy === 'save'} disabled={!draft || !!busy} onClick={saveSettings}>
                            Save settings
                        </Button>
                    </Stack>
                </Stack>
            )}
        </Page>
    );
}
