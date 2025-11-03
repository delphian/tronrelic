'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { AlertCircle } from 'lucide-react';
import styles from '../ResourceTrackingSettingsPage.module.css';

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
 * Recent Whale Delegations Component Props.
 *
 * @property context - Frontend plugin context with UI components and API client
 * @property limit - Maximum number of whale delegations to display (default: 10)
 * @property whaleDetectionEnabled - Whether whale detection is currently enabled (for empty state messaging)
 * @property onRefresh - Optional callback when data is refreshed successfully
 */
interface IRecentWhaleDelegationsProps {
    context: IFrontendPluginContext;
    limit?: number;
    whaleDetectionEnabled?: boolean;
    onRefresh?: () => void;
}

/**
 * Recent Whale Delegations Component.
 *
 * Displays a table of recent high-value resource delegations that exceeded
 * the configured whale threshold. Reusable component that can be embedded
 * in settings pages, dashboards, or dedicated whale tracking views.
 *
 * Features:
 * - Configurable row limit for flexible display contexts
 * - Auto-loading on mount with error handling and retry
 * - Real-time conversion to energy/bandwidth amounts
 * - Responsive table with truncated addresses and formatted values
 * - Empty state messaging based on whale detection status
 *
 * Whale delegations reveal institutional activity, large-scale energy rental
 * operations, and market-moving resource allocation patterns on the TRON network.
 *
 * @param props - Component props with context and display options
 */
export function RecentWhaleDelegations({
    context,
    limit = 10,
    whaleDetectionEnabled = true,
    onRefresh
}: IRecentWhaleDelegationsProps) {
    const { ui, api } = context;

    const [whales, setWhales] = useState<IWhaleDelegation[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Load recent whale delegations from API.
     *
     * Fetches whale delegations up to the specified limit, sorted by timestamp descending.
     * Called on component mount and can be triggered manually via retry button.
     */
    async function loadWhales() {
        setLoading(true);
        setError(null);

        try {
            const response = await api.get('/plugins/resource-tracking/whales/recent', { limit });
            setWhales(response.whales || []);
            if (onRefresh) {
                onRefresh();
            }
        } catch (err) {
            console.error('Failed to load whale delegations:', err);
            setError('Failed to load whale delegations');
        } finally {
            setLoading(false);
        }
    }

    // Load whales on mount and when limit changes
    useEffect(() => {
        void loadWhales();
    }, [api, limit]);

    // Auto-refresh every 60 seconds
    useEffect(() => {
        const intervalId = setInterval(() => {
            void loadWhales();
        }, 60000); // 60 seconds

        // Cleanup on unmount
        return () => clearInterval(intervalId);
    }, [api, limit]);

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
        <div className={styles.whaleSection}>
            <h3 className={styles.whaleSectionTitle}>Recent Whale Delegations</h3>
            <p className={styles.whaleSectionDescription}>
                High-value resource delegations that exceeded the configured threshold.
                Reveals institutional activity and large-scale energy rental operations.
            </p>

            {loading && (
                <div className={styles.loadingContainer}>
                    <p>Loading whale delegations...</p>
                </div>
            )}

            {error && (
                <div className={styles.errorContainer}>
                    <AlertCircle size={20} />
                    <p className={styles.errorText}>{error}</p>
                    <ui.Button onClick={() => void loadWhales()}>Retry</ui.Button>
                </div>
            )}

            {!loading && !error && whales.length === 0 && (
                <div className={styles.emptyState}>
                    <p>No whale delegations detected yet.</p>
                    <p className={styles.emptyStateHint}>
                        {whaleDetectionEnabled
                            ? 'Whale delegations will appear here when transactions exceed the threshold.'
                            : 'Enable whale detection to start tracking high-value delegations.'}
                    </p>
                </div>
            )}

            {!loading && !error && whales.length > 0 && (
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
                                    <td className={styles.amountCell}>
                                        <div>{formatTrx(whale.amountTrx)}</div>
                                        <div style={{
                                            fontSize: '0.75rem',
                                            color: 'var(--color-text-secondary)',
                                            marginTop: '0.25rem',
                                            fontFamily: 'var(--font-mono)'
                                        }}>
                                            {(() => {
                                                try {
                                                    const config = getRuntimeConfig();
                                                    // Use correct ratio based on resource type with fallbacks
                                                    const energyPerTrx = config.chainParameters?.energyPerTrx || 5625;
                                                    const bandwidthPerTrx = config.chainParameters?.bandwidthPerTrx || 1000;
                                                    const ratio = whale.resourceType === 1 ? energyPerTrx : bandwidthPerTrx;
                                                    const nominalAmount = Math.floor(whale.amountTrx * ratio);
                                                    const resourceName = whale.resourceType === 1 ? 'Energy' : 'Bandwidth';
                                                    return `≈ ${nominalAmount.toLocaleString()} ${resourceName}`;
                                                } catch {
                                                    return '';
                                                }
                                            })()}
                                        </div>
                                    </td>
                                    <td>{whale.blockNumber.toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
