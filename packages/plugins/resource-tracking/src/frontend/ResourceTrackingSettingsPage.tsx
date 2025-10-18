'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { Settings } from 'lucide-react';
import styles from './ResourceTrackingSettingsPage.module.css';

interface ISettings {
    detailsRetentionDays: number;
    summationRetentionMonths: number;
    purgeFrequencyHours: number;
    blocksPerInterval: number;
}

/**
 * Resource Tracking Settings Page Component.
 *
 * Admin interface for configuring data retention policies, purge frequency, and
 * aggregation intervals. Allows administrators to control storage requirements
 * by adjusting how long transaction details and aggregated summation data are kept,
 * and how data is aggregated over time.
 *
 * Settings:
 * - Details Retention (days): How long to keep individual delegation transactions
 * - Summation Retention (months): How long to keep aggregated summation data
 * - Purge Frequency (hours): How often the cleanup job runs
 * - Blocks Per Interval: Number of blocks to aggregate per summation period (default: 100)
 *
 * All changes take effect immediately without requiring backend restart due to
 * dynamic configuration loading in the summation and purge jobs.
 *
 * @param props - Component props
 * @param props.context - Frontend plugin context with API client and UI components
 */
export function ResourceTrackingSettingsPage({ context }: { context: IFrontendPluginContext }) {
    const { ui, api } = context;

    const [settings, setSettings] = useState<ISettings>({
        detailsRetentionDays: 2,
        summationRetentionMonths: 6,
        purgeFrequencyHours: 1,
        blocksPerInterval: 100
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        async function loadSettings() {
            try {
                const response = await api.get('/plugins/resource-tracking/settings');
                if (response.settings) {
                    setSettings(response.settings);
                }
            } catch (error) {
                console.error('Failed to load settings:', error);
                setMessage({ type: 'error', text: 'Failed to load settings' });
            } finally {
                setLoading(false);
            }
        }

        void loadSettings();
    }, [api]);

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);

        try {
            const response = await api.post('/plugins/resource-tracking/settings', settings);
            if (response.success) {
                setMessage({ type: 'success', text: 'Settings saved successfully' });
                if (response.settings) {
                    setSettings(response.settings);
                }
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
            setMessage({ type: 'error', text: 'Failed to save settings' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <main className={styles.page}>
                <header className={styles.header}>
                    <h1 className={styles.title}>
                        <Settings size={28} style={{ display: 'inline-block', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                        Resource Tracking Settings
                    </h1>
                    <p className={styles.subtitle}>Loading settings...</p>
                </header>
                <div className={`surface ${styles.container}`}>
                    <div className={styles.skeletonLoader} style={{ height: '60px', marginBottom: 'var(--spacing-md)' }} />
                    <div className={styles.skeletonLoader} style={{ height: '60px', marginBottom: 'var(--spacing-md)' }} />
                    <div className={styles.skeletonLoader} style={{ height: '60px' }} />
                </div>
            </main>
        );
    }

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <h1 className={styles.title}>
                    <Settings size={28} style={{ display: 'inline-block', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                    Resource Tracking Settings
                </h1>
                <p className={styles.subtitle}>
                    Configure data retention policies and cleanup frequency
                </p>
            </header>

            <div className={`surface ${styles.container}`}>
                <form
                    className={styles.form}
                    onSubmit={(e) => {
                        e.preventDefault();
                        void handleSave();
                    }}
                >
                    {/* Details Retention */}
                    <div className={styles.field}>
                        <label htmlFor="detailsRetention" className={styles.label}>
                            Details Retention (days)
                        </label>
                        <p className={styles.description}>
                            How long to keep individual delegation transaction details.
                            Older records are automatically purged.
                        </p>
                        <ui.Input
                            id="detailsRetention"
                            type="number"
                            min={1}
                            max={365}
                            value={settings.detailsRetentionDays}
                            onChange={(e) =>
                                setSettings({ ...settings, detailsRetentionDays: parseInt(e.target.value, 10) })
                            }
                            required
                        />
                    </div>

                    {/* Summation Retention */}
                    <div className={styles.field}>
                        <label htmlFor="summationRetention" className={styles.label}>
                            Summation Retention (months)
                        </label>
                        <p className={styles.description}>
                            How long to keep aggregated summation data for trend analysis.
                            This affects the maximum time range available in charts.
                        </p>
                        <ui.Input
                            id="summationRetention"
                            type="number"
                            min={1}
                            max={24}
                            value={settings.summationRetentionMonths}
                            onChange={(e) =>
                                setSettings({ ...settings, summationRetentionMonths: parseInt(e.target.value, 10) })
                            }
                            required
                        />
                    </div>

                    {/* Purge Frequency */}
                    <div className={styles.field}>
                        <label htmlFor="purgeFrequency" className={styles.label}>
                            Purge Frequency (hours)
                        </label>
                        <p className={styles.description}>
                            How often the cleanup job runs to remove expired data.
                            Changes take effect immediately upon saving.
                        </p>
                        <ui.Input
                            id="purgeFrequency"
                            type="number"
                            min={1}
                            max={24}
                            value={settings.purgeFrequencyHours}
                            onChange={(e) =>
                                setSettings({ ...settings, purgeFrequencyHours: parseInt(e.target.value, 10) })
                            }
                            required
                        />
                    </div>

                    {/* Blocks Per Interval */}
                    <div className={styles.field}>
                        <label htmlFor="blocksPerInterval" className={styles.label}>
                            Blocks Per Aggregation Interval
                        </label>
                        <p className={styles.description}>
                            Number of blocks to aggregate per summation period. Default is 100 blocks,
                            which equals approximately 5 minutes at 20 blocks per minute.
                            Changes take effect immediately for the next summation job run.
                        </p>
                        <ui.Input
                            id="blocksPerInterval"
                            type="number"
                            min={100}
                            max={1000}
                            value={settings.blocksPerInterval}
                            onChange={(e) =>
                                setSettings({ ...settings, blocksPerInterval: parseInt(e.target.value, 10) })
                            }
                            required
                        />
                    </div>

                    {/* Message Display */}
                    {message && (
                        <div className={`${styles.message} ${message.type === 'success' ? styles.messageSuccess : styles.messageError}`}>
                            {message.text}
                        </div>
                    )}

                    {/* Save Button */}
                    <div className={styles.actions}>
                        <ui.Button
                            type="submit"
                            variant="primary"
                            disabled={saving}
                        >
                            {saving ? 'Saving...' : 'Save Settings'}
                        </ui.Button>
                    </div>
                </form>
            </div>
        </main>
    );
}
