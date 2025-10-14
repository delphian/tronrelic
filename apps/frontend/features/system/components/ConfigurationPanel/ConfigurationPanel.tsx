'use client';

import { useEffect, useState, useCallback } from 'react';
import { config as runtimeConfig } from '@/lib/config';
import styles from './ConfigurationPanel.module.css';

interface Configuration {
    environment: string;
    port: number;
    features: {
        scheduler: boolean;
        websockets: boolean;
        telemetry: boolean;
    };
    thresholds: {
        delegationAmountTRX: number;
        stakeAmountTRX: number;
    };
    limits: {
        commentsDailyLimit: number;
        chatDailyLimit: number;
    };
    integrations: {
        hasTronGridKey: boolean;
        hasTelegramBot: boolean;
        hasStorageConfigured: boolean;
    };
}

interface Props {
    token: string;
}

/**
 * ConfigurationPanel Component
 *
 * Admin diagnostic tool for viewing environment configuration and runtime settings.
 * Provides read-only access to feature flags, thresholds, limits, and integration status.
 *
 * **Key Features:**
 * - Environment and port configuration display
 * - Feature flag status (scheduler, websockets, telemetry)
 * - Detection thresholds for whale alerts (delegation/stake amounts)
 * - Rate limiting configuration (comments, chat messages)
 * - External integration status (TronGrid, Telegram, storage)
 * - Color-coded status indicators (enabled/disabled, configured/not set)
 *
 * **Data Sources:**
 * - `/admin/system/config` - Complete environment configuration snapshot
 *
 * **Security:**
 * Requires admin token authentication via X-Admin-Token header.
 * Does not expose sensitive values like API keys - only shows presence/absence.
 *
 * @param {Props} props - Component props
 * @param {string} props.token - Admin authentication token for API requests
 *
 * @example
 * ```tsx
 * <ConfigurationPanel token={adminToken} />
 * ```
 */
export function ConfigurationPanel({ token }: Props) {
    const [config, setConfig] = useState<Configuration | null>(null);
    const [loading, setLoading] = useState(true);

    /**
     * Fetches configuration data from admin API endpoint.
     *
     * Uses useCallback to memoize function and prevent unnecessary effect re-runs.
     * Updates component state with configuration snapshot or logs errors on failure.
     */
    const fetchData = useCallback(async () => {
        try {
            const response = await fetch(`${runtimeConfig.apiBaseUrl}/admin/system/config`, {
                headers: { 'X-Admin-Token': token }
            });
            const data = await response.json();
            setConfig(data.config);
        } catch (error) {
            console.error('Failed to fetch configuration:', error);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    /**
     * Formats camelCase configuration keys into human-readable labels.
     *
     * Examples:
     * - "hasTronGridKey" → "Tron Grid Key"
     * - "commentsDailyLimit" → "Comments Daily Limit"
     *
     * @param {string} key - camelCase configuration key
     * @param {boolean} removeHasPrefix - Whether to strip "has" prefix from boolean flags
     * @returns {string} Human-readable label
     */
    const formatLabel = (key: string, removeHasPrefix = false): string => {
        let formatted = key;
        if (removeHasPrefix) {
            formatted = key.replace('has', '');
        }
        return formatted.replace(/([A-Z])/g, ' $1').trim();
    };

    if (loading) {
        return <div className={styles.loading}>Loading configuration...</div>;
    }

    if (!config) {
        return <div className={styles.error}>No configuration data available</div>;
    }

    return (
        <div className={styles.container}>
            {/* Environment Info */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>Environment</h2>
                <div className={styles.metrics_grid}>
                    <div className={styles.metric_card}>
                        <div className={styles.metric_card__label}>Environment</div>
                        <div className={`${styles.metric_card__value} ${styles['metric-card__value--capitalize']}`}>
                            {config.environment}
                        </div>
                    </div>

                    <div className={styles.metric_card}>
                        <div className={styles.metric_card__label}>Port</div>
                        <div className={styles.metric_card__value}>{config.port}</div>
                    </div>
                </div>
            </section>

            {/* Feature Flags */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>Feature Flags</h2>
                <div className={styles.metrics_grid}>
                    {Object.entries(config.features).map(([key, value]) => (
                        <div
                            key={key}
                            className={`${styles.metric_card} ${value ? styles['metric-card--enabled'] : styles['metric-card--disabled']}`}
                        >
                            <div className={styles.metric_card__label}>
                                {formatLabel(key)}
                            </div>
                            <div className={styles.metric_card__value}>
                                {value ? 'Enabled' : 'Disabled'}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Thresholds */}
            <section className={styles.section}>
                <header className={styles.section__header}>
                    <h2 className={styles.section__title}>Detection Thresholds</h2>
                    <p className={styles.section__description}>
                        Whale thresholds are owned by the whale alerts plugin. Update them in the plugin when you need different behaviour.
                        The backend still surfaces delegation and staking cutoffs for analytics.
                    </p>
                </header>

                <div className={styles.metrics_grid}>
                    <div className={styles.metric_card}>
                        <div className={styles.metric_card__label}>Large Delegation (TRX)</div>
                        <div className={styles.metric_card__value}>
                            {config.thresholds.delegationAmountTRX.toLocaleString()}
                        </div>
                    </div>

                    <div className={styles.metric_card}>
                        <div className={styles.metric_card__label}>Large Stake (TRX)</div>
                        <div className={styles.metric_card__value}>
                            {config.thresholds.stakeAmountTRX.toLocaleString()}
                        </div>
                    </div>
                </div>
            </section>

            {/* Rate Limits */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>Rate Limits</h2>
                <div className={styles.metrics_grid}>
                    <div className={styles.metric_card}>
                        <div className={styles.metric_card__label}>Comments Per Day</div>
                        <div className={styles.metric_card__value}>
                            {config.limits.commentsDailyLimit}
                        </div>
                    </div>

                    <div className={styles.metric_card}>
                        <div className={styles.metric_card__label}>Chat Messages Per Day</div>
                        <div className={styles.metric_card__value}>
                            {config.limits.chatDailyLimit}
                        </div>
                    </div>
                </div>
            </section>

            {/* Integrations */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>External Integrations</h2>
                <div className={styles.metrics_grid}>
                    {Object.entries(config.integrations).map(([key, value]) => (
                        <div
                            key={key}
                            className={`${styles.metric_card} ${value ? styles['metric-card--enabled'] : styles['metric-card--disabled']}`}
                        >
                            <div className={styles.metric_card__label}>
                                {formatLabel(key, true)}
                            </div>
                            <div className={styles.metric_card__value}>
                                {value ? 'Configured' : 'Not Set'}
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
