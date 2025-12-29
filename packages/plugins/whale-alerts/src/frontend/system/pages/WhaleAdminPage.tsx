'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import type { IWhaleAlertsConfig } from '../../../shared/types';
import { WhaleThresholdSettings } from '../components/WhaleThresholdSettings';
import { WhaleTelegramSettings } from '../components/WhaleTelegramSettings';
import styles from './WhaleAdminPage.module.scss';

/**
 * Whale Alerts Admin Page.
 *
 * Provides administrative controls for configuring the whale-alerts plugin.
 * This page allows admins to adjust whale detection thresholds and configure
 * Telegram notification settings using the injected API client.
 *
 * @param props - Component props
 * @param props.context - Frontend plugin context with API client and UI components
 */
export function WhaleAdminPage({ context }: { context: IFrontendPluginContext }) {
    const { ui, api, websocket } = context;
    const [config, setConfig] = useState<IWhaleAlertsConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [liveThreshold, setLiveThreshold] = useState<number | null>(null);

    useEffect(() => {
        async function loadConfig() {
            try {
                setLoading(true);
                setError(null);
                const data = await api.get('/plugins/whale-alerts/system/config');
                setConfig(data.config);
                setLiveThreshold(data.config.thresholdTRX);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load configuration');
            } finally {
                setLoading(false);
            }
        }
        void loadConfig();
    }, [api]);

    /**
     * Subscribe to real-time config updates.
     *
     * When another admin (or this same admin in another tab) updates the config,
     * this subscription receives the broadcast and updates the live threshold display.
     * This provides immediate feedback that the backend observer is using the new threshold.
     */
    useEffect(() => {
        /**
         * Handle incoming config update events.
         *
         * Updates the live threshold indicator to show the backend is now using
         * the new configuration for whale detection.
         *
         * @param payload - Config update payload with new threshold
         */
        const handleConfigUpdate = (payload: any) => {
            console.log('📡 Config update received:', payload);
            setLiveThreshold(payload.thresholdTRX);
            // Show brief success message
            setSuccessMessage('Configuration applied - backend is now using new threshold');
            setTimeout(() => setSuccessMessage(null), 3000);
        };

        // Subscribe to config-updates room
        websocket.subscribe('config-updates');
        websocket.on('config-updated', handleConfigUpdate);

        return () => {
            websocket.off('config-updated', handleConfigUpdate);
        };
    }, [websocket]);

    const handleSave = async () => {
        if (!config) return;

        try {
            setSaving(true);
            setError(null);
            setSuccessMessage(null);

            await api.put('/plugins/whale-alerts/system/config', config);

            setSuccessMessage('Configuration saved successfully');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save configuration');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <main className={styles.container}>
                <section className={styles.page_header}>
                    <h1 className={styles.title}>Whale Alerts Settings</h1>
                </section>
                <ui.Skeleton height="400px" />
            </main>
        );
    }

    if (!config) {
        return (
            <main className={styles.container}>
                <section className={styles.page_header}>
                    <h1 className={styles.title}>Whale Alerts Settings</h1>
                </section>
                <ui.Card>
                    <p>Failed to load configuration. Please try refreshing the page.</p>
                    {error && (
                        <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', opacity: 0.9 }}>
                            Error: {error}
                        </p>
                    )}
                </ui.Card>
            </main>
        );
    }

    return (
        <main className={styles.container}>
            <section className={styles.page_header}>
                <h1 className={styles.title}>Whale Alerts Settings</h1>
                <p className={styles.subtitle}>
                    Configure whale detection thresholds and notification preferences
                </p>
            </section>

                {error && (
                    <ui.Card>
                        <strong>Error:</strong> {error}
                    </ui.Card>
                )}

                {successMessage && (
                    <ui.Badge tone="success">{successMessage}</ui.Badge>
                )}

                {liveThreshold !== null && (
                    <ui.Card tone="accent">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '1.5rem' }}>🔴</span>
                            <div>
                                <strong>Live Backend Threshold:</strong> {liveThreshold.toLocaleString()} TRX
                                <br />
                                <small style={{ opacity: 0.8 }}>
                                    The observer is currently detecting whale transactions above this amount
                                </small>
                            </div>
                        </div>
                    </ui.Card>
                )}

                <div className="whale-admin-grid">
                    <WhaleThresholdSettings
                        config={config}
                        onChange={setConfig}
                        context={context}
                    />

                    <WhaleTelegramSettings
                        config={config}
                        onChange={setConfig}
                        context={context}
                    />
                </div>

                <ui.Card>
                    <div className={styles.actions}>
                        <ui.Button
                            onClick={handleSave}
                            disabled={saving}
                            variant="primary"
                        >
                            {saving ? 'Saving...' : 'Save Configuration'}
                        </ui.Button>
                    </div>
                </ui.Card>
        </main>
    );
}
