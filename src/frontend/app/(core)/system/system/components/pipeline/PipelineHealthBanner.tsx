'use client';

/**
 * @fileoverview The status line at the top of the Pipeline tab.
 *
 * Operators said the old console made them work out whether ingestion was
 * healthy by reading a dozen figures across two cards. This banner states the
 * answer in one word and lists the reasons behind it, each labelled with the
 * stage card further down that shows the detail. The judgement itself is made
 * by the backend, so the banner never disagrees with the figures beneath it.
 */

import { AlertOctagon, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { IPipelineHealth, IPipelineHealthReason } from '@/types';
import { Badge } from '../../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { cn } from '../../../../../../lib/cn';
import styles from './PipelineHealthBanner.module.scss';

/** Inputs for the banner. */
interface IPipelineHealthBannerProps {
    /** The backend's judgement and reasons. */
    health: IPipelineHealth;
    /** When the payload was built, shown so an operator knows how fresh the judgement is. */
    generatedAt: string;
    /**
     * Error from the most recent refresh, or null when it succeeded. When set,
     * the banner says the figures have stopped updating while keeping the
     * last good judgement on screen.
     */
    refreshError: string | null;
}

/** Heading and styling for each health level. */
const LEVEL_DISPLAY: Record<IPipelineHealth['level'], { title: string; className: string }> = {
    healthy: { title: 'Pipeline healthy', className: styles.banner_healthy },
    degraded: { title: 'Pipeline degraded', className: styles.banner_degraded },
    stalled: { title: 'Pipeline stalled', className: styles.banner_stalled }
};

/** Stage names as the stage cards title them. */
const STAGE_NAMES: Record<IPipelineHealthReason['stage'], string> = {
    fetch: 'Fetch',
    enrich: 'Enrich',
    buffer: 'Buffer',
    commit: 'Commit',
    observers: 'Observers'
};

/**
 * Render the pipeline's overall state and the reasons for it.
 *
 * @param props - The health judgement, its timestamp, and any refresh error.
 * @returns The banner.
 */
export function PipelineHealthBanner({ health, generatedAt, refreshError }: IPipelineHealthBannerProps) {
    const display = LEVEL_DISPLAY[health.level];
    const Icon = health.level === 'healthy' ? CheckCircle2 : health.level === 'degraded' ? AlertTriangle : AlertOctagon;

    return (
        <section className={cn(styles.banner, display.className)} aria-live="polite" aria-label="Pipeline status">
            <header className={styles.header}>
                <Icon size={24} aria-hidden="true" className={styles.icon} />
                <h2 className={styles.title}>{display.title}</h2>
                <span className={styles.meta}>
                    As of <ClientTime date={generatedAt} format="time" />
                </span>
            </header>

            {refreshError && (
                <p className={styles.stale} role="alert">
                    <AlertTriangle size={14} aria-hidden="true" />
                    Not refreshing: {refreshError}. The figures below are from the time shown.
                </p>
            )}

            {health.reasons.length > 0 ? (
                <ul className={styles.reasons}>
                    {health.reasons.map((reason, index) => (
                        <li key={`${reason.stage}-${index}`} className={styles.reason}>
                            <Badge tone={reason.level} size="sm">{STAGE_NAMES[reason.stage]}</Badge>
                            <span>{reason.message}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className={styles.summary}>
                    Blocks are being fetched, buffered, and committed on schedule, and every observer is keeping up.
                </p>
            )}
        </section>
    );
}
