'use client';

import { useEffect, useState } from 'react';
import { config as runtimeConfig } from '@/lib/config';
import styles from './MarketMonitor.module.css';

interface MarketPlatform {
    guid: string;
    name: string;
    lastFetchedAt: string | null;
    status: 'online' | 'stale' | 'failed' | 'disabled';
    responseTime: number | null;
    reliabilityScore: number;
    consecutiveFailures: number;
    isActive: boolean;
}

interface MarketFreshness {
    oldestDataAge: number | null;
    stalePlatformCount: number;
    averageDataAge: number;
    platformsWithOldData: string[];
}

interface Props {
    token: string;
}

/**
 * MarketMonitor Component
 *
 * Admin diagnostic tool for monitoring market data freshness and platform health.
 * Tracks data staleness, platform status, response times, and reliability scores.
 *
 * **Key Features:**
 * - Real-time platform status tracking (online/stale/failed/disabled)
 * - Data freshness metrics (average age, oldest data, stale platform count)
 * - Platform reliability scores and consecutive failure tracking
 * - Manual refresh controls (normal and force refresh)
 * - Auto-refresh every 10 seconds for near-real-time monitoring
 * - Warning alerts for platforms with data older than 1 hour
 *
 * **Data Sources:**
 * - `/admin/system/markets/platforms` - Platform status and reliability metrics
 * - `/admin/system/markets/freshness` - Data age and staleness tracking
 * - `/admin/system/markets/refresh` - Manual refresh trigger (POST)
 *
 * **Security:**
 * Requires admin token authentication via X-Admin-Token header.
 *
 * @param {Props} props - Component props
 * @param {string} props.token - Admin authentication token for API requests
 *
 * @example
 * ```tsx
 * <MarketMonitor token={adminToken} />
 * ```
 */
export function MarketMonitor({ token }: Props) {
    const [platforms, setPlatforms] = useState<MarketPlatform[]>([]);
    const [freshness, setFreshness] = useState<MarketFreshness | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    /**
     * Fetches market platform status and freshness data from admin API endpoints.
     *
     * Uses Promise.all for parallel fetching to minimize latency.
     * Updates component state with fresh data or logs errors on failure.
     */
    const fetchData = async () => {
        try {
            const [platformsRes, freshnessRes] = await Promise.all([
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/markets/platforms`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/markets/freshness`, {
                    headers: { 'X-Admin-Token': token }
                })
            ]);

            const [platformsData, freshnessData] = await Promise.all([platformsRes.json(), freshnessRes.json()]);
            setPlatforms(platformsData.platforms);
            setFreshness(freshnessData.freshness);
        } catch (error) {
            console.error('Failed to fetch market data:', error);
        } finally {
            setLoading(false);
        }
    };

    /**
     * Triggers a manual refresh of market data for all platforms.
     *
     * Disables refresh buttons during operation to prevent duplicate requests.
     * Waits 2 seconds after triggering refresh before fetching updated data
     * to allow backend time to complete the refresh cycle.
     *
     * @param {boolean} force - If true, bypasses cache and forces fresh API calls
     */
    const triggerRefresh = async (force = false) => {
        setRefreshing(true);
        try {
            await fetch(`${runtimeConfig.apiBaseUrl}/admin/system/markets/refresh`, {
                method: 'POST',
                headers: {
                    'X-Admin-Token': token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ force })
            });
            setTimeout(fetchData, 2000);
        } catch (error) {
            console.error('Failed to trigger refresh:', error);
        } finally {
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    /**
     * Returns the appropriate CSS class variant based on platform status.
     *
     * Maps platform status to color-coded variants for visual feedback:
     * - online: Green background/border
     * - stale: Yellow background/border (data age threshold exceeded)
     * - failed: Red background/border (API request failures)
     * - disabled: Gray background/border (platform inactive)
     *
     * @param {string} status - Platform status
     * @returns {string} CSS Module class name for status variant
     */
    const getPlatformCardClass = (status: string): string => {
        switch (status) {
            case 'online':
                return styles['platform_card--online'];
            case 'stale':
                return styles['platform_card--stale'];
            case 'failed':
                return styles['platform_card--failed'];
            default:
                return styles['platform_card--disabled'];
        }
    };

    /**
     * Returns the appropriate CSS class variant for status badges.
     *
     * @param {string} status - Platform status
     * @returns {string} CSS Module class name for badge variant
     */
    const getStatusBadgeClass = (status: string): string => {
        switch (status) {
            case 'online':
                return styles['badge--online'];
            case 'stale':
                return styles['badge--stale'];
            case 'failed':
                return styles['badge--failed'];
            default:
                return styles['badge--disabled'];
        }
    };

    if (loading) {
        return <div className={styles.loading}>Loading market monitoring data...</div>;
    }

    return (
        <div className={styles.container}>
            {/* Market Data Freshness */}
            <section className={styles.section}>
                <header className={styles.section__header}>
                    <h2 className={styles.section__title}>Market Data Freshness</h2>
                    <div className={styles.actions}>
                        <button
                            onClick={() => triggerRefresh(false)}
                            disabled={refreshing}
                            className={styles.button}
                        >
                            {refreshing ? 'Refreshing...' : 'Refresh All Markets'}
                        </button>
                        <button
                            onClick={() => triggerRefresh(true)}
                            disabled={refreshing}
                            className={styles.button}
                        >
                            Force Refresh
                        </button>
                    </div>
                </header>

                {freshness && (
                    <div className={styles.metrics_grid}>
                        <div className={styles.metric_card}>
                            <div className={styles.metric_card__label}>Stale Platforms</div>
                            <div className={styles.metric_card__value}>{freshness.stalePlatformCount}</div>
                        </div>

                        <div className={styles.metric_card}>
                            <div className={styles.metric_card__label}>Average Data Age</div>
                            <div className={styles.metric_card__value}>{freshness.averageDataAge.toFixed(1)} min</div>
                        </div>

                        {freshness.oldestDataAge !== null && (
                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>Oldest Data</div>
                                <div className={styles.metric_card__value}>{freshness.oldestDataAge.toFixed(1)} min</div>
                            </div>
                        )}
                    </div>
                )}

                {freshness && freshness.platformsWithOldData.length > 0 && (
                    <div className={styles.warning_alert}>
                        <div className={styles.warning_alert__title}>
                            Platforms with Old Data ({'>'}1 hour):
                        </div>
                        <div className={styles.warning_alert__body}>
                            {freshness.platformsWithOldData.join(', ')}
                        </div>
                    </div>
                )}
            </section>

            {/* Platform Status Table */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>Platform Status</h2>
                <div className={styles.platform_list}>
                    {platforms.map(platform => (
                        <div
                            key={platform.guid}
                            className={`${styles.platform_card} ${getPlatformCardClass(platform.status)}`}
                        >
                            <div className={styles.platform_header}>
                                <div className={styles.platform_header__info}>
                                    <h3 className={styles.platform_header__title}>{platform.name}</h3>
                                    {platform.lastFetchedAt && (
                                        <p className={styles.platform_header__timestamp}>
                                            Last fetched: {new Date(platform.lastFetchedAt).toLocaleString()}
                                        </p>
                                    )}
                                </div>
                                <div className={styles.badges}>
                                    {!platform.isActive && (
                                        <span className={`${styles.badge} ${styles['badge--disabled']}`}>
                                            Disabled
                                        </span>
                                    )}
                                    <span className={`${styles.badge} ${getStatusBadgeClass(platform.status)}`}>
                                        {platform.status}
                                    </span>
                                </div>
                            </div>

                            <div className={styles.platform_meta}>
                                <div>
                                    <span className={styles.platform_meta__label}>Reliability: </span>
                                    <span className={styles.platform_meta__value}>
                                        {platform.reliabilityScore.toFixed(1)}%
                                    </span>
                                </div>
                                {platform.responseTime !== null && (
                                    <div>
                                        <span className={styles.platform_meta__label}>Response Time: </span>
                                        <span>{platform.responseTime}ms</span>
                                    </div>
                                )}
                                {platform.consecutiveFailures > 0 && (
                                    <div>
                                        <span className={styles.platform_meta__label}>Consecutive Failures: </span>
                                        <span className={`${styles.platform_meta__value} ${styles['platform_meta__value--error']}`}>
                                            {platform.consecutiveFailures}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
