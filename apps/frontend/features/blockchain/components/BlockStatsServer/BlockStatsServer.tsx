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
import styles from './BlockStatsServer.module.css';

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
 * Renders the block number and transaction count in the same visual structure
 * as CurrentBlock, but as a pure server component that paints immediately.
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
                    {/* Header */}
                    <div className={styles.header}>
                        <h2 className={styles.title}>Current Block</h2>
                    </div>

                    {/* Stats Grid - matches CurrentBlock layout exactly */}
                    <div className={styles.stats_grid}>
                        <div className={styles.stat_card}>
                            <div className={styles.label}>Block Number</div>
                            <div className={styles.value}>
                                {blockNumber.toLocaleString()}
                            </div>
                        </div>
                        <div className={styles.stat_card}>
                            <div className={styles.label}>Transactions</div>
                            <div className={styles.value}>
                                {transactionCount?.toLocaleString() ?? '0'}
                            </div>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
}
