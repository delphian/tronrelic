'use client';

/**
 * @fileoverview The full record of one decided item, shown in the History
 * tab's slide-over. A decision is a permanent audit record, so this answers the
 * questions an operator brings to it in order: what was decided and by whom,
 * what the content said at that moment, where it was delivered and where it
 * failed, and the identifying details. The content comes from the frozen
 * snapshot taken at decision time, never a live re-read, so it shows exactly
 * what was approved. Read-only by design.
 */

import { useId } from 'react';
import { Badge } from '../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { cn } from '../../../../../lib/cn';
import type { ICurationItemView } from '../../../../../modules/curation';
import { CurationPreview } from './CurationPreview';
import { decisionLabel, decisionTone, outcomeLabel, outcomeTone } from './curationStatus';
import styles from './DecisionDetailPanel.module.scss';

/**
 * The decision record for one decided item.
 *
 * @param props.item - The decided curation envelope.
 * @returns The record body for the slide-over.
 */
export function DecisionDetailPanel({ item }: { item: ICurationItemView }) {
    const contentId = useId();
    const destinationsId = useId();
    const recordId = useId();
    const sinks = item.sinks ?? [];

    return (
        <div className={styles.panel}>
            <div className={styles.verdict}>
                <Badge tone={decisionTone(item.status)} size="lg">{decisionLabel(item.status)}</Badge>
                <span className={styles.verdict_meta}>
                    {item.decidedBy ? `by ${item.decidedBy}` : 'Decider not recorded'}
                    {item.decidedAt && <> on <ClientTime date={item.decidedAt} format="datetime" /></>}
                </span>
            </div>

            <section className={styles.section} aria-labelledby={contentId}>
                <h3 id={contentId} className={styles.section_title}>Content as decided</h3>
                <CurationPreview preview={item.preview} />
            </section>

            <section className={styles.section} aria-labelledby={destinationsId}>
                <h3 id={destinationsId} className={styles.section_title}>Destinations</h3>
                {sinks.length === 0 ? (
                    <p className={styles.note}>This decision did not publish to any destination.</p>
                ) : (
                    <ul className={styles.ledger}>
                        {sinks.map(outcome => {
                            const detail = outcome.error ?? outcome.reason;
                            return (
                                <li key={outcome.sinkId} className={styles.ledger_row}>
                                    <Badge tone={outcomeTone(outcome.status)} size="sm">{outcomeLabel(outcome.status)}</Badge>
                                    <span className={styles.ledger_sink}>{outcome.sinkId}</span>
                                    {detail && (
                                        <span className={cn(styles.ledger_detail, outcome.status === 'failed' && styles.ledger_detail_error)}>
                                            {detail}
                                        </span>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            <section className={styles.section} aria-labelledby={recordId}>
                <h3 id={recordId} className={styles.section_title}>Record</h3>
                <dl className={styles.kv}>
                    <dt>Type</dt>
                    <dd>{item.typeId}</dd>
                    <dt>From</dt>
                    <dd>{item.providerId}</dd>
                    {item.source && (
                        <>
                            <dt>Via</dt>
                            <dd>{item.source}</dd>
                        </>
                    )}
                    <dt>Held</dt>
                    <dd><ClientTime date={item.createdAt} format="datetime" /></dd>
                    <dt>Item id</dt>
                    <dd>{item.id}</dd>
                </dl>
            </section>
        </div>
    );
}
