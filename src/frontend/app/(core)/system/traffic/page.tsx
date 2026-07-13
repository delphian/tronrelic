'use client';

import { useEffect, useMemo, useState } from 'react';
import { Radio } from 'lucide-react';
import {
    AnalyticsDashboard,
    VisitorsExplorer,
    CrawlerDashboard,
    TrafficDashboard,
    GscKeywords,
    GscSettings,
    IgnoredUsers,
    PeriodPicker,
    toDateInputValue,
    useAutoRefresh
} from '../../../../modules/traffic';
import type { VisitorsView } from '../../../../modules/traffic';
import { adminGetLiveVisitors } from '../../../../modules/traffic/api';
import type { AnalyticsPeriod, ICustomDateRange } from '../../../../modules/traffic/api';
import styles from './page.module.scss';

/** Tab identifiers for the traffic admin page. */
type TrafficTab = 'analytics' | 'visitors' | 'crawlers' | 'seo' | 'settings';

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
 * pressure. The Visitors explorer and SEO tabs are intentionally excluded —
 * the former holds pagination/drill-down state a refresh would disrupt, the
 * latter serves daily, multi-day-lagged data that cannot change within a tick.
 */
const DASHBOARD_REFRESH_MS = 60_000;

/**
 * System traffic administration page with tabbed interface.
 *
 * Hosts the traffic module's analytics dashboards, carved out of
 * /system/users to mirror the backend identity/traffic split:
 * - Analytics: aggregate reporting — KPI strip + unified trend, sources,
 *   engagement, funnel, geo/device breakdowns
 * - Visitors: the individual-entity explorer — a subject selector switches
 *   between New visitors (first touches, bot-filterable), Anonymous (tid)
 *   page activity, and Registered (user_id) page activity
 * - Crawlers: Bot-class trend, per-bot-class paths, and the bot/geo/path
 *   breakdowns with the bot_other classifier-gap feedback loop
 * - SEO: Google Search Console keywords (clicks/impressions/CTR/position)
 * - Settings: GSC credential configuration
 *
 * Visitors and Pages were formerly two tabs; both rendered row-per-subject
 * tables with a drill-down, so they were merged into one explorer behind a
 * subject selector — aggregate reporting (Analytics) stays a separate mode
 * from row-level exploration (Visitors), the GA4 Reports-vs-Explore divide.
 *
 * One global period picker governs the Analytics and Visitors tabs so an
 * admin never unknowingly compares different windows. The bot filter reaches
 * Analytics and the Visitors tab's New-visitors view only — the activity
 * views read `page` events that non-JS crawlers never emit, so it is inert
 * there and hidden. Crawlers keeps its own `sinceHours` windows (capped at
 * 30d server-side) and SEO its delay-shifted GSC windows. A live "visitors
 * now" counter (last 5 minutes, polled every 30s) sits beside the tabs.
 *
 * Follows the simpler button-tab pattern from /system/pages (no ARIA
 * tablist/tab/tabpanel roles to avoid incomplete implementation).
 */
export default function SystemTrafficPage() {
    const [activeTab, setActiveTab] = useState<TrafficTab>('analytics');
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
    const dashboardRefresh = useAutoRefresh(DASHBOARD_REFRESH_MS);

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
            <div className={styles.tabs}>
                <button
                    type="button"
                    className={activeTab === 'analytics' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('analytics')}
                >
                    Analytics
                </button>
                <button
                    type="button"
                    className={activeTab === 'visitors' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('visitors')}
                >
                    Visitors
                </button>
                <button
                    type="button"
                    className={activeTab === 'crawlers' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('crawlers')}
                >
                    Crawlers
                </button>
                <button
                    type="button"
                    className={activeTab === 'seo' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('seo')}
                >
                    SEO
                </button>
                <button
                    type="button"
                    className={activeTab === 'settings' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('settings')}
                >
                    Settings
                </button>
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
