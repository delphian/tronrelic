'use client';

import type { ReactNode } from 'react';
import { cn } from '../../../../../lib/cn';
import styles from './HealthMetric.module.scss';

type Tone = 'neutral' | 'success' | 'danger';

interface HealthMetricProps {
    label: string;
    value: ReactNode;
    detail?: ReactNode;
    icon?: ReactNode;
    tone?: Tone;
}

/**
 * Compact label + value tile used throughout the system admin page.
 *
 * Centralizes the "icon + label + value" presentation that previously
 * appeared as three different bespoke styles across the config, database,
 * and websockets pages. Renders the same shape in every section so
 * uniformity comes from reuse, not from copy/pasted styling.
 */
export function HealthMetric({ label, value, detail, icon, tone = 'neutral' }: HealthMetricProps) {
    return (
        <div
            className={cn(
                styles.metric,
                tone === 'success' && styles.metric_success,
                tone === 'danger' && styles.metric_danger
            )}
        >
            {icon && <div className={styles.icon}>{icon}</div>}
            <div className={styles.body}>
                <div className={styles.label}>{label}</div>
                <div className={styles.value}>{value}</div>
                {detail && <div className={styles.detail}>{detail}</div>}
            </div>
        </div>
    );
}
