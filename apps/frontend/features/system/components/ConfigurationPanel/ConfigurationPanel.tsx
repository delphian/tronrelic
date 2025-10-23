'use client';

import { useEffect, useState, useCallback } from 'react';
import { config as runtimeConfig } from '../../../../lib/config';
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

interface SystemConfig {
    key: string;
    siteUrl: string;
    updatedAt: string;
    updatedBy?: string;
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
    const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [editMode, setEditMode] = useState(false);
    const [editedSiteUrl, setEditedSiteUrl] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    /**
     * Fetches configuration data from admin API endpoint.
     *
     * Uses useCallback to memoize function and prevent unnecessary effect re-runs.
     * Updates component state with configuration snapshot or logs errors on failure.
     */
    const fetchData = useCallback(async () => {
        try {
            const [configResponse, systemConfigResponse] = await Promise.all([
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/config`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/config/system`, {
                    headers: { 'X-Admin-Token': token }
                })
            ]);

            const configData = await configResponse.json();
            const systemConfigData = await systemConfigResponse.json();

            setConfig(configData.config);
            setSystemConfig(systemConfigData.config);
            setEditedSiteUrl(systemConfigData.config?.siteUrl || '');
        } catch (error) {
            console.error('Failed to fetch configuration:', error);
        } finally {
            setLoading(false);
        }
    }, [token]);

    const handleSaveSystemConfig = async () => {
        setSaving(true);
        setSaveMessage(null);

        try {
            const response = await fetch(`${runtimeConfig.apiBaseUrl}/admin/system/config/system`, {
                method: 'PATCH',
                headers: {
                    'X-Admin-Token': token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ siteUrl: editedSiteUrl })
            });

            const data = await response.json();

            if (response.ok) {
                setSystemConfig(data.config);
                setEditMode(false);
                setSaveMessage({ type: 'success', text: 'Site URL updated successfully' });
                setTimeout(() => setSaveMessage(null), 3000);
            } else {
                setSaveMessage({ type: 'error', text: data.error || 'Failed to update site URL' });
            }
        } catch (error) {
            console.error('Failed to update system config:', error);
            setSaveMessage({ type: 'error', text: 'Network error occurred' });
        } finally {
            setSaving(false);
        }
    };

    const handleCancelEdit = () => {
        setEditedSiteUrl(systemConfig?.siteUrl || '');
        setEditMode(false);
        setSaveMessage(null);
    };

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
            {/* Editable System Configuration */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>System Configuration</h2>
                <div className={styles['metrics-grid']}>
                    <div className={styles['metric-card']}>
                        <div className={styles['metric-card__label']}>Site URL</div>
                        {editMode ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <input
                                    type="text"
                                    value={editedSiteUrl}
                                    onChange={(e) => setEditedSiteUrl(e.target.value)}
                                    placeholder="https://tronrelic.com"
                                    style={{
                                        padding: '0.5rem',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: 'var(--radius-md)',
                                        backgroundColor: 'var(--color-surface)',
                                        color: 'var(--color-text)',
                                        fontFamily: 'monospace',
                                        fontSize: '0.875rem'
                                    }}
                                />
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        onClick={handleSaveSystemConfig}
                                        disabled={saving}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            backgroundColor: 'var(--color-success)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: 'var(--radius-md)',
                                            cursor: saving ? 'not-allowed' : 'pointer',
                                            opacity: saving ? 0.6 : 1,
                                            fontSize: '0.875rem'
                                        }}
                                    >
                                        {saving ? 'Saving...' : 'Save'}
                                    </button>
                                    <button
                                        onClick={handleCancelEdit}
                                        disabled={saving}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            backgroundColor: 'var(--color-surface-secondary)',
                                            color: 'var(--color-text)',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: 'var(--radius-md)',
                                            cursor: saving ? 'not-allowed' : 'pointer',
                                            opacity: saving ? 0.6 : 1,
                                            fontSize: '0.875rem'
                                        }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                                {saveMessage && (
                                    <div style={{
                                        padding: '0.5rem',
                                        borderRadius: 'var(--radius-md)',
                                        fontSize: '0.875rem',
                                        backgroundColor: saveMessage.type === 'success'
                                            ? 'rgba(34, 197, 94, 0.1)'
                                            : 'rgba(239, 68, 68, 0.1)',
                                        color: saveMessage.type === 'success'
                                            ? 'var(--color-success)'
                                            : 'var(--color-danger)',
                                        border: `1px solid ${saveMessage.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)'}`
                                    }}>
                                        {saveMessage.text}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div className={styles['metric-card__value']} style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                                    {systemConfig?.siteUrl || 'Not configured'}
                                </div>
                                <button
                                    onClick={() => setEditMode(true)}
                                    style={{
                                        padding: '0.25rem 0.75rem',
                                        backgroundColor: 'var(--color-primary)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer',
                                        fontSize: '0.75rem'
                                    }}
                                >
                                    Edit
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </section>

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
