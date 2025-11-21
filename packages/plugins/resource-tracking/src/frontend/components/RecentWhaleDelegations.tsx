'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { AlertCircle, Minimize2, Maximize2, Zap, Radio } from 'lucide-react';
import styles from './RecentWhaleDelegations.module.css';

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
 * @property defaultCompact - Whether to start in compact mode (default: false)
 */
interface IRecentWhaleDelegationsProps {
    context: IFrontendPluginContext;
    limit?: number;
    whaleDetectionEnabled?: boolean;
    onRefresh?: () => void;
    defaultCompact?: boolean;
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
 * - Auto-refresh every 60 seconds for live data updates
 * - Compact mode toggle for space-efficient display
 * - Real-time conversion to energy/bandwidth amounts
 * - Responsive table with truncated addresses and formatted values
 * - Empty state messaging based on whale detection status
 *
 * The compact mode reduces font sizes, padding, and hides descriptions to fit
 * more data in constrained spaces while maintaining readability. Toggle state
 * is preserved for the component instance but not persisted across page loads.
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
    onRefresh,
    defaultCompact = false
}: IRecentWhaleDelegationsProps) {
    const { ui, api } = context;

    const [whales, setWhales] = useState<IWhaleDelegation[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [compactMode, setCompactMode] = useState(defaultCompact);

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
     * Format timestamp for display in military time (24-hour) and YYYY/MM/DD format.
     *
     * Includes full year for desktop displays where space is available.
     *
     * @param isoString - ISO 8601 timestamp string
     * @returns Formatted date string (e.g., "2025/11/03 14:30")
     */
    function formatTimestampFull(isoString: string): string {
        const date = new Date(isoString);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}/${month}/${day} ${hours}:${minutes}`;
    }

    /**
     * Format timestamp for mobile display without year.
     *
     * Removes year component to save horizontal space on mobile devices
     * while maintaining date and time readability.
     *
     * @param isoString - ISO 8601 timestamp string
     * @returns Formatted date string without year (e.g., "11/03 14:30")
     */
    function formatTimestampShort(isoString: string): string {
        const date = new Date(isoString);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${month}/${day} ${hours}:${minutes}`;
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

    /**
     * Format number in abbreviated form with one decimal place.
     *
     * Converts large numbers to human-readable abbreviated format
     * for mobile display where space is limited. Always includes
     * one decimal place for precision.
     *
     * @param num - Number to abbreviate
     * @returns Abbreviated string (e.g., "521.8M", "1.5K", "3.2B")
     */
    function formatNumberAbbreviated(num: number): string {
        if (num >= 1_000_000_000) {
            return (num / 1_000_000_000).toFixed(1) + 'B';
        }
        if (num >= 1_000_000) {
            return (num / 1_000_000).toFixed(1) + 'M';
        }
        if (num >= 1_000) {
            return (num / 1_000).toFixed(1) + 'K';
        }
        return num.toString();
    }

    return (
        <ui.Card padding={compactMode ? "md" : "lg"} className={`${styles.container} ${compactMode ? styles.compact : ''}`}>
            <div className={styles.header}>
                <div className={styles.header_top}>
                    <h3 className={styles.title}>Recent Whale Delegations</h3>
                    <ui.Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCompactMode(!compactMode)}
                        icon={compactMode ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                        aria-label={compactMode ? 'Expand view' : 'Compact view'}
                    >
                        {compactMode ? 'Expand' : 'Compact'}
                    </ui.Button>
                </div>
                <p className={styles.description}>
                    High-value resource delegations that exceeded the configured threshold.
                    Reveals institutional activity and large-scale energy rental operations.
                </p>
            </div>

            {loading && (
                <div className={styles.loading}>
                    <p>Loading whale delegations...</p>
                </div>
            )}

            {error && (
                <div className={styles.error}>
                    <AlertCircle size={20} className={styles.error_icon} />
                    <p className={styles.error_text}>{error}</p>
                    <ui.Button onClick={() => void loadWhales()}>Retry</ui.Button>
                </div>
            )}

            {!loading && !error && whales.length === 0 && (
                <div className={styles.empty}>
                    <p className={styles.empty_text}>No whale delegations detected yet.</p>
                    <p className={styles.empty_hint}>
                        {whaleDetectionEnabled
                            ? 'Whale delegations will appear here when transactions exceed the threshold.'
                            : 'Enable whale detection to start tracking high-value delegations.'}
                    </p>
                </div>
            )}

            {!loading && !error && whales.length > 0 && (
                <div className={styles.table_wrapper}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>From</th>
                                <th>To</th>
                                <th>Type</th>
                                <th>Amount</th>
                                <th className={styles.block_column}>Block</th>
                            </tr>
                        </thead>
                        <tbody>
                            {whales.map((whale) => (
                                <tr key={whale.txId}>
                                    <td>
                                        <span className={styles.time_full}>{formatTimestampFull(whale.timestamp)}</span>
                                        <span className={styles.time_mobile}>{formatTimestampShort(whale.timestamp)}</span>
                                    </td>
                                    <td title={whale.fromAddress}>{truncateAddress(whale.fromAddress)}</td>
                                    <td title={whale.toAddress}>{truncateAddress(whale.toAddress)}</td>
                                    <td>
                                        <span
                                            className={whale.resourceType === 1 ? styles.badge_energy : styles.badge_bandwidth}
                                            title={getResourceTypeName(whale.resourceType)}
                                        >
                                            <span className={styles.type_icon} aria-label={getResourceTypeName(whale.resourceType)}>
                                                {whale.resourceType === 1 ? <Zap size={16} /> : <Radio size={16} />}
                                            </span>
                                            <span className={styles.type_text}>
                                                {getResourceTypeName(whale.resourceType)}
                                            </span>
                                        </span>
                                    </td>
                                    <td className={styles.amount_cell}>
                                        {/* Desktop view - stacked TRX + resource approximation */}
                                        <div className={styles.amount_full}>
                                            <div className={styles.amount_primary}>
                                                {formatTrx(whale.amountTrx)} TRX
                                            </div>
                                            <div className={styles.amount_secondary}>
                                                {(() => {
                                                    try {
                                                        const config = getRuntimeConfig();
                                                        const energyPerTrx = config.chainParameters?.energyPerTrx || 5625;
                                                        const bandwidthPerTrx = config.chainParameters?.bandwidthPerTrx || 1000;
                                                        const ratio = whale.resourceType === 1 ? energyPerTrx : bandwidthPerTrx;
                                                        const nominalAmount = Math.floor(whale.amountTrx * ratio);
                                                        const resourceName = getResourceTypeName(whale.resourceType);
                                                        return `~${formatNumberAbbreviated(nominalAmount)} ${resourceName}`;
                                                    } catch {
                                                        return '';
                                                    }
                                                })()}
                                            </div>
                                        </div>
                                        {/* Mobile view - stacked abbreviated TRX + resource with icon */}
                                        <div className={styles.amount_mobile}>
                                            <div className={styles.amount_primary}>
                                                {formatNumberAbbreviated(whale.amountTrx)} TRX
                                            </div>
                                            <div className={styles.amount_secondary}>
                                                {(() => {
                                                    try {
                                                        const config = getRuntimeConfig();
                                                        const energyPerTrx = config.chainParameters?.energyPerTrx || 5625;
                                                        const bandwidthPerTrx = config.chainParameters?.bandwidthPerTrx || 1000;
                                                        const ratio = whale.resourceType === 1 ? energyPerTrx : bandwidthPerTrx;
                                                        const nominalAmount = Math.floor(whale.amountTrx * ratio);
                                                        return (
                                                            <>
                                                                ~{formatNumberAbbreviated(nominalAmount)}{' '}
                                                                {whale.resourceType === 1 ? <Zap size={12} /> : <Radio size={12} />}
                                                            </>
                                                        );
                                                    } catch {
                                                        return '';
                                                    }
                                                })()}
                                            </div>
                                        </div>
                                    </td>
                                    <td className={styles.block_column}>{whale.blockNumber.toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </ui.Card>
    );
}
