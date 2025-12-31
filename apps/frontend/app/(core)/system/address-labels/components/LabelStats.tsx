/**
 * Label statistics grid component.
 *
 * Displays summary statistics for address labels including
 * total count, verified count, and category breakdowns.
 */

import { Card } from '../../../../../components/ui/Card';
import type { LabelStats as LabelStatsType } from './types';
import styles from '../page.module.css';

interface LabelStatsProps {
    stats: LabelStatsType;
}

/**
 * Statistics grid showing label counts and breakdowns.
 */
export function LabelStats({ stats }: LabelStatsProps) {
    return (
        <div className={styles.statsGrid}>
            <Card padding="md">
                <div className={styles.statCard}>
                    <span className={styles.statValue}>{stats.total}</span>
                    <span className={styles.statLabel}>Total Labels</span>
                </div>
            </Card>
            <Card padding="md">
                <div className={styles.statCard}>
                    <span className={styles.statValue}>{stats.verified}</span>
                    <span className={styles.statLabel}>Verified</span>
                </div>
            </Card>
            <Card padding="md">
                <div className={styles.statCard}>
                    <span className={styles.statValue}>
                        {stats.byCategory['exchange'] || 0}
                    </span>
                    <span className={styles.statLabel}>Exchanges</span>
                </div>
            </Card>
            <Card padding="md">
                <div className={styles.statCard}>
                    <span className={styles.statValue}>
                        {stats.byCategory['whale'] || 0}
                    </span>
                    <span className={styles.statLabel}>Whales</span>
                </div>
            </Card>
        </div>
    );
}
