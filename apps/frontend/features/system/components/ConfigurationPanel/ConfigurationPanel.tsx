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
}

interface SystemConfig {
    key: string;
    siteUrl: string;
    systemLogsMaxCount: number;
    systemLogsRetentionDays: number;
    updatedAt: string;
    updatedBy?: string;
}

interface Props {
    token: string;
}

/**
 * ConfigurationPanel Component
 *
 * Admin diagnostic tool for viewing and editing system configuration and runtime settings.
 * Provides editable access to system configuration and read-only access to environment settings.
 *
 * **Key Features:**
 * - Editable system configuration (site URL with validation and persistence)
 * - Environment and port configuration display
 * - Feature flag status (scheduler, websockets, telemetry)
 *
 * **Data Sources:**
 * - `/admin/system/config` - Complete environment configuration snapshot
 * - `/admin/system/config/system` - Editable system configuration (site URL)
 *
 * **Security:**
 * Requires admin token authentication via X-Admin-Token header.
 *
 * @param props - Component props
 * @param props.token - Admin authentication token for API requests
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
    const [editedSiteUrl, setEditedSiteUrl] = useState('');
    const [editedLogsMaxCount, setEditedLogsMaxCount] = useState(1000000);
    const [editedLogsRetentionDays, setEditedLogsRetentionDays] = useState(30);
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
            setEditedLogsMaxCount(systemConfigData.config?.systemLogsMaxCount || 1000000);
            setEditedLogsRetentionDays(systemConfigData.config?.systemLogsRetentionDays || 30);
        } catch (error) {
            console.error('Failed to fetch configuration:', error);
        } finally {
            setLoading(false);
        }
    }, [token]);

    /**
     * Saves updated system configuration to the backend.
     *
     * Sends PATCH request with edited values, updates local state on success,
     * and displays transient success/error messages.
     */
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
                body: JSON.stringify({
                    siteUrl: editedSiteUrl,
                    systemLogsMaxCount: editedLogsMaxCount,
                    systemLogsRetentionDays: editedLogsRetentionDays
                })
            });

            const data = await response.json();

            if (response.ok) {
                setSystemConfig(data.config);
                setSaveMessage({ type: 'success', text: 'Configuration saved successfully' });
                setTimeout(() => setSaveMessage(null), 3000);
            } else {
                setSaveMessage({ type: 'error', text: data.error || 'Failed to save configuration' });
            }
        } catch (error) {
            console.error('Failed to update system config:', error);
            setSaveMessage({ type: 'error', text: 'Network error occurred' });
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    /**
     * Formats camelCase configuration keys into human-readable labels.
     *
     * Examples:
     * - "scheduler" → "Scheduler"
     * - "commentsDailyLimit" → "Comments Daily Limit"
     *
     * @param key - camelCase configuration key
     * @returns Human-readable label
     */
    const formatLabel = (key: string): string => {
        return key.replace(/([A-Z])/g, ' $1').trim();
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
                <div className={styles.metrics_grid}>
                    <div className={styles.metric_card}>
                        <div className={styles.metric_card__label}>Site URL</div>
                        <input
                            type="text"
                            value={editedSiteUrl}
                            onChange={(e) => setEditedSiteUrl(e.target.value)}
                            placeholder="https://tronrelic.com"
                            className={styles.input}
                        />
                    </div>
                    <div className={styles.metric_card}>
                        <div className={styles.metric_card__label}>System Logs Max Count</div>
                        <input
                            type="number"
                            value={editedLogsMaxCount}
                            onChange={(e) => setEditedLogsMaxCount(Number(e.target.value))}
                            placeholder="1000000"
                            min="100"
                            max="1000000"
                            className={styles.input}
                        />
                        <div className={styles.metric_card__hint}>Maximum number of log entries to retain</div>
                    </div>
                    <div className={styles.metric_card}>
                        <div className={styles.metric_card__label}>System Logs Retention Days</div>
                        <input
                            type="number"
                            value={editedLogsRetentionDays}
                            onChange={(e) => setEditedLogsRetentionDays(Number(e.target.value))}
                            placeholder="30"
                            min="1"
                            max="365"
                            className={styles.input}
                        />
                        <div className={styles.metric_card__hint}>Number of days to keep logs before deletion</div>
                    </div>
                </div>

                {/* Save Button */}
                <div className={styles.button_container}>
                    <button
                        onClick={handleSaveSystemConfig}
                        disabled={saving}
                        className={styles.save_button}
                        data-saving={saving}
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>

                {/* Save Message */}
                {saveMessage && (
                    <div className={styles.message} data-type={saveMessage.type}>
                        {saveMessage.text}
                    </div>
                )}
            </section>

            {/* Environment Info */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>Environment</h2>
                <div className={styles.metrics_grid}>
                    <div className={styles.metric_card}>
                        <div className={styles.metric_card__label}>Environment</div>
                        <div className={`${styles.metric_card__value} ${styles['metric_card__value--capitalize']}`}>
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
                            className={`${styles.metric_card} ${value ? styles['metric_card--enabled'] : styles['metric_card--disabled']}`}
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
        </div>
    );
}
