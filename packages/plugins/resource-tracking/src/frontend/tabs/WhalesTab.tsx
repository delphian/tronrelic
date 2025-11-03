'use client';

import type { IFrontendPluginContext } from '@tronrelic/types';
import styles from '../ResourceTrackingSettingsPage.module.css';
import { RecentWhaleDelegations } from '../components/RecentWhaleDelegations';

/**
 * Get runtime configuration with chain parameters.
 *
 * Reads from window.__RUNTIME_CONFIG__ injected by SSR.
 * Provides instant access to TRON network parameters without API calls.
 *
 * @returns Runtime config with chain parameters
 */
function getRuntimeConfig() {
    if (typeof window === 'undefined') {
        throw new Error('getRuntimeConfig can only be called client-side');
    }
    return (window as any).__RUNTIME_CONFIG__ || {
        chainParameters: {
            energyPerTrx: 5625,
            energyFee: 100,
            bandwidthPerTrx: 1000
        }
    };
}

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
 * Whales Tab Component Props.
 *
 * @property context - Frontend plugin context with UI components and API client
 * @property settings - Current settings state
 * @property setSettings - Function to update settings state
 * @property onSave - Callback to trigger settings save
 * @property saving - Whether save operation is in progress
 */
interface IWhalesTabProps {
    context: IFrontendPluginContext;
    settings: ISettings;
    setSettings: (settings: ISettings) => void;
    onSave: () => void;
    saving: boolean;
}

/**
 * Whales Tab Component for Resource Explorer admin page.
 *
 * Provides interface for configuring whale detection settings and displays
 * recent whale delegations (high-value resource delegations that exceed threshold).
 *
 * Features two sections:
 * 1. Whale Configuration - Enable/disable detection and set threshold
 * 2. Recent Whale Delegations - Table showing last 10 whale transactions
 *
 * Whale delegations reveal institutional activity, large-scale energy rental
 * operations, and market-moving resource allocation patterns on the TRON network.
 *
 * @param props - Component props with context, settings state, and callbacks
 */
export function WhalesTab({ context, settings, setSettings, onSave, saving }: IWhalesTabProps) {
    const { ui } = context;

    return (
        <>
            {/* Whale Configuration Form - Constrained Width */}
            <div className={styles.container}>
                <form
                    className={styles.form}
                    onSubmit={(e) => {
                        e.preventDefault();
                        onSave();
                    }}
                >
                {/* Whale Detection Enabled Toggle */}
                <div className={styles.field}>
                    <label htmlFor="whaleDetectionEnabled" className={styles.label}>
                        <input
                            id="whaleDetectionEnabled"
                            type="checkbox"
                            checked={settings.whaleDetectionEnabled ?? false}
                            onChange={(e) =>
                                setSettings({ ...settings, whaleDetectionEnabled: e.target.checked })
                            }
                            style={{ marginRight: '0.5rem' }}
                        />
                        Enable Whale Detection
                    </label>
                    <p className={styles.description}>
                        When enabled, high-value resource delegations that exceed the threshold will be
                        tracked separately for market intelligence and pattern analysis.
                    </p>
                </div>

                {/* Whale Threshold Input */}
                <div className={styles.field}>
                    <label htmlFor="whaleThreshold" className={styles.label}>
                        Whale Threshold (TRX)
                    </label>
                    <p className={styles.description}>
                        Minimum delegation amount in TRX to qualify as a whale transaction.
                        Applies to both energy and bandwidth delegations.
                    </p>
                    <ui.Input
                        id="whaleThreshold"
                        type="number"
                        min={100000}
                        max={100000000}
                        step={100000}
                        value={settings.whaleThresholdTrx}
                        onChange={(e) =>
                            setSettings({ ...settings, whaleThresholdTrx: parseInt(e.target.value, 10) })
                        }
                        required
                    />
                    {/* Threshold conversion display */}
                    <div style={{
                        marginTop: '0.5rem',
                        fontSize: '0.875rem',
                        color: 'var(--color-text-secondary)',
                        fontFamily: 'var(--font-mono)'
                    }}>
                        {(() => {
                            try {
                                const config = getRuntimeConfig();
                                const energyPerTrx = config.chainParameters?.energyPerTrx || 5625;
                                const bandwidthPerTrx = config.chainParameters?.bandwidthPerTrx || 1000;
                                const energyAmount = Math.floor(settings.whaleThresholdTrx * energyPerTrx);
                                const bandwidthAmount = Math.floor(settings.whaleThresholdTrx * bandwidthPerTrx);
                                return (
                                    <>
                                        ≈ {energyAmount.toLocaleString()} Energy, ≈ {bandwidthAmount.toLocaleString()} Bandwidth <span style={{ fontSize: '0.75rem', fontStyle: 'italic' }}>(Conversions based on current network parameters)</span>
                                    </>
                                );
                            } catch {
                                return <span>...</span>;
                            }
                        })()}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className={styles.actions}>
                    <ui.Button
                        type="submit"
                        variant="primary"
                        disabled={saving}
                    >
                        {saving ? 'Saving...' : 'Save Whale Settings'}
                    </ui.Button>
                </div>
            </form>
            </div>

            {/* Recent Whale Delegations Section - Full Width */}
            <div className={styles.whaleSection}>
                <RecentWhaleDelegations
                    context={context}
                    limit={10}
                    whaleDetectionEnabled={settings.whaleDetectionEnabled}
                />
            </div>
        </>
    );
}
