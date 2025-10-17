'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import styles from './ResourceTrackingSettingsPage.module.css';

interface ISettings {
    detailsRetentionDays: number;
    summationRetentionMonths: number;
    purgeFrequencyHours: number;
}

/**
 * Resource Tracking Settings Page Component.
 *
 * Admin interface for configuring data retention policies and purge frequency.
 * Allows administrators to control storage requirements by adjusting how long
 * transaction details and aggregated summation data are kept.
 *
 * Settings:
 * - Details Retention (days): How long to keep individual delegation transactions
 * - Summation Retention (months): How long to keep aggregated summation data
 * - Purge Frequency (hours): How often the cleanup job runs
 *
 * @param props - Component props
 * @param props.context - Frontend plugin context with API client and UI components
 */
export function ResourceTrackingSettingsPage({ context }: { context: IFrontendPluginContext }) {
    const { ui, api } = context;

    const [settings, setSettings] = useState<ISettings>({
        detailsRetentionDays: 2,
        summationRetentionMonths: 6,
        purgeFrequencyHours: 1
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
                    <h1 className={styles.title}>Resource Tracking Settings</h1>
                    <p className={styles.subtitle}>Loading settings...</p>
                </header>
            </main>
        );
    }

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <h1 className={styles.title}>Resource Tracking Settings</h1>
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
