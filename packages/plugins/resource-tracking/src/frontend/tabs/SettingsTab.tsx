'use client';

import type { IFrontendPluginContext } from '@tronrelic/types';
import styles from '../ResourceTrackingSettingsPage.module.css';

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
 * Settings Tab Component Props.
 *
 * @property context - Frontend plugin context with UI components and API client
 * @property settings - Current settings state
 * @property setSettings - Function to update settings state
 * @property onSave - Callback to trigger settings save
 * @property saving - Whether save operation is in progress
 */
interface ISettingsTabProps {
    context: IFrontendPluginContext;
    settings: ISettings;
    setSettings: (settings: ISettings) => void;
    onSave: () => void;
    saving: boolean;
}

/**
 * Settings Tab Component for Resource Explorer admin page.
 *
 * Provides form interface for configuring data retention policies, purge frequency,
 * and aggregation intervals. All changes take effect immediately without requiring
 * backend restart due to dynamic configuration loading in the summation and purge jobs.
 *
 * Form fields:
 * - Details Retention (days): How long to keep individual delegation transactions
 * - Summation Retention (months): How long to keep aggregated summation data
 * - Purge Frequency (hours): How often the cleanup job runs
 * - Blocks Per Interval: Number of blocks to aggregate per summation period
 *
 * @param props - Component props with context, settings state, and callbacks
 */
export function SettingsTab({ context, settings, setSettings, onSave, saving }: ISettingsTabProps) {
    const { ui } = context;

    return (
        <div className={styles.formContainer}>
            <form
                className={styles.form}
                onSubmit={(e) => {
                    e.preventDefault();
                    onSave();
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

            {/* Action Buttons */}
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
    );
}
