'use client';

/**
 * @fileoverview History tab — the decided items, most recent decision first.
 * Decisions never delete a record, so this is the audit of what was approved,
 * rejected, or dismissed, by whom, and where approved content was delivered.
 * It stays a table because it is data to skim rather than work to act on: each
 * row leads with the decision, names the item with a one-line excerpt, and
 * summarises delivery. Choosing a row opens the full record in a slide-over.
 *
 * The history is never pruned, so it is paged and filtered on the server, 25
 * decisions at a time, by decision and by content type. Each page and each
 * filter change is fetched when the admin asks, which is the user-triggered
 * loading the SSR rule allows. The tab refetches the page it shows on the
 * `curation:changed` signal, so a decision made on the Pending tab, or by
 * another admin, appears here without a reload.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge } from '../../../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../../../components/ui/ClientTime';
import { Pagination } from '../../../../../../../components/ui/Pagination';
import { Panel } from '../../../../../../../components/ui/Panel';
import { Select } from '../../../../../../../components/ui/Select';
import { SlideOver } from '../../../../../../../components/ui/SlideOver';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../../components/ui/Table';
import { getSocket } from '../../../../../../../lib/socketClient';
import {
    CURATION_DECISIONS,
    CURATION_HISTORY_PAGE_SIZE,
    listCurationHistory,
    type CurationDecision,
    type ICurationHistoryTypeOption,
    type ICurationItemView,
    type ICurationSinkOutcome
} from '../../../../../../../modules/curation';
import { DecisionDetailPanel } from '../components/DecisionDetailPanel';
import { decisionLabel, decisionTone, outcomeLabel, outcomeTone } from '../components/curationStatus';
import styles from './HistoryTab.module.scss';

/** How many destinations ended in one delivery state. */
interface IOutcomeCount {
    status: ICurationSinkOutcome['status'];
    count: number;
}

/** The filters the history is narrowed by; blank means no filter. */
interface IHistoryFilters {
    decision: CurationDecision | '';
    typeId: string;
}

/** No filter on either field, which is how the tab opens. */
const NO_FILTERS: IHistoryFilters = { decision: '', typeId: '' };

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

/** Collapse an item's body to one run of text for the row's excerpt. */
function excerptOf(item: ICurationItemView): string {
    return (item.preview.body ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Describe the rows on screen and how many match in all, for the panel's
 * header line.
 *
 * @param page - The page shown, counting from 1.
 * @param shown - Rows on that page.
 * @param total - Rows matching the filters across every page.
 * @returns A phrase such as "26–50 of 312 decisions".
 */
function describeRange(page: number, shown: number, total: number): string {
    const first = (page - 1) * CURATION_HISTORY_PAGE_SIZE + 1;
    const noun = total === 1 ? 'decision' : 'decisions';
    return shown === 0
        ? `0 of ${total.toLocaleString()} ${noun}`
        : `${first.toLocaleString()}–${(first + shown - 1).toLocaleString()} of ${total.toLocaleString()} ${noun}`;
}

/**
 * History tab content.
 *
 * @returns The tab.
 */
export function HistoryTab() {
    const [items, setItems] = useState<ICurationItemView[]>([]);
    const [total, setTotal] = useState(0);
    const [types, setTypes] = useState<ICurationHistoryTypeOption[]>([]);
    const [page, setPage] = useState(1);
    const [filters, setFilters] = useState<IHistoryFilters>(NO_FILTERS);
    const [loaded, setLoaded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Monotonic load id. A page change, a filter change, and a
    // `curation:changed` refetch can overlap, and any can resolve first. Only
    // the newest load may apply its result, so a slower, older response cannot
    // put the rows of another page or filter back on screen.
    const requestId = useRef(0);

    /**
     * Fetch one page of decided items for a set of filters and show it,
     * reporting a failure above the table. A response that a newer load has
     * already superseded is dropped, whether it succeeded or failed.
     *
     * @param nextPage - The page to show, counting from 1.
     * @param nextFilters - The decision and type the rows must match.
     */
    const load = useCallback(async (nextPage: number, nextFilters: IHistoryFilters): Promise<void> => {
        const id = ++requestId.current;
        setLoading(true);
        try {
            const result = await listCurationHistory(nextPage, nextFilters.decision, nextFilters.typeId);
            if (id === requestId.current) {
                setItems(result.curations);
                setTotal(result.total);
                setTypes(result.types);
                setPage(nextPage);
                setFilters(nextFilters);
                setError(null);
                setLoaded(true);
            }
        } catch (err) {
            if (id === requestId.current) {
                setError(err instanceof Error ? err.message : 'Failed to load curation history');
            }
        } finally {
            if (id === requestId.current) {
                setLoading(false);
            }
        }
    }, []);

    /** Load the first page once the tab mounts. */
    useEffect(() => {
        void load(1, NO_FILTERS);
    }, [load]);

    /**
     * Refetch the page on screen whenever the module signals that a decision
     * was made, keeping the admin's page and filters.
     *
     * @returns Cleanup that drops the listener when the tab unmounts or the
     *   page or filters change.
     */
    useEffect(() => {
        const socket = getSocket();
        const handler = () => { void load(page, filters); };
        socket.on('curation:changed', handler);
        return () => { socket.off('curation:changed', handler); };
    }, [load, page, filters]);

    /**
     * Show another page of the same filters.
     *
     * @param nextPage - The page the pager asked for.
     */
    const handlePageChange = useCallback((nextPage: number): void => {
        void load(nextPage, filters);
    }, [load, filters]);

    /**
     * Narrow the list by one filter, from the first page, since the old page
     * number means nothing for a different set of rows. The dropdown shows the
     * new choice at once rather than waiting for the answer.
     *
     * @param change - The filter that changed and its new value.
     */
    const handleFilterChange = useCallback((change: Partial<IHistoryFilters>): void => {
        const next = { ...filters, ...change };
        setFilters(next);
        void load(1, next);
    }, [load, filters]);

    /** Close the record slide-over. */
    const closeRecord = useCallback(() => { setSelectedId(null); }, []);

    const selected = selectedId ? items.find(item => item.id === selectedId) ?? null : null;
    const selectedTitle = selected ? selected.preview.title ?? selected.typeId : '';
    const filtered = filters.decision !== '' || filters.typeId !== '';

    let body: ReactNode;
    if (!loaded) {
        body = error ? null : <p className={styles.placeholder}>Loading decisions…</p>;
    } else if (items.length === 0) {
        body = (
            <p className={styles.placeholder}>
                {filtered
                    ? 'No decisions match these filters.'
                    : 'No decisions yet. Approved, rejected, and dismissed items are listed here.'}
            </p>
        );
    } else {
        // Four columns fit a tablet; on a phone each decision stacks, with its
        // badge and title sharing the entry's first line. The table is the
        // panel's last child so `flush` can run it to the card's edges.
        body = (
            <Table variant="compact" flush stackAt="mobile">
                <Thead>
                    <Tr>
                        <Th scope="col" width="shrink">Decision</Th>
                        <Th scope="col" width="expand">Item</Th>
                        <Th scope="col" width="shrink">Destinations</Th>
                        <Th scope="col" width="shrink">Decided</Th>
                    </Tr>
                </Thead>
                <Tbody>
                    {items.map(item => {
                        const title = item.preview.title ?? item.typeId;
                        const excerpt = excerptOf(item);
                        const outcomes = countOutcomes(item.sinks);
                        return (
                            // The title button below gives the keyboard one stop
                            // per row, so the row itself stays out of the tab
                            // order and only answers the pointer.
                            <Tr key={item.id} className={styles.row} tabIndex={-1} onClick={() => setSelectedId(item.id)}>
                                <Td>
                                    <Badge tone={decisionTone(item.status)} size="xs">{decisionLabel(item.status)}</Badge>
                                </Td>
                                <Td>
                                    <div className={styles.item}>
                                        <div className={styles.item_line}>
                                            {/* Stops propagation so one click opens the record once. */}
                                            <button
                                                type="button"
                                                className={styles.item_button}
                                                onClick={(event) => { event.stopPropagation(); setSelectedId(item.id); }}
                                            >
                                                {title}
                                            </button>
                                            <span className={styles.item_meta}>{item.providerId}</span>
                                        </div>
                                        {excerpt && <span className={styles.excerpt}>{excerpt}</span>}
                                    </div>
                                </Td>
                                <Td label="Destinations">
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
                                <Td muted label="Decided">
                                    <ClientTime date={item.decidedAt ?? item.createdAt} format="short" />
                                </Td>
                            </Tr>
                        );
                    })}
                </Tbody>
            </Table>
        );
    }

    return (
        <>
            <Panel
                title="Decisions"
                className={styles.panel}
                meta={loading ? 'Loading…' : describeRange(page, items.length, total)}
                actions={(
                    <Pagination
                        total={total}
                        pageSize={CURATION_HISTORY_PAGE_SIZE}
                        currentPage={page}
                        onPageChange={handlePageChange}
                    />
                )}
            >
                <div className={styles.filters}>
                    <Select
                        value={filters.decision}
                        onChange={(event) => handleFilterChange({ decision: event.target.value as CurationDecision | '' })}
                        aria-label="Filter by decision"
                    >
                        <option value="">All decisions</option>
                        {CURATION_DECISIONS.map(decision => (
                            <option key={decision} value={decision}>{decisionLabel(decision)}</option>
                        ))}
                    </Select>
                    <Select
                        value={filters.typeId}
                        onChange={(event) => handleFilterChange({ typeId: event.target.value })}
                        aria-label="Filter by content type"
                    >
                        <option value="">All types</option>
                        {types.map(type => (
                            <option key={type.typeId} value={type.typeId}>{type.label}</option>
                        ))}
                    </Select>
                </div>
                {error && <div className="alert" role="alert">{error}</div>}
                {body}
            </Panel>

            <SlideOver
                open={selected !== null}
                onClose={closeRecord}
                label={selected ? `Decision record for ${selectedTitle}` : undefined}
                title={selected ? <span className={styles.record_title}>{selectedTitle}</span> : null}
            >
                {selected && <DecisionDetailPanel item={selected} />}
            </SlideOver>
        </>
    );
}
