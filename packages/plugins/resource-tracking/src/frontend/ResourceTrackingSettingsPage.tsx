'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { Settings } from 'lucide-react';
import styles from './ResourceTrackingSettingsPage.module.css';
import { SettingsTab, WhalesTab } from './tabs';

/**
 * Settings interface for resource tracking plugin configuration.
 *
 * Represents the complete configuration state for the plugin including
 * data retention, purge frequency, aggregation intervals, and whale detection settings.
 */
interface ISettings {
    detailsRetentionDays: number;
    summationRetentionMonths: number;
    purgeFrequencyHours: number;
    blocksPerInterval: number;
    whaleDetectionEnabled: boolean;
    whaleThresholdTrx: number;
}

/**
 * Tab identifier for the settings page.
 * Determines which tab content is currently displayed.
 */
type TabId = 'settings' | 'whales';

/**
 * Resource Explorer Settings Page Component.
 *
 * Admin interface for configuring resource tracking plugin with tabbed navigation.
 * Provides two tabs:
 * - Settings: Data retention policies, purge frequency, and aggregation intervals
 * - Whales: Whale detection configuration and recent whale delegations display
 *
 * All changes take effect immediately without requiring backend restart due to
 * dynamic configuration loading in the summation and purge jobs.
 *
 * @param props - Component props
 * @param props.context - Frontend plugin context with API client and UI components
 */
export function ResourceTrackingSettingsPage({ context }: { context: IFrontendPluginContext }) {
    const { ui, api } = context;

    const [activeTab, setActiveTab] = useState<TabId>('settings');
    const [settings, setSettings] = useState<ISettings>({
        detailsRetentionDays: 2,
        summationRetentionMonths: 6,
        purgeFrequencyHours: 1,
        blocksPerInterval: 100,
        whaleDetectionEnabled: false,
        whaleThresholdTrx: 1_000_000
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [clearingCache, setClearingCache] = useState(false);
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

    /**
     * Clear all cached summation data.
     *
     * Calls the admin endpoint to invalidate all Redis cache entries for summation queries.
     * Useful after changing blocksPerInterval or when testing new data aggregation logic.
     */
    const handleClearCache = async () => {
        setClearingCache(true);
        setMessage(null);

        try {
            const response = await api.post('/plugins/resource-tracking/system/cache/clear');
            if (response.success) {
                setMessage({
                    type: 'success',
                    text: `Cache cleared successfully. ${response.keysCleared || 0} entries removed.`
                });
            }
        } catch (error) {
            console.error('Failed to clear cache:', error);
            setMessage({ type: 'error', text: 'Failed to clear cache' });
        } finally {
            setClearingCache(false);
        }
    };

    if (loading) {
        return (
            <main className={styles.page}>
                <header className={styles.header}>
                    <h1 className={styles.title}>
                        <Settings size={28} style={{ display: 'inline-block', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                        Resource Explorer Settings
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
                    Resource Explorer Settings
                </h1>
                <p className={styles.subtitle}>
                    Configure data retention policies, cleanup frequency, and whale detection
                </p>
            </header>

            {/* Tab Navigation */}
            <div className={styles.tabs}>
                <button
                    className={`${styles.tab} ${activeTab === 'settings' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('settings')}
                    type="button"
                >
                    Settings
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'whales' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('whales')}
                    type="button"
                >
                    Whales
                </button>
            </div>

            {/* Tab Content */}
            <div className={`surface ${styles.container}`}>
                {/* Message Display (shown at top of tab content) */}
                {message && (
                    <div className={`${styles.message} ${message.type === 'success' ? styles.messageSuccess : styles.messageError}`}>
                        {message.text}
                    </div>
                )}

                {/* Settings Tab */}
                {activeTab === 'settings' && (
                    <>
                        <SettingsTab
                            context={context}
                            settings={settings}
                            setSettings={setSettings}
                            onSave={handleSave}
                            saving={saving}
                        />

                        {/* Cache Management Info Panel */}
                        <div className={styles.infoPanel}>
                            <h3 className={styles.infoPanelTitle}>Cache Management</h3>
                            <p className={styles.infoPanelText}>
                                Summation data is cached for 5 minutes to improve performance.
                                Use the &quot;Clear Summation Cache&quot; button to force immediate
                                data refresh after changing aggregation settings or when testing
                                new data processing logic.
                            </p>
                            <p className={styles.infoPanelText}>
                                <strong>When to clear cache:</strong>
                            </p>
                            <ul className={styles.infoPanelList}>
                                <li>After changing &quot;Blocks Per Aggregation Interval&quot;</li>
                                <li>When troubleshooting stale data issues</li>
                                <li>After manual database modifications</li>
                            </ul>
                            <div className={styles.infoPanelActions}>
                                <ui.Button
                                    type="button"
                                    variant="secondary"
                                    onClick={handleClearCache}
                                    disabled={saving || clearingCache}
                                >
                                    {clearingCache ? 'Clearing Cache...' : 'Clear Summation Cache'}
                                </ui.Button>
                            </div>
                        </div>
                    </>
                )}

                {/* Whales Tab */}
                {activeTab === 'whales' && (
                    <WhalesTab
                        context={context}
                        settings={settings}
                        setSettings={setSettings}
                        onSave={handleSave}
                        saving={saving}
                    />
                )}
            </div>
        </main>
    );
}
