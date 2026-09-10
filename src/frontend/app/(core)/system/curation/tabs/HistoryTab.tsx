'use client';

/**
 * @fileoverview History tab — every decided item, most recent decision first.
 * Decisions never delete a record, so this is the audit of what was approved or
 * rejected, by whom, and where approved content was delivered. It stays a
 * table because it is data to skim rather than work to act on: each row leads
 * with the decision, names the item with a one-line excerpt, and summarises
 * delivery. Choosing a row opens the full record in a slide-over.
 *
 * Refetches on the `curation:changed` signal so a decision made on the Pending
 * tab, or by another admin, appears here without a reload.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { Badge } from '../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { SlideOver } from '../../../../../components/ui/SlideOver';
import { getSocket } from '../../../../../lib/socketClient';
import { listCurationHistory, type ICurationItemView, type ICurationSinkOutcome } from '../../../../../modules/curation';
import { DecisionDetailPanel } from '../components/DecisionDetailPanel';
import { decisionLabel, decisionTone, outcomeLabel, outcomeTone } from '../components/curationStatus';
import styles from './HistoryTab.module.scss';

/** How many destinations ended in one delivery state. */
interface IOutcomeCount {
    status: ICurationSinkOutcome['status'];
    count: number;
}

/**
 * Count a decided item's destinations by delivery state, so the row can say
 * "2 delivered, 1 failed" instead of listing every destination.
 *
 * @param sinks - The recorded delivery outcomes, if any.
 * @returns One entry per state that occurred, in first-seen order.
 */
function countOutcomes(sinks: ICurationSinkOutcome[] | undefined): IOutcomeCount[] {
    const counts = new Map<ICurationSinkOutcome['status'], number>();
    for (const outcome of sinks ?? []) {
        counts.set(outcome.status, (counts.get(outcome.status) ?? 0) + 1);
    }
    return Array.from(counts, ([status, count]) => ({ status, count }));
}

/**
 * Collapse an item's body to one run of text for the row's excerpt.
 *
 * @param item - The decided item.
 * @returns The body with whitespace collapsed, or an empty string.
 */
function excerptOf(item: ICurationItemView): string {
    return (item.preview.body ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * History tab content.
 *
 * @returns The tab.
 */
export function HistoryTab() {
    const [items, setItems] = useState<ICurationItemView[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    /** Fetch the decided items, reporting a failure above the table. */
    const load = useCallback(async () => {
        try {
            setItems(await listCurationHistory());
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load curation history');
        } finally {
            setLoading(false);
        }
    }, []);

    /** Load the history once the tab mounts. */
    useEffect(() => {
        void load();
    }, [load]);

    /** Refetch whenever the module signals that a decision was made. */
    useEffect(() => {
        const socket = getSocket();
        const handler = () => { void load(); };
        socket.on('curation:changed', handler);
        return () => { socket.off('curation:changed', handler); };
    }, [load]);

    /** Close the record slide-over. */
    const closeRecord = useCallback(() => { setSelectedId(null); }, []);

    const selected = selectedId ? items.find(item => item.id === selectedId) ?? null : null;
    const selectedTitle = selected ? selected.preview.title ?? selected.typeId : '';

    let body: ReactNode;
    if (loading && items.length === 0) {
        body = <p className={styles.placeholder}>Loading decisions…</p>;
    } else if (items.length === 0) {
        body = error ? null : <p className={styles.placeholder}>No decisions yet. Approved and rejected items are listed here.</p>;
    } else {
        body = (
            <div className={`table-scroll ${styles.table_wrap}`}>
                <Table>
                    <Thead>
                        <Tr>
                            <Th width="shrink">Decision</Th>
                            <Th>Item</Th>
                            <Th width="shrink">Destinations</Th>
                            <Th width="shrink">Decided</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {items.map(item => {
                            const title = item.preview.title ?? item.typeId;
                            const excerpt = excerptOf(item);
                            const outcomes = countOutcomes(item.sinks);
                            return (
                                <Tr key={item.id} className={styles.row} onClick={() => setSelectedId(item.id)}>
                                    <Td data-label="Decision">
                                        <Badge tone={decisionTone(item.status)} size="sm">{decisionLabel(item.status)}</Badge>
                                    </Td>
                                    <Td data-label="Item">
                                        <div className={styles.item}>
                                            {/* The button makes the row reachable by keyboard; the
                                                row's own click handler covers the pointer. */}
                                            <button type="button" className={styles.item_button} onClick={() => setSelectedId(item.id)}>
                                                {title}
                                            </button>
                                            <span className={styles.item_meta}>{item.providerId}</span>
                                            {excerpt && <span className={styles.excerpt}>{excerpt}</span>}
                                        </div>
                                    </Td>
                                    <Td data-label="Destinations">
                                        {outcomes.length === 0 ? (
                                            <span className={styles.none}>None</span>
                                        ) : (
                                            <span className={styles.outcomes}>
                                                {outcomes.map(outcome => (
                                                    <Badge key={outcome.status} tone={outcomeTone(outcome.status)} size="xs">
                                                        {outcome.count} {outcomeLabel(outcome.status).toLowerCase()}
                                                    </Badge>
                                                ))}
                                            </span>
                                        )}
                                    </Td>
                                    <Td muted data-label="Decided" className={styles.col_time}>
                                        <ClientTime date={item.decidedAt ?? item.createdAt} format="datetime" />
                                    </Td>
                                </Tr>
                            );
                        })}
                    </Tbody>
                </Table>
            </div>
        );
    }

    return (
        <div className={styles.history}>
            {error && <div className="alert" role="alert">{error}</div>}
            <p className={styles.intro}>
                Every decision stays on record. Open one to see the content as it was decided and where it was delivered.
            </p>
            {body}

            <SlideOver
                open={selected !== null}
                onClose={closeRecord}
                label={selected ? `Decision record for ${selectedTitle}` : undefined}
                title={selected ? <span className={styles.record_title}>{selectedTitle}</span> : null}
            >
                {selected && <DecisionDetailPanel item={selected} />}
            </SlideOver>
        </div>
    );
}
