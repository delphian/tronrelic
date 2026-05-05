'use client';

import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../../../../lib/cn';
import styles from './StatStrip.module.scss';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

interface StatItem {
    label: string;
    value: ReactNode;
    detail?: ReactNode;
    tone?: Tone;
}

interface StatStripProps {
    items: StatItem[];
    /**
     * Minimum cell width for the auto-fit grid (e.g. "140px"). Drives how
     * many columns the strip can host before wrapping inside its container.
     */
    minColWidth?: string;
    className?: string;
}

/**
 * Compact horizontal stat readout used by the system console.
 *
 * Replaces the older HealthMetric tile pattern. Each cell renders a tiny
 * uppercase label, a monospace numeric value, and an optional detail line —
 * roughly half the vertical footprint of the iconed tile it supersedes. The
 * grid uses CSS auto-fit + a container query so the strip can flow from
 * six columns on a wide console to two on a narrow modal context.
 */
export function StatStrip({ items, minColWidth = '140px', className }: StatStripProps) {
    const style = { '--stat-col-min': minColWidth } as CSSProperties;
    return (
        <div className={cn(styles.strip, className)} style={style}>
            {items.map((item, index) => (
                <div
                    key={`${item.label}-${index}`}
                    className={cn(
                        styles.cell,
                        item.tone === 'success' && styles.cell_success,
                        item.tone === 'warning' && styles.cell_warning,
                        item.tone === 'danger' && styles.cell_danger
                    )}
                >
                    <span className={styles.label}>{item.label}</span>
                    <span className={styles.value}>{item.value}</span>
                    {item.detail && <span className={styles.detail}>{item.detail}</span>}
                </div>
            ))}
        </div>
    );
}
