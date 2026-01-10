/**
 * BlockStatsServer - Server Component for Instant LCP Paint
 *
 * This is a server component that renders the block number and transaction count
 * immediately without waiting for React hydration. It provides the critical LCP
 * (Largest Contentful Paint) content that paints in the first frame.
 *
 * Architecture:
 * - This component renders on the server only (no 'use client' directive)
 * - It paints immediately when HTML arrives (TTFB)
 * - The CurrentBlock client component overlays this after hydration
 * - CSS transitions handle the seamless handoff
 *
 * This pattern eliminates the ~800ms+ "element render delay" that occurs when
 * LCP content is inside a client component waiting for JavaScript hydration.
 */

import { Card } from '../../../../components/ui/Card';
import styles from './BlockStatsServer.module.scss';

/**
 * Props for the BlockStatsServer component.
 */
interface BlockStatsServerProps {
    /** Block number to display */
    blockNumber: number | null;
    /** Transaction count to display */
    transactionCount: number | null;
}

/**
 * Server-rendered block statistics for instant LCP paint.
 *
 * Renders the block number and transaction count in the same compact visual
 * structure as CurrentBlock, but as a pure server component that paints immediately.
 *
 * @param props - Block data from SSR fetch
 * @returns Static block stats that paint without JavaScript
 */
export function BlockStatsServer({ blockNumber, transactionCount }: BlockStatsServerProps) {
    // Don't render if no data (CurrentBlock will handle loading state)
    if (blockNumber === null) {
        return null;
    }

    return (
        <div className={styles.container} aria-hidden="true">
            <Card elevated>
                <div className={styles.content}>
                    {/* Compact Header Row - matches CurrentBlock exactly */}
                    <div className={styles.header}>
                        <div className={styles.header_left}>
                            {/* Title + Block Number (always same row) */}
                            <div className={styles.title_row}>
                                <h2 className={styles.title}>Current Block</h2>
                                <span className={`${styles.block_number} ${styles.metric_value_accent}`}>
                                    {blockNumber.toLocaleString()}
                                </span>
                            </div>

                            {/* Transaction count (wraps on mobile) */}
                            <div className={styles.tx_metric}>
                                <span className={styles.metric_label}>TXs</span>
                                <span className={styles.metric_value}>
                                    {transactionCount?.toLocaleString() ?? '0'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
}
