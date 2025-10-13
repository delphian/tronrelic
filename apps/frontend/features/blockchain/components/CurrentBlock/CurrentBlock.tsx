'use client';

import { useAppSelector } from '../../../../store/hooks';
import { Card } from '../../../../components/ui/Card';
import { cn } from '../../../../lib/cn';
import styles from './CurrentBlock.module.css';

/**
 * CurrentBlock - Displays the currently processed blockchain block with detailed statistics
 *
 * This component subscribes to the blockchain Redux state and displays real-time
 * updates of the latest processed block. It shows:
 * - Block number and transaction count (highlighted metrics)
 * - Detailed statistics (transfers, contract calls, delegations, stakes, etc.)
 * - Resource usage (energy and bandwidth consumption)
 * - Block timestamp and update freshness indicator
 *
 * The component handles three states:
 * - **Loading** - Shows "Waiting for blockchain data" placeholder
 * - **Error/No data** - Shows "No block data available" message
 * - **Success** - Displays complete block information with metrics
 *
 * The block data is received via Socket.IO events (block:new) and stored in Redux
 * by the SocketBridge component, which ensures real-time updates as blocks are
 * processed by the backend blockchain service.
 *
 * The component is designed to be relocatable and can be placed anywhere in the
 * application layout. It uses the elevated Card variant for visual prominence.
 *
 * @returns A card displaying current block information or appropriate loading/error state
 */
export function CurrentBlock() {
    const latestBlock = useAppSelector(state => state.blockchain.latestBlock);
    const status = useAppSelector(state => state.blockchain.status);
    const lastUpdated = useAppSelector(state => state.blockchain.lastUpdated);

    /**
     * Loading state - blockchain data is being fetched.
     */
    if (status === 'idle' || status === 'loading') {
        return (
            <Card elevated>
                <div className={styles.loading_state}>
                    <h2 className={styles.header__title}>Current Block</h2>
                    <div className={styles.loading_state__message}>
                        Waiting for blockchain data...
                    </div>
                </div>
            </Card>
        );
    }

    /**
     * Error state - blockchain data failed to load or is unavailable.
     */
    if (status === 'error' || !latestBlock) {
        return (
            <Card elevated tone="muted">
                <div className={styles.error_state}>
                    <h2 className={styles.header__title}>Current Block</h2>
                    <div className={styles.error_state__message}>
                        No block data available
                    </div>
                </div>
            </Card>
        );
    }

    /**
     * Success state - display full block information.
     */
    return (
        <Card elevated>
            <div className={styles.container}>
                {/* Header */}
                <div className={styles.header}>
                    <h2 className={styles.header__title}>Current Block</h2>
                    {lastUpdated && (
                        <div className={styles.header__timestamp}>
                            Updated {formatRelativeTime(lastUpdated)}
                        </div>
                    )}
                </div>

                {/* Block Number and Transaction Count */}
                <div className={styles.stats_grid}>
                    <StatCard
                        label="Block Number"
                        value={latestBlock.blockNumber.toLocaleString()}
                        tone="accent"
                    />
                    <StatCard
                        label="Transactions"
                        value={latestBlock.transactionCount.toLocaleString()}
                    />
                </div>

                {/* Detailed Statistics */}
                <div className={styles.section}>
                    <h3 className={styles.section__title}>Block Statistics</h3>
                    <div className={styles.mini_stats_grid}>
                        <MiniStatCard label="Transfers" value={latestBlock.stats.transfers} />
                        <MiniStatCard label="Contract Calls" value={latestBlock.stats.contractCalls} />
                        <MiniStatCard label="Delegations" value={latestBlock.stats.delegations} />
                        <MiniStatCard label="Stakes" value={latestBlock.stats.stakes} />
                        <MiniStatCard label="Token Creations" value={latestBlock.stats.tokenCreations} />
                        <MiniStatCard label="Internal Txs" value={latestBlock.stats.internalTransactions} />
                    </div>
                </div>

                {/* Resource Usage */}
                {(latestBlock.stats.totalEnergyUsed > 0 || latestBlock.stats.totalBandwidthUsed > 0) && (
                    <div className={styles.section}>
                        <h3 className={styles.section__title}>Resource Usage</h3>
                        <div className={styles.mini_stats_grid}>
                            <MiniStatCard
                                label="Energy"
                                value={formatLargeNumber(latestBlock.stats.totalEnergyUsed)}
                            />
                            <MiniStatCard
                                label="Bandwidth"
                                value={formatLargeNumber(latestBlock.stats.totalBandwidthUsed)}
                            />
                        </div>
                    </div>
                )}

                {/* Block Timestamp */}
                <div className={styles.footer}>
                    Block time: {formatBlockTime(latestBlock.timestamp)}
                </div>
            </div>
        </Card>
    );
}

/**
 * Properties for the StatCard component.
 */
interface StatCardProps {
    /** The descriptive label for the statistic */
    label: string;
    /** The statistic value to display */
    value: string;
    /** Visual emphasis level (default or accent) */
    tone?: 'default' | 'accent';
}

/**
 * StatCard - Display a statistics card with label and value
 *
 * Renders a bordered card containing a label and formatted value, with optional
 * accent styling to highlight important metrics like block numbers.
 *
 * @param props - Statistic label, value, and visual tone
 * @returns A formatted statistics card element
 */
function StatCard({ label, value, tone = 'default' }: StatCardProps) {
    return (
        <div className={cn(
            styles.stat_card,
            tone === 'accent' && styles['stat_card--accent']
        )}>
            <div className={styles.stat_card__label}>{label}</div>
            <div className={styles.stat_card__value}>{value}</div>
        </div>
    );
}

/**
 * Properties for the MiniStatCard component.
 */
interface MiniStatCardProps {
    /** The descriptive label for the statistic */
    label: string;
    /** The numeric or pre-formatted string value to display */
    value: number | string;
}

/**
 * MiniStatCard - Display a compact statistics card with label and numeric value
 *
 * Renders a smaller card optimized for displaying multiple related metrics in a
 * grid layout. Automatically formats numbers with locale-aware separators.
 *
 * @param props - Statistic label and value
 * @returns A compact statistics card element
 */
function MiniStatCard({ label, value }: MiniStatCardProps) {
    const formattedValue = typeof value === 'number' ? value.toLocaleString() : value;

    return (
        <div className={styles.mini_stat_card}>
            <div className={styles.mini_stat_card__label}>{label}</div>
            <div className={styles.mini_stat_card__value}>{formattedValue}</div>
        </div>
    );
}

/**
 * Formats large numbers with abbreviated suffixes (K, M, B).
 *
 * Converts large numeric values into human-readable abbreviated formats for
 * compact display in UI components. Numbers under 1000 are displayed as-is
 * with locale formatting.
 *
 * @param num - The number to format
 * @returns Formatted string with abbreviated suffix
 */
function formatLargeNumber(num: number): string {
    if (num >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(2) + 'B';
    }
    if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(2) + 'M';
    }
    if (num >= 1_000) {
        return (num / 1_000).toFixed(2) + 'K';
    }
    return num.toLocaleString();
}

/**
 * Formats block timestamp into human-readable date and time.
 *
 * Converts ISO timestamp strings into localized date and time representations
 * for display in the block summary UI. Falls back to raw timestamp string
 * if parsing fails.
 *
 * @param timestamp - ISO timestamp string from block data
 * @returns Formatted date and time string
 */
function formatBlockTime(timestamp: string): string {
    try {
        const date = new Date(timestamp);
        return date.toLocaleString();
    } catch {
        return timestamp;
    }
}

/**
 * Formats timestamp as relative time (e.g., "2 seconds ago", "5 minutes ago").
 *
 * Calculates the time difference between the given timestamp and now, returning
 * a human-readable relative time string for showing update freshness. Handles
 * seconds, minutes, and hours with proper singular/plural forms.
 *
 * @param timestamp - ISO timestamp string to format
 * @returns Relative time string
 */
function formatRelativeTime(timestamp: string): string {
    try {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffSeconds = Math.floor(diffMs / 1000);

        if (diffSeconds < 10) {
            return 'just now';
        }
        if (diffSeconds < 60) {
            return `${diffSeconds} seconds ago`;
        }

        const diffMinutes = Math.floor(diffSeconds / 60);
        if (diffMinutes < 60) {
            return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
        }

        const diffHours = Math.floor(diffMinutes / 60);
        return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    } catch {
        return 'recently';
    }
}
