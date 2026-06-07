'use client';

import { useEffect, useMemo, useState } from 'react';
import { Radio } from 'lucide-react';
import {
    AnalyticsDashboard,
    VisitorAnalytics,
    PageActivity,
    CrawlerDashboard,
    TrafficDashboard,
    GscKeywords,
    GscSettings,
    PeriodPicker,
    toDateInputValue
} from '../../../../modules/traffic';
import { adminGetLiveVisitors } from '../../../../modules/traffic/api';
import type { AnalyticsPeriod, ICustomDateRange } from '../../../../modules/traffic/api';
import styles from './page.module.scss';

/** Tab identifiers for the traffic admin page. */
type TrafficTab = 'analytics' | 'visitors' | 'pages' | 'crawlers' | 'seo' | 'settings';

/** Tabs governed by the global period picker and bot filter. */
const GOVERNED_TABS: ReadonlySet<TrafficTab> = new Set(['analytics', 'visitors', 'pages']);

/** Polling interval for the live-visitor counter (ms). */
const LIVE_POLL_MS = 30_000;

/**
 * System traffic administration page with tabbed interface.
 *
 * Hosts the traffic module's analytics dashboards, carved out of
 * /system/users to mirror the backend identity/traffic split:
 * - Analytics: KPI strip + unified trend, sources, engagement, funnel
 * - Visitors: New-visitor first touches (bots filterable)
 * - Pages: Anonymous (tid) and registered (user_id) per-page clickstreams
 * - Crawlers: Bot-class trend, per-bot-class paths, and the bot/geo/path
 *   breakdowns with the bot_other classifier-gap feedback loop
 * - SEO: Google Search Console keywords (clicks/impressions/CTR/position)
 * - Settings: GSC credential configuration
 *
 * One global period picker + bot filter governs the Analytics, Visitors,
 * and Pages tabs so an admin never unknowingly compares different windows.
 * Crawlers keeps its own `sinceHours` windows (capped at 30d server-side)
 * and SEO its delay-shifted GSC windows. A live "visitors now" counter
 * (last 5 minutes, polled every 30s) sits beside the tabs.
 *
 * Follows the simpler button-tab pattern from /system/pages (no ARIA
 * tablist/tab/tabpanel roles to avoid incomplete implementation).
 */
export default function SystemTrafficPage() {
    const [activeTab, setActiveTab] = useState<TrafficTab>('analytics');

    // Global window + bot filter for the governed tabs.
    const [period, setPeriod] = useState<AnalyticsPeriod>('30d');
    const [customStart, setCustomStart] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return toDateInputValue(d);
    });
    const [customEnd, setCustomEnd] = useState(() => toDateInputValue(new Date()));
    const [includeBots, setIncludeBots] = useState(false);

    // Live visitors (last 5 minutes), polled while the page is open.
    const [liveVisitors, setLiveVisitors] = useState<number | null>(null);

    /**
     * Memoized custom date range built from the date input values.
     * Aligns to localized midnight: start at 00:00:00 of start date,
     * end at 23:59:59.999 of end date. Undefined unless period is
     * 'custom' with two valid dates.
     */
    const customRange = useMemo<ICustomDateRange | undefined>(() => {
        if (period !== 'custom' || !customStart || !customEnd) return undefined;
        const start = new Date(`${customStart}T00:00:00`);
        const end = new Date(`${customEnd}T23:59:59.999`);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return undefined;
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
                    className={activeTab === 'pages' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('pages')}
                >
                    Pages
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
                    <PeriodPicker
                        period={period}
                        onPeriodChange={setPeriod}
                        customStart={customStart}
                        customEnd={customEnd}
                        onCustomStartChange={setCustomStart}
                        onCustomEndChange={setCustomEnd}
                    />
                    <div className={styles.bot_toggle} role="group" aria-label="Bot traffic filter">
                        <button
                            type="button"
                            className={!includeBots ? styles.bot_btn__active : styles.bot_btn}
                            onClick={() => setIncludeBots(false)}
                            aria-pressed={!includeBots}
                        >
                            Humans only
                        </button>
                        <button
                            type="button"
                            className={includeBots ? styles.bot_btn__active : styles.bot_btn}
                            onClick={() => setIncludeBots(true)}
                            aria-pressed={includeBots}
                        >
                            Include bots
                        </button>
                    </div>
                </div>
            )}

            <div className={styles.content}>
                {activeTab === 'analytics' && (
                    <AnalyticsDashboard period={period} customRange={customRange} includeBots={includeBots} />
                )}
                {activeTab === 'visitors' && (
                    <VisitorAnalytics period={period} customRange={customRange} includeBots={includeBots} />
                )}
                {activeTab === 'pages' && (
                    <PageActivity period={period} customRange={customRange} />
                )}
                {activeTab === 'crawlers' && (
                    <div className={styles.crawler_stack}>
                        <CrawlerDashboard />
                        <TrafficDashboard />
                    </div>
                )}
                {activeTab === 'seo' && <GscKeywords />}
                {activeTab === 'settings' && <GscSettings />}
            </div>
        </div>
    );
}
