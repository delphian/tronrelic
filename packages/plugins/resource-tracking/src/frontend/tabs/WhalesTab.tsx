'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { AlertCircle } from 'lucide-react';
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
 * Whale delegation record from API response.
 *
 * Represents a high-value resource delegation that exceeded the configured threshold.
 */
interface IWhaleDelegation {
    txId: string;
    timestamp: string;
    fromAddress: string;
    toAddress: string;
    resourceType: 0 | 1;
    amountTrx: number;
    blockNumber: number;
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
 * 2. Recent Whale Delegations - Table showing last 50 whale transactions
 *
 * Whale delegations reveal institutional activity, large-scale energy rental
 * operations, and market-moving resource allocation patterns on the TRON network.
 *
 * @param props - Component props with context, settings state, and callbacks
 */
export function WhalesTab({ context, settings, setSettings, onSave, saving }: IWhalesTabProps) {
    const { ui, api } = context;

    const [whales, setWhales] = useState<IWhaleDelegation[]>([]);
    const [loadingWhales, setLoadingWhales] = useState(false);
    const [whaleError, setWhaleError] = useState<string | null>(null);

    /**
     * Load recent whale delegations from API.
     *
     * Fetches the last 50 whale delegations sorted by timestamp descending.
     * Called on component mount and after settings save.
     */
    async function loadWhales() {
        setLoadingWhales(true);
        setWhaleError(null);

        try {
            const response = await api.get('/plugins/resource-tracking/whales/recent', { limit: 50 });
            setWhales(response.whales || []);
        } catch (error) {
            console.error('Failed to load whale delegations:', error);
            setWhaleError('Failed to load whale delegations');
        } finally {
            setLoadingWhales(false);
        }
    }

    // Load whales on mount
    useEffect(() => {
        void loadWhales();
    }, [api]);

    /**
     * Format timestamp for display.
     *
     * @param isoString - ISO 8601 timestamp string
     * @returns Localized date and time string
     */
    function formatTimestamp(isoString: string): string {
        const date = new Date(isoString);
        return date.toLocaleString();
    }

    /**
     * Format TRX amount with commas for readability.
     *
     * @param amount - Amount in TRX
     * @returns Formatted string with commas (e.g., "1,000,000")
     */
    function formatTrx(amount: number): string {
        return amount.toLocaleString();
    }

    /**
     * Get resource type display name.
     *
     * @param resourceType - 0 = BANDWIDTH, 1 = ENERGY
     * @returns Human-readable resource type name
     */
    function getResourceTypeName(resourceType: 0 | 1): string {
        return resourceType === 1 ? 'Energy' : 'Bandwidth';
    }

    /**
     * Truncate address for display.
     *
     * @param address - Full TRON address
     * @returns Truncated address (first 6 + last 4 characters)
     */
    function truncateAddress(address: string): string {
        if (address.length <= 12) return address;
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    return (
        <div>
            {/* Whale Configuration Form */}
            <form
                className={styles.form}
                onSubmit={async (e) => {
                    e.preventDefault();
                    onSave();
                    // Reload whales after save to reflect any new detections
                    await loadWhales();
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
                        Default is 1,000,000 TRX (1M TRX). Applies to both energy and bandwidth delegations.
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

            {/* Recent Whale Delegations Section */}
            <div className={styles.whaleSection}>
                <h3 className={styles.whaleSectionTitle}>Recent Whale Delegations</h3>
                <p className={styles.whaleSectionDescription}>
                    High-value resource delegations that exceeded the configured threshold.
                    Reveals institutional activity and large-scale energy rental operations.
                </p>

                {loadingWhales && (
                    <div className={styles.loadingContainer}>
                        <p>Loading whale delegations...</p>
                    </div>
                )}

                {whaleError && (
                    <div className={styles.errorContainer}>
                        <AlertCircle size={20} />
                        <p className={styles.errorText}>{whaleError}</p>
                        <ui.Button onClick={() => void loadWhales()}>Retry</ui.Button>
                    </div>
                )}

                {!loadingWhales && !whaleError && whales.length === 0 && (
                    <div className={styles.emptyState}>
                        <p>No whale delegations detected yet.</p>
                        <p className={styles.emptyStateHint}>
                            {settings.whaleDetectionEnabled
                                ? 'Whale delegations will appear here when transactions exceed the threshold.'
                                : 'Enable whale detection above to start tracking high-value delegations.'}
                        </p>
                    </div>
                )}

                {!loadingWhales && !whaleError && whales.length > 0 && (
                    <div className={styles.tableContainer}>
                        <table className={styles.whaleTable}>
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>From</th>
                                    <th>To</th>
                                    <th>Type</th>
                                    <th>Amount (TRX)</th>
                                    <th>Block</th>
                                </tr>
                            </thead>
                            <tbody>
                                {whales.map((whale) => (
                                    <tr key={whale.txId}>
                                        <td>{formatTimestamp(whale.timestamp)}</td>
                                        <td title={whale.fromAddress}>{truncateAddress(whale.fromAddress)}</td>
                                        <td title={whale.toAddress}>{truncateAddress(whale.toAddress)}</td>
                                        <td>
                                            <span className={whale.resourceType === 1 ? styles.energyBadge : styles.bandwidthBadge}>
                                                {getResourceTypeName(whale.resourceType)}
                                            </span>
                                        </td>
                                        <td className={styles.amountCell}>{formatTrx(whale.amountTrx)}</td>
                                        <td>{whale.blockNumber.toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
