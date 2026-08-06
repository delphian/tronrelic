'use client';

/**
 * @fileoverview Refresh heartbeat for the system Overview tab.
 *
 * Replaces the telemetry strip that used to sit above the Overview consoles.
 * The strip's tiles restated status the section cards below already render in
 * full, so only its refresh readout survives — the one thing no section
 * publishes on its own.
 *
 * The readout answers "is this screen still live, and how stale is what I am
 * looking at?" without an operator having to watch a figure change. It carries
 * no probe and no clock of its own: the Server and Blockchain consoles each own
 * their fetch loop and report the outcome of every cycle, and this renders those
 * reports. That is the point — a timestamp advancing on an independent timer
 * would keep insisting the screen is current while the fetches behind it fail,
 * which is precisely when an operator is relying on it to say otherwise.
 */

import { AlertTriangle } from 'lucide-react';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { REFRESH_INTERVAL_MS, type IRefreshSource } from './overview-refresh';
import styles from './RefreshIndicator.module.scss';

/**
 * Inputs for the Overview refresh readout.
 */
interface IRefreshIndicatorProps {
    /**
     * The consoles this readout speaks for, each with its latest poll outcome.
     *
     * Supplied by the tab that owns both consoles, because neither section can
     * see the other's freshness and the readout must summarize both.
     */
    sources: IRefreshSource[];
}

/**
 * Refresh cadence, last successful update, and failure cue for the Overview tab.
 *
 * Renders the cadence label alone until a console reports for the first time.
 * Showing no timestamp is the honest state there — the alternative is stamping a
 * clock value on mount that no fetch backs, which is also the hydration trap
 * `<ClientTime>` exists to close.
 *
 * A console whose latest cycle failed is named rather than silently dropped, and
 * the timestamp keeps showing the last cycle that did succeed, so the pair reads
 * as "this is how old the data is, and it is no longer advancing."
 *
 * @param sources - Consoles to summarize, with their latest poll outcomes.
 * @returns The right-aligned refresh readout.
 */
export function RefreshIndicator({ sources }: IRefreshIndicatorProps) {
    const succeeded = sources
        .map(source => source.report)
        .filter((report): report is NonNullable<typeof report> => report !== null && report.ok);

    // Newest success across the consoles: the freshest thing on screen is as
    // recent as the most recent console that actually delivered.
    const lastSuccessAt = succeeded.length > 0
        ? succeeded.reduce((newest, report) => (report.at > newest.at ? report : newest)).at
        : null;

    const failing = sources
        .filter(source => source.report !== null && !source.report.ok)
        .map(source => source.label);

    return (
        <div className={styles.meta} role="status" aria-label="Console refresh cadence">
            <span className={styles.meta_label}>Refresh {REFRESH_INTERVAL_MS / 1000}s</span>
            {failing.length > 0 && (
                <span className={styles.meta_stale}>
                    <AlertTriangle size={14} aria-hidden="true" />
                    {failing.join(' and ')} not refreshing
                </span>
            )}
            {lastSuccessAt !== null && (
                <span className={styles.meta_time}>
                    <ClientTime date={lastSuccessAt} format="time" />
                </span>
            )}
        </div>
    );
}
