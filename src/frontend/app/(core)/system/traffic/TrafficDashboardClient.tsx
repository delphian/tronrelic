'use client';

/**
 * @fileoverview Client shell for /system/traffic.
 *
 * Holds the interactive dashboard surface: the in-page tab row, the global
 * period + bot-filter controls, the live "visitors now" counter, and the six
 * tab panels (analytics, visitors, crawlers, SEO, redirects, settings). The tab
 * row is the menu module's Submenu Pattern — a namespaced menu rendered with
 * `MenuNavClient`, not a hand-rolled button array — so it inherits per-user
 * gating, ordering, and live `menu:update` refresh, and a plugin could
 * contribute a tab. The server entry (`page.tsx`) fetches that namespace tree
 * SSR-first and passes it in; clicking a tab drives local state via
 * `onItemSelect` rather than navigating, and `activeUrl` highlights the active
 * tab since the route is identical across them.
 *
 * One global period picker governs the Analytics and Visitors tabs so an admin
 * never unknowingly compares different windows. The bot filter reaches Analytics
 * and the Visitors tab's New-visitors view only. Crawlers keeps its own
 * `sinceHours` windows and SEO its delay-shifted GSC windows. The Redirects tab
 * manages admin-curated legacy-URL 301/302 rules and is ungoverned by the period
 * controls.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Radio } from 'lucide-react';
import type { MenuNodeSerialized } from '@/shared';
import { MenuNavClient } from '../../../../components/layout/MenuNav/MenuNavClient';
import {
    AnalyticsDashboard,
    VisitorsExplorer,
    CrawlerDashboard,
    TrafficDashboard,
    GscKeywords,
    GscSettings,
    IgnoredUsers,
    RedirectsManager,
    PeriodPicker,
    toDateInputValue,
    useAutoRefresh
} from '../../../../modules/traffic';
import type { VisitorsView } from '../../../../modules/traffic';
import { adminGetLiveVisitors } from '../../../../modules/traffic/api';
import type { AnalyticsPeriod, ICustomDateRange } from '../../../../modules/traffic/api';
import styles from './page.module.scss';

/** Tab identifiers for the traffic admin page. */
type TrafficTab = 'analytics' | 'visitors' | 'crawlers' | 'seo' | 'redirects' | 'settings';

/** The menu namespace TrafficModule registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'traffic';

/** Tabs governed by the global period picker. */
const GOVERNED_TABS: ReadonlySet<TrafficTab> = new Set(['analytics', 'visitors']);

/** Subject views selectable within the Visitors tab, in display order. */
const VISITOR_VIEWS: ReadonlyArray<{ id: VisitorsView; label: string; title: string }> = [
    { id: 'new', label: 'New visitors', title: 'New visitors first seen in this window — first-touch acquisition (referrer, landing page, UTM). Bot filter applies here.' },
    { id: 'anonymous', label: 'Anonymous', title: 'Per-page activity for cookied anonymous visitors, keyed on the traffic id. Expand a row for their full clickstream.' },
    { id: 'registered', label: 'Registered', title: 'Per-page activity for signed-in accounts, keyed on the Better Auth user id. Expand a row for their full clickstream.' }
];

/** Polling interval for the live-visitor counter (ms). */
const LIVE_POLL_MS = 30_000;

/**
 * Auto-refresh cadence for the aggregate dashboards (ms). Slower than the live
 * counter: these are heavier ClickHouse aggregations and their numbers move on
 * a coarser timescale, so a minute keeps them current without adding query
 * pressure. The Visitors explorer, SEO, and Redirects tabs are intentionally
 * excluded — the first holds pagination/drill-down state a refresh would
 * disrupt, SEO serves daily multi-day-lagged data, and Redirects is static
 * config edited on demand.
 */
const DASHBOARD_REFRESH_MS = 60_000;

/**
 * Narrow an arbitrary `?tab=` string to a known TrafficTab, so deep-link seeding
 * and click routing share one source of truth for valid tabs.
 *
 * @param tab - The raw `?tab=` value.
 * @returns True when the value names a real tab.
 */
function isTrafficTab(tab: string | undefined): tab is TrafficTab {
    return tab === 'analytics' || tab === 'visitors' || tab === 'crawlers'
        || tab === 'seo' || tab === 'redirects' || tab === 'settings';
}

/**
 * Resolve a submenu node's `?tab=` value to a known TrafficTab, defaulting to
 * `analytics` for an unrecognized or missing value so a malformed node can never
 * leave the page on a blank panel.
 *
 * @param url - The clicked node's url (e.g. `/system/traffic?tab=redirects`).
 * @returns The matching tab id.
 */
function tabFromUrl(url: string | undefined): TrafficTab {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTrafficTab(tab) ? tab : 'analytics';
}

/**
 * Props for the traffic dashboard client shell.
 */
interface ITrafficDashboardClientProps {
    /** SSR-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree, seeded onto the menu Redux slice. */
    submenuGeneratedAt: string;
    /**
     * The `?tab=` value from the request URL, read SSR-first in `page.tsx` so a
     * refreshed, bookmarked, or shared deep link opens on the right panel. An
     * unknown or absent value resolves to `analytics`.
     */
    initialTab?: string;
}

/**
 * System traffic administration dashboard (client shell).
 *
 * @param props - SSR submenu tree, its timestamp, and the deep-linked initial tab.
 * @returns The tabbed dashboard.
 */
export function TrafficDashboardClient({ submenuTree, submenuGeneratedAt, initialTab }: ITrafficDashboardClientProps) {
    const [activeTab, setActiveTab] = useState<TrafficTab>(isTrafficTab(initialTab) ? initialTab : 'analytics');
    // The subject view within the Visitors tab. Defaults to New visitors —
    // the acquisition view that matches the old Visitors tab's landing state.
    const [visitorsView, setVisitorsView] = useState<VisitorsView>('new');

    // Global window + bot filter for the governed tabs. Defaults to the last
    // 24 hours — the most-actionable recent window — which also makes the
    // overview trend bucket hourly (≤ 48h) rather than daily.
    const [period, setPeriod] = useState<AnalyticsPeriod>('24h');
    const [customStart, setCustomStart] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return toDateInputValue(d);
    });
    const [customEnd, setCustomEnd] = useState(() => toDateInputValue(new Date()));
    const [includeBots, setIncludeBots] = useState(false);

    // Live visitors (last 5 minutes), polled while the page is open.
    const [liveVisitors, setLiveVisitors] = useState<number | null>(null);

    // Shared refresh clock for the aggregate dashboards. Ticking here (once, at
    // the page level) and threading the signal down as a prop keeps a single
    // timer driving every aggregate surface instead of each panel owning its
    // own; it pauses while the tab is hidden.
    const dashboardRefresh = useAutoRefresh(
        DASHBOARD_REFRESH_MS,
        activeTab === 'analytics' || activeTab === 'crawlers'
    );

    /**
     * Memoized custom date range built from the date input values.
     * Aligns to localized midnight: start at 00:00:00 of start date,
     * end at 23:59:59.999 of end date. Dates are constructed with the
     * multi-argument constructor (offset-less string parsing is
     * engine-dependent) and inverted ranges return undefined — the
     * backend would otherwise silently serve its default window while
     * the UI displays the custom dates. Undefined unless period is
     * 'custom' with two valid, ordered dates.
     */
    const customRange = useMemo<ICustomDateRange | undefined>(() => {
        if (period !== 'custom' || !customStart || !customEnd) return undefined;
        const [startY, startM, startD] = customStart.split('-').map(Number);
        const [endY, endM, endD] = customEnd.split('-').map(Number);
        const start = new Date(startY, startM - 1, startD, 0, 0, 0, 0);
        const end = new Date(endY, endM - 1, endD, 23, 59, 59, 999);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || start.getTime() > end.getTime()) return undefined;
        return { startDate: start.toISOString(), endDate: end.toISOString() };
    }, [period, customStart, customEnd]);

    /**
     * Activate the clicked tab and keep its URL a real deep link.
     *
     * `MenuNavClient` suppresses the <Link> navigation when `onItemSelect` is set
     * (it preventDefaults the click), so this rewrites the address in place with
     * `history.replaceState` — no server round-trip — so the registered `?tab=`
     * URLs become true deep links that `page.tsx` reads SSR-first on next load.
     *
     * @param item - The clicked submenu node, carrying its `?tab=` url.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/traffic?tab=${tab}`);
    }, []);

    useEffect(() => {
        let active = true;
        /**
         * Refresh the live counter, dropping the result after unmount.
         */
        const poll = async (): Promise<void> => {
            try {
                const { visitors } = await adminGetLiveVisitors(!includeBots);
                if (active) setLiveVisitors(visitors);
            } catch {
                if (active) setLiveVisitors(null);
            }
        };
        poll();
        const timer = setInterval(poll, LIVE_POLL_MS);
        return () => { active = false; clearInterval(timer); };
    }, [includeBots]);

    const showGlobalControls = GOVERNED_TABS.has(activeTab);
    // The bot filter is meaningful for aggregate analytics and for the
    // Visitors tab's New-visitors (first-touch) view — first touches include
    // cookieless bots. The activity views read only `page` events, which
    // non-JS crawlers never emit, so the toggle would be inert; hide it there.
    const showBotToggle = activeTab === 'analytics'
        || (activeTab === 'visitors' && visitorsView === 'new');

    return (
        <div className={styles.container}>
            <div className={styles.tab_row}>
                <div className={styles.submenu}>
                    <MenuNavClient
                        namespace={SUBMENU_NAMESPACE}
                        items={submenuTree}
                        generatedAt={submenuGeneratedAt}
                        ariaLabel="Traffic sections"
                        activeUrl={`/system/traffic?tab=${activeTab}`}
                        onItemSelect={handleTabSelect}
                    />
                </div>
                {liveVisitors !== null && (
                    <span className={styles.live} title="Distinct visitors in the last 5 minutes">
                        <Radio size={14} aria-hidden="true" />
                        {liveVisitors.toLocaleString()} online now
                    </span>
                )}
            </div>

            {showGlobalControls && (
                <div className={styles.global_controls}>
                    <div className={styles.control_group}>
                        <PeriodPicker
                            period={period}
                            onPeriodChange={setPeriod}
                            customStart={customStart}
                            customEnd={customEnd}
                            onCustomStartChange={setCustomStart}
                            onCustomEndChange={setCustomEnd}
                        />
                        {activeTab === 'visitors' && (
                            <div className={styles.subject_toggle} role="group" aria-label="Visitor view">
                                {VISITOR_VIEWS.map(v => (
                                    <button
                                        key={v.id}
                                        type="button"
                                        className={visitorsView === v.id ? styles.subject_btn__active : styles.subject_btn}
                                        onClick={() => setVisitorsView(v.id)}
                                        aria-pressed={visitorsView === v.id}
                                        title={v.title}
                                    >
                                        {v.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {showBotToggle && (
                        <div className={styles.bot_toggle} role="group" aria-label="Bot traffic filter">
                            <button
                                type="button"
                                className={!includeBots ? styles.bot_btn__active : styles.bot_btn}
                                onClick={() => setIncludeBots(false)}
                                aria-pressed={!includeBots}
                                title="Counts only visitors that loaded a page (ran JavaScript) and were not classified as bots. Cookieless bots that never run JS are already excluded from every visitor number; unclassified rows are kept, so JS-running bots that spoof a browser may remain."
                            >
                                Exclude known bots
                            </button>
                            <button
                                type="button"
                                className={includeBots ? styles.bot_btn__active : styles.bot_btn}
                                onClick={() => setIncludeBots(true)}
                                aria-pressed={includeBots}
                                title="Also counts JavaScript-running bots the classifier caught (headless scrapers). Cookieless bots that never run JS stay excluded regardless — a visitor must have loaded a page."
                            >
                                Include bots
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div className={styles.content}>
                {activeTab === 'analytics' && (
                    <AnalyticsDashboard period={period} customRange={customRange} includeBots={includeBots} refreshSignal={dashboardRefresh} />
                )}
                {activeTab === 'visitors' && (
                    <VisitorsExplorer
                        view={visitorsView}
                        period={period}
                        customRange={customRange}
                        includeBots={includeBots}
                    />
                )}
                {activeTab === 'crawlers' && (
                    <div className={styles.crawler_stack}>
                        <CrawlerDashboard refreshSignal={dashboardRefresh} />
                        <TrafficDashboard refreshSignal={dashboardRefresh} />
                    </div>
                )}
                {activeTab === 'seo' && <GscKeywords />}
                {activeTab === 'redirects' && <RedirectsManager />}
                {activeTab === 'settings' && (
                    <div className={styles.settings_stack}>
                        <IgnoredUsers />
                        <GscSettings />
                    </div>
                )}
            </div>
        </div>
    );
}
