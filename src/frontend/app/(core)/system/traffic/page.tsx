'use client';

import { useState } from 'react';
import {
    AnalyticsDashboard,
    VisitorAnalytics,
    PageActivity,
    CrawlerDashboard,
    TrafficDashboard,
    GscKeywords,
    GscSettings
} from '../../../../modules/traffic';
import styles from './page.module.scss';

/** Tab identifiers for the traffic admin page. */
type TrafficTab = 'analytics' | 'visitors' | 'pages' | 'crawlers' | 'seo' | 'settings';

/**
 * System traffic administration page with tabbed interface.
 *
 * Hosts the traffic module's analytics dashboards, carved out of
 * /system/users to mirror the backend identity/traffic split:
 * - Analytics: Aggregate traffic sources, engagement, conversion funnel
 * - Visitors: Daily visitors and anonymous first touches (incl. bots)
 * - Pages: Anonymous (tid) and registered (user_id) per-page clickstreams
 * - Crawlers: Bot-class trend, per-bot-class paths, and the bot/geo/path
 *   breakdowns with the bot_other classifier-gap feedback loop
 * - SEO: Google Search Console keywords (clicks/impressions/CTR/position)
 * - Settings: GSC credential configuration
 *
 * Follows the simpler button-tab pattern from /system/pages (no ARIA
 * tablist/tab/tabpanel roles to avoid incomplete implementation).
 */
export default function SystemTrafficPage() {
    const [activeTab, setActiveTab] = useState<TrafficTab>('analytics');

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
            </div>

            <div className={styles.content}>
                {activeTab === 'analytics' && <AnalyticsDashboard />}
                {activeTab === 'visitors' && <VisitorAnalytics />}
                {activeTab === 'pages' && <PageActivity />}
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
