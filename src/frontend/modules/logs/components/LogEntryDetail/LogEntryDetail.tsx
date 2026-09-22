'use client';

/**
 * @fileoverview The full record of one log entry, shown in the log viewer's
 * slide-over.
 *
 * The table keeps each entry to one line, so this is where an operator reads
 * what the row could not hold: the whole message, the error text, and the
 * structured context the call site attached. It follows the order of the
 * questions an operator brings to a log entry — how bad and when, what it
 * said, what it carried — and ends with the identifying details.
 */

import { useId } from 'react';
import { Badge } from '../../../../components/ui/Badge';
import { CopyButton } from '../../../../components/ui/CopyButton';
import type { SystemLog } from '../../types';
import { contextErrorText, levelLabel, levelTone } from '../../lib/logPresentation';
import styles from './LogEntryDetail.module.scss';

/**
 * Format an entry's timestamp with the full date and seconds, in the
 * browser's time zone, for the record header.
 *
 * The viewer loads entries after mount, so formatting here cannot cause a
 * hydration mismatch, and `ClientTime` has no format that keeps the seconds an
 * operator needs to line entries up against each other.
 *
 * @param timestamp - ISO 8601 timestamp from the entry
 * @returns The date and time, for example "Sep 22, 2026, 14:03:27"
 */
function formatFullTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

/**
 * The record for one log entry.
 *
 * @param props.log - The entry to show.
 * @returns The record body for the slide-over.
 */
export function LogEntryDetail({ log }: { log: SystemLog }) {
    const messageId = useId();
    const contextId = useId();
    const recordId = useId();
    const errorText = contextErrorText(log);
    const hasContext = log.context && Object.keys(log.context).length > 0;
    const contextJson = hasContext ? JSON.stringify(log.context, null, 2) : '';

    return (
        <div className={styles.panel}>
            <div className={styles.verdict}>
                <Badge tone={levelTone(log.level)} size="md">{levelLabel(log.level)}</Badge>
                <span className={styles.verdict_meta}>
                    {formatFullTimestamp(log.timestamp)} from {log.service}
                </span>
            </div>

            <section className={styles.section} aria-labelledby={messageId}>
                <h3 id={messageId} className={styles.section_title}>Message</h3>
                <p className={styles.message}>{log.message}</p>
                {errorText && <p className={styles.error}>{errorText}</p>}
            </section>

            <section className={styles.section} aria-labelledby={contextId}>
                <div className={styles.section_header}>
                    <h3 id={contextId} className={styles.section_title}>Context</h3>
                    {hasContext && <CopyButton value={contextJson} size="xs" label="Copy" copiedLabel="Copied" />}
                </div>
                {hasContext ? (
                    <pre className={styles.context}>{contextJson}</pre>
                ) : (
                    <p className={styles.note}>This entry was logged without context.</p>
                )}
            </section>

            <section className={styles.section} aria-labelledby={recordId}>
                <h3 id={recordId} className={styles.section_title}>Record</h3>
                <dl className={styles.kv}>
                    <dt>Service</dt>
                    <dd>{log.service}</dd>
                    <dt>Level</dt>
                    <dd>{log.level}</dd>
                    <dt>Logged</dt>
                    <dd>{log.timestamp}</dd>
                    <dt>Entry id</dt>
                    <dd>{log._id}</dd>
                </dl>
            </section>
        </div>
    );
}
