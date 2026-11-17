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

import { useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import { RefreshCw, ArrowUpToLine, Save, RotateCcw, ArrowUp, ArrowDown } from 'lucide-react';
import type { MenuNodeSerialized } from '@/shared';
import type { IPriceHistoryStats, IPriceHistorySettings, IPriceCoverageDiagnostics, IPriceSourceInfo, IPriceAssetCoverage } from '@/types';
import { AdminPage, Stack } from '../../../../../../components/layout';
import { Panel } from '../../../../../../components/ui/Panel';
import { Field } from '../../../../../../components/ui/Field';
import { Input } from '../../../../../../components/ui/Input';
import { Switch } from '../../../../../../components/ui/Switch';
import { Button } from '../../../../../../components/ui/Button';
import { IconButton } from '../../../../../../components/ui/IconButton';
import { Badge, type BadgeTone } from '../../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { TronContractAddress } from '../../../../../../components/ui/TronContractAddress';
import { isValidTronAddress } from '../../../../../../lib/tronAddress';
import { StatTile, StatGrid } from '../../../../../../components/ui/StatTile';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../components/ui/Table';
import { useToast } from '../../../../../../components/ui/ToastProvider';
import { MenuNavClient } from '../../../../../../components/layout/MenuNav/MenuNavClient';
import { getSocket } from '../../../../../../lib/socketClient';
import { CollectionBrowser, ClickHouseTableBrowser } from '../../../../../../modules/database';
import { SchedulerMonitor, type SchedulerJob } from '../../../../../../modules/scheduler';
import { SystemLogsMonitor } from '../../../../../../modules/logs';
import {
    getStats,
    getDiagnostics,
    getSettings,
    getSources,
    updateSettings,
    resetAsset,
    runBackfill,
    runForward
} from '../../../../../../modules/price-history';
import styles from './page.module.scss';

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
 */
function renderAsset(asset: string) {
    return isValidTronAddress(asset) ? <TronContractAddress address={asset} /> : asset;
}

/**
 * Render the vendor handle behind an asset's latest fetch. GeckoTerminal's
 * handle is the SunSwap pool the price came from, which is itself a contract,
 * so it gets the contract chip. Any other handle is a vendor lookup key, not
 * an address, and is shown shortened and muted.
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
 * the order they are tried, each switched on and with move buttons; excluded
 * eligible vendors follow, switched off. A vendor the operator has disabled on
 * its configuration card is flagged beside its name, because the router will
 * skip it whatever its position.
 *
 * @param props - {@link ISourceOrderEditorProps}.
 * @returns The list as a titled panel.
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
        <Panel title={label} meta="Tried top to bottom; the first vendor with prices for a range wins.">
            <Table variant="compact" flush>
                <Thead>
                    <Tr>
                        <Th width="shrink">On</Th>
                        <Th width="expand">Vendor</Th>
                        <Th width="shrink">Order</Th>
                    </Tr>
                </Thead>
                <Tbody>
                    {included.map((source, index) => (
                        <Tr key={source.id}>
                            <Td>
                                <Switch
                                    on
                                    disabled={disabled}
                                    onChange={() => onChange(value.filter((id) => id !== source.id))}
                                    aria-label={`${label}: ${source.label}`}
                                />
                            </Td>
                            <Td>
                                <span className={styles.vendor}>
                                    {index + 1}. {source.label}
                                    {!source.enabled && <Badge tone="warning" size="xs">Disabled in providers</Badge>}
                                </span>
                            </Td>
                            <Td>
                                <span className={styles.order_buttons}>
                                    <IconButton onClick={() => move(index, -1)} disabled={disabled || index === 0} aria-label={`Move ${source.label} up`}>
                                        <ArrowUp size={18} />
                                    </IconButton>
                                    <IconButton onClick={() => move(index, 1)} disabled={disabled || index === included.length - 1} aria-label={`Move ${source.label} down`}>
                                        <ArrowDown size={18} />
                                    </IconButton>
                                </span>
                            </Td>
                        </Tr>
                    ))}
                    {excluded.map((source) => (
                        <Tr key={source.id}>
                            <Td>
                                <Switch
                                    on={false}
                                    disabled={disabled}
                                    onChange={() => onChange([...value, source.id])}
                                    aria-label={`${label}: ${source.label}`}
                                />
                            </Td>
                            <Td>
                                <span className={styles.vendor}>
                                    <span className="text-muted">{source.label}</span>
                                    {!source.enabled && <Badge tone="neutral" size="xs">Disabled in providers</Badge>}
                                </span>
                            </Td>
                            <Td />
                        </Tr>
                    ))}
                    {eligible.length === 0 && (
                        <Tr><Td colSpan={3}><span className="text-muted">No vendor can serve this asset class.</span></Td></Tr>
                    )}
                </Tbody>
            </Table>
        </Panel>
    );
}

/**
 * The states a tracked asset's backfill can be in. Named once so the status
 * badge and the Coverage tab's sort read the same classification and cannot
 * disagree about which rows are in trouble.
 */
type AssetStatus = 'vendor-errors' | 'unpriced' | 'paused' | 'backfilling' | 'queued' | 'complete';

/**
 * The order the Coverage tab lists assets in, most in need of the operator
 * first. The rows an operator opens the tab for were the last few of a long
 * table in discovery order, below every complete asset.
 */
const STATUS_ORDER: readonly AssetStatus[] = ['vendor-errors', 'unpriced', 'paused', 'backfilling', 'queued', 'complete'];

/**
 * Statuses whose asset is waiting out a retry hold. These are the rows that
 * show a retry time and that the Coverage panel counts as held back.
 */
const HELD_BACK: ReadonlySet<AssetStatus> = new Set(['vendor-errors', 'unpriced', 'paused']);

/** The badge each status renders as. */
const STATUS_BADGES: Readonly<Record<AssetStatus, { tone: BadgeTone; label: string }>> = {
    'vendor-errors': { tone: 'danger', label: 'Vendor errors' },
    unpriced: { tone: 'warning', label: 'Unpriced' },
    paused: { tone: 'warning', label: 'Backfill paused' },
    backfilling: { tone: 'info', label: 'Backfilling' },
    queued: { tone: 'neutral', label: 'Queued' },
    complete: { tone: 'success', label: 'Complete' }
};

/**
 * Classify one asset's coverage row. An asset whose last fetch failed with
 * vendor errors reads as failing in either phase, because the operator's next
 * step there is the vendor, not the asset. A parked asset reads by phase: an
 * unseeded asset no source could price, and a seeded asset whose deep walk
 * was left unanswered while a source in its routing order was switched off.
 * Without that second case an operator would read a paused walk as a running
 * one and wonder why coverage stopped.
 *
 * @param asset - The coverage row.
 * @returns The asset's status.
 */
function assetStatus(asset: IPriceAssetCoverage): AssetStatus {
    let status: AssetStatus;
    if (asset.backfillComplete) {
        status = 'complete';
    } else if (asset.failedAttempts > 0) {
        status = 'vendor-errors';
    } else if (asset.unpricedAttempts > 0) {
        status = asset.recentSeeded ? 'paused' : 'unpriced';
    } else {
        status = asset.recentSeeded ? 'backfilling' : 'queued';
    }
    return status;
}

/**
 * Order coverage rows by status, most in need of the operator first. The sort
 * is stable, so assets with the same status keep the order the service
 * reported them in, which is the order they were discovered.
 *
 * @param assets - The coverage rows as the stats snapshot lists them.
 * @returns A new array in display order.
 */
function sortByStatus(assets: readonly IPriceAssetCoverage[]): IPriceAssetCoverage[] {
    return [...assets].sort((a, b) => STATUS_ORDER.indexOf(assetStatus(a)) - STATUS_ORDER.indexOf(assetStatus(b)));
}

/**
 * Show a status badge followed by when the asset will next be tried, which is
 * what every held-back status needs so an operator can tell a waiting asset
 * from a stuck one.
 *
 * @param badge - The status badge to lead with.
 * @param nextAttemptAt - When the asset becomes due again, or null when unknown.
 * @returns The badge with its retry time, if there is one.
 */
function withRetryTime(badge: ReactNode, nextAttemptAt: string | null) {
    return (
        <span>
            {badge}{' '}
            {nextAttemptAt && (
                <span className="text-muted">retry after <ClientTime date={nextAttemptAt} format="short" /></span>
            )}
        </span>
    );
}

/**
 * Render the status badge for one asset's coverage row, with when it will next
 * be tried if it is held back.
 *
 * @param asset - The coverage row.
 * @returns The badge, with a retry time for a held-back asset.
 */
function statusBadge(asset: IPriceAssetCoverage) {
    const status = assetStatus(asset);
    const { tone, label } = STATUS_BADGES[status];
    const badge = <Badge tone={tone}>{label}</Badge>;
    return HELD_BACK.has(status) ? withRetryTime(badge, asset.nextAttemptAt) : badge;
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
     * The coverage rows in display order, held-back assets first, recomputed
     * only when a new stats snapshot arrives.
     */
    const sortedAssets = useMemo(() => (stats ? sortByStatus(stats.assets) : []), [stats]);

    /**
     * How many assets are held back. The Coverage panel's header states it so
     * the count reads as the rows at the top of the table rather than as a
     * figure with no rows behind it.
     */
    const heldBackCount = useMemo(
        () => sortedAssets.filter((asset) => HELD_BACK.has(assetStatus(asset))).length,
        [sortedAssets]
    );

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

    /** Drive the active panel from a tab click, deep-linking via the URL. */
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
        <AdminPage title="Price History" subtitle="Local daily USD price series for portfolio valuation">
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
                    {/* Trouble shows through the tile's tone on a plain number,
                        so the figures that signal a problem are no smaller
                        than the rest of the strip. */}
                    <StatGrid size="sm">
                        <StatTile
                            size="sm"
                            label="Tracked assets"
                            value={stats?.totals.assetCount ?? '—'}
                        />
                        <StatTile
                            size="sm"
                            label="Oldest day"
                            value={stats?.totals.oldestDay ?? '—'}
                        />
                        <StatTile
                            size="sm"
                            label="Newest day"
                            value={stats?.totals.newestDay ?? '—'}
                        />
                        <StatTile
                            size="sm"
                            label="Stale assets"
                            value={stats?.totals.staleAssets ?? '—'}
                            note="newest day behind yesterday"
                            tone={stats && stats.totals.staleAssets > 0 ? 'warning' : 'neutral'}
                        />
                        <StatTile
                            size="sm"
                            label="Provider errors"
                            value={stats ? stats.totals.providerErrors.toLocaleString() : '—'}
                            note={stats ? `of ${stats.totals.providerCalls.toLocaleString()} calls since boot` : undefined}
                            tone={stats && stats.totals.providerErrors > 0 ? 'danger' : 'neutral'}
                        />
                    </StatGrid>

                    <Panel
                        title="Coverage"
                        meta={!stats
                            ? 'Loading…'
                            : `${stats.assets.length.toLocaleString()} assets${heldBackCount > 0 ? `, ${heldBackCount} held back and listed first` : ''}`}
                        actions={(
                            <>
                                <Button variant="secondary" icon={<RefreshCw size={18} aria-hidden />} loading={busy === 'backfill'} disabled={!!busy} onClick={() => runAction('backfill', 'Backfill started', runBackfill)}>
                                    Run backfill
                                </Button>
                                <Button variant="secondary" icon={<ArrowUpToLine size={18} aria-hidden />} loading={busy === 'forward'} disabled={!!busy} onClick={() => runAction('forward', 'Forward sync started', runForward)}>
                                    Run forward sync
                                </Button>
                            </>
                        )}
                    >
                        {/* About 690px wide at its narrowest, so it fits a
                            tablet and stacks each asset into an entry headed
                            by its name only below that. */}
                        <Table variant="compact" flush stackAt="mobile">
                            <Thead>
                                <Tr>
                                    <Th>Asset</Th>
                                    <Th width="shrink">Source</Th>
                                    <Th width="shrink" numeric>Days</Th>
                                    <Th width="shrink">Range</Th>
                                    <Th width="shrink" numeric>Days left</Th>
                                    <Th width="expand">Status</Th>
                                    <Th width="shrink">Reset</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {sortedAssets.length === 0 ? (
                                    <Tr>
                                        <Td colSpan={7}><span className="text-muted">No assets tracked yet — TRX is added on the first backfill tick.</span></Td>
                                    </Tr>
                                ) : (
                                    sortedAssets.map((asset) => (
                                        <Tr key={asset.asset}>
                                            <Td>{renderAsset(asset.asset)}</Td>
                                            <Td label="Source">
                                                {asset.source ?? '—'}
                                                {asset.sourceRef && (
                                                    <>{' '}{renderSourceRef(asset.sourceRef)}</>
                                                )}
                                            </Td>
                                            <Td label="Days" numeric>{asset.dayCount.toLocaleString()}</Td>
                                            <Td label="Range">
                                                {asset.oldestDay && asset.newestDay ? `${asset.oldestDay} → ${asset.newestDay}` : '—'}
                                            </Td>
                                            <Td label="Days left" numeric>
                                                {asset.estimatedDaysRemaining === null ? '—' : asset.estimatedDaysRemaining.toLocaleString()}
                                            </Td>
                                            <Td label="Status">{statusBadge(asset)}</Td>
                                            {/* No label: the reset icon sits at the end of a stacked entry's last line. */}
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
                    </Panel>
                </Stack>
            )}

            {activeTab === 'diagnostics' && (
                <Panel
                    title="Unpriced token contracts"
                    meta={diagnostics
                        ? `${diagnostics.heldTokenCount.toLocaleString()} held · ${diagnostics.pricedTokenCount.toLocaleString()} priced · ${diagnostics.unpricedTokens.length.toLocaleString()} unpriced, excluded from USD totals`
                        : 'Loading…'}
                >
                    {diagnostics && diagnostics.unpricedTokens.length === 0 && (
                        <span className="text-muted">All held tokens have local price coverage.</span>
                    )}
                    {diagnostics && diagnostics.unpricedTokens.length > 0 && (
                        <ul className={styles.chip_grid}>
                            {diagnostics.unpricedTokens.map((asset) => (
                                <li key={asset}>{renderAsset(asset)}</li>
                            ))}
                        </ul>
                    )}
                </Panel>
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
                    <Panel
                        title="Ingestion"
                        meta="Saves the pacing and both vendor orders. Vendor credentials are edited on the System page's Configuration tab."
                        actions={(
                            <Button variant="primary" icon={<Save size={18} aria-hidden />} loading={busy === 'save'} disabled={!draft || !!busy} onClick={saveSettings}>
                                Save settings
                            </Button>
                        )}
                    >
                        <Stack gap="md">
                            <Field inline label="Ingestion enabled" hint="Off parks all price ingestion. Cursors and stored prices are kept.">
                                <Switch
                                    on={draft?.ingestionEnabled ?? false}
                                    disabled={!draft || !!busy}
                                    onChange={(next) => setDraft((current) => (current ? { ...current, ingestionEnabled: next } : current))}
                                    aria-label="Ingestion enabled"
                                />
                            </Field>
                            <div className={styles.field_grid}>
                                <Field label="Chunk days" hint="Days fetched by one deep-backfill request, 1 to 1000. Each tick moves one asset back by one chunk.">
                                    <Input
                                        type="number"
                                        min={1}
                                        max={1000}
                                        value={draft?.chunkDays ?? 0}
                                        disabled={!draft || !!busy}
                                        onChange={(event) => setDraft((current) => (current ? { ...current, chunkDays: Number(event.target.value) } : current))}
                                    />
                                </Field>
                                <Field label="Tokens seeded per tick" hint="The most tracked tokens given their first price fetch on each tick.">
                                    <Input
                                        type="number"
                                        min={1}
                                        value={draft?.tokensPerTick ?? 0}
                                        disabled={!draft || !!busy}
                                        onChange={(event) => setDraft((current) => (current ? { ...current, tokensPerTick: Number(event.target.value) } : current))}
                                    />
                                </Field>
                            </div>
                        </Stack>
                    </Panel>

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
                </Stack>
            )}
        </AdminPage>
    );
}
