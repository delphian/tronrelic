'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import type { IResourceMarketsConfig } from '../../../shared/types';
import { MarketConfigSettings } from '../components/MarketConfigSettings';
import { MarketMonitor } from '../components/MarketMonitor';
import { SchedulerJobControl } from '../components/SchedulerJobControl';
import styles from './ResourceMarketsAdminPage.module.css';

/**
 * Resource Markets Admin Page.
 *
 * Provides administrative controls for configuring the resource-markets plugin.
 * This page allows admins to configure the public page URL, menu settings, control
 * the scheduled market refresh job, and monitor market platform health and data freshness.
 *
 * **Features:**
 * - Configure public page URL and menu item settings
 * - Control the resource-markets:refresh scheduler job (enable/disable, modify schedule)
 * - Monitor market platform health and reliability
 * - View data freshness metrics
 * - Manually trigger market refreshes
 *
 * @param props - Component props
 * @param props.context - Frontend plugin context with API client and UI components
 */
export function ResourceMarketsAdminPage({ context }: { context: IFrontendPluginContext }) {
    const { ui, api } = context;
    const [config, setConfig] = useState<IResourceMarketsConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    useEffect(() => {
        async function loadConfig() {
            try {
                setLoading(true);
                setError(null);
                const data = await api.get('/plugins/resource-markets/system/config');
                setConfig(data.config);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load configuration');
            } finally {
                setLoading(false);
            }
        }
        void loadConfig();
    }, [api]);

    const handleSave = async () => {
        if (!config) return;

        try {
            setSaving(true);
            setError(null);
            setSuccessMessage(null);

            await api.put('/plugins/resource-markets/system/config', config);

            setSuccessMessage('Configuration saved successfully. Reload the page to see menu updates.');
            setTimeout(() => setSuccessMessage(null), 5000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save configuration');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <main className={styles.main}>
                <div className="page">
                    <section className="page-header">
                        <h1 className="page-title">Resource Markets Settings</h1>
                    </section>
                    <ui.Skeleton height="400px" />
                </div>
            </main>
        );
    }

    if (!config) {
        return (
            <main className={styles.main}>
                <div className="page">
                    <section className="page-header">
                        <h1 className="page-title">Resource Markets Settings</h1>
                    </section>
                    <ui.Card>
                        <p>Failed to load configuration. Please try refreshing the page.</p>
                        {error && (
                            <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', opacity: 0.9 }}>
                                Error: {error}
                            </p>
                        )}
                    </ui.Card>
                </div>
            </main>
        );
    }

    return (
        <main className={styles.main}>
            <div className="page">
                <section className="page-header">
                    <h1 className="page-title">Resource Markets Settings</h1>
                    <p className="page-subtitle">
                        Configure public page URL, menu settings, and monitor market platform health
                    </p>
                </section>

                {error && (
                    <ui.Card>
                        <div style={{ color: 'var(--color-error)' }}>
                            <strong>Error:</strong> {error}
                        </div>
                    </ui.Card>
                )}

                {successMessage && (
                    <ui.Badge tone="success">{successMessage}</ui.Badge>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    <MarketConfigSettings
                        config={config}
                        onChange={setConfig}
                        context={context}
                    />

                    <SchedulerJobControl context={context} />

                    <MarketMonitor context={context} />
                </div>

                <ui.Card>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <ui.Button
                            onClick={handleSave}
                            disabled={saving}
                            variant="primary"
                        >
                            {saving ? 'Saving...' : 'Save Configuration'}
                        </ui.Button>
                    </div>
                </ui.Card>
            </div>
        </main>
    );
}
