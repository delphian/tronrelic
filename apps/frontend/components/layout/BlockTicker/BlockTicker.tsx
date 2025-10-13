'use client';

import { useAppSelector } from '../../../store/hooks';
import { cn } from '../../../lib/cn';
import styles from './BlockTicker.module.css';

/**
 * BlockTicker - Compact real-time blockchain status ticker
 *
 * Displays a horizontal ticker bar showing current blockchain metrics:
 * - **Block number** - Most recent indexed block (highlighted)
 * - **Transaction count** - Total transactions in latest block
 * - **Transfer count** - TRX/TRC-10/TRC-20 transfer operations
 * - **Contract calls** - Smart contract interactions
 * - **Energy usage** - Total energy consumed (if > 0)
 *
 * The component subscribes to Redux blockchain state and updates in real-time
 * as blocks are processed by the backend sync service. It serves as a mini
 * version of the full CurrentBlock component, providing at-a-glance sync status
 * without consuming significant vertical space.
 *
 * The ticker bar is positioned below the navigation bar and remains hidden until
 * blockchain data is available (prevents flickering on initial load).
 *
 * Responsive design:
 * - Desktop: Full metrics with generous spacing
 * - Tablet: Reduced spacing, maintained visibility
 * - Mobile: Compact layout with horizontal scroll
 *
 * @returns A fixed-position ticker bar or null if no data available
 */
export function BlockTicker() {
    const latestBlock = useAppSelector(state => state.blockchain.latestBlock);
    const status = useAppSelector(state => state.blockchain.status);

    /**
     * Don't render anything until blockchain data is loaded.
     * Prevents empty ticker flashing during initial page load.
     */
    if (status === 'idle' || status === 'loading' || !latestBlock) {
        return null;
    }

    return (
        <div className={styles.ticker}>
            <div className={styles.container}>
                <div className={styles.item}>
                    <span className={styles.label}>Block:</span>
                    <span className={cn(styles.value, styles['value--primary'])}>
                        {latestBlock.blockNumber.toLocaleString()}
                    </span>
                </div>
                <div className={styles.separator} />
                <div className={styles.item}>
                    <span className={styles.label}>Transactions:</span>
                    <span className={styles.value}>
                        {latestBlock.transactionCount.toLocaleString()}
                    </span>
                </div>
                <div className={styles.separator} />
                <div className={styles.item}>
                    <span className={styles.label}>Transfers:</span>
                    <span className={styles.value}>
                        {latestBlock.stats.transfers.toLocaleString()}
                    </span>
                </div>
                <div className={styles.separator} />
                <div className={styles.item}>
                    <span className={styles.label}>Contracts:</span>
                    <span className={styles.value}>
                        {latestBlock.stats.contractCalls.toLocaleString()}
                    </span>
                </div>
                {latestBlock.stats.totalEnergyUsed > 0 && (
                    <>
                        <div className={styles.separator} />
                        <div className={styles.item}>
                            <span className={styles.label}>Energy:</span>
                            <span className={styles.value}>
                                {formatCompactNumber(latestBlock.stats.totalEnergyUsed)}
                            </span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

/**
 * Formats large numbers with abbreviated suffixes for compact display.
 *
 * Converts numeric values into space-efficient abbreviated formats:
 * - 1,234 → "1.2K"
 * - 1,234,567 → "1.2M"
 * - 1,234,567,890 → "1.2B"
 *
 * Used in the ticker to keep metrics concise while remaining readable.
 * Numbers under 1,000 are displayed with full locale formatting.
 *
 * @param num - The number to format
 * @returns Formatted string with abbreviated suffix (K/M/B) or full number
 */
function formatCompactNumber(num: number): string {
    if (num >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(1) + 'B';
    }
    if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(1) + 'M';
    }
    if (num >= 1_000) {
        return (num / 1_000).toFixed(1) + 'K';
    }
    return num.toLocaleString();
}
