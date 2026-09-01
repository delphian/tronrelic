'use client';

/**
 * Collection browser for the MongoDB admin interface.
 *
 * Lets an administrator see what a database actually contains — collection
 * sizes, document counts, index counts — and page through, correct, or remove
 * individual documents without reaching for a Mongo shell or an external GUI.
 *
 * Scoping is what makes it reusable. Given a `prefix`, it asks the API for one
 * namespace and renders only that, so a plugin can embed the same component on
 * its own admin page scoped to `plugin_<id>_` and an operator never leaves that
 * section to inspect the plugin's data. Without a prefix it behaves as before,
 * showing the whole database for the system console.
 *
 * Editing replaces the whole document rather than patching fields, because the
 * editor is a JSON blob: what the operator sees is what gets written, including
 * fields they removed. `_id` is not editable — the API discards it — so a save
 * either replaces a document in place or fails, and can never silently re-key.
 *
 * The inventory itself is a real table with sortable columns rather than a list
 * of rows carrying badges. Document count and stored size are quantities an
 * operator compares across collections — which one grew, which one is worth an
 * index — and a column of right-aligned figures answers that by scanning, where
 * badges scattered along each row do not. The component renders bare, without a
 * card of its own, so the embedding surface owns the heading and the boundary.
 *
 * `collapsible` puts the whole inventory behind a closed disclosure. That is
 * for a page where the browser is one surface among several and the unscoped
 * inventory — every collection in the deployment — would push everything below
 * it off screen. Closed, it also skips the statistics request, which costs one
 * `collStats` command per collection in scope.
 */

import {
    useState,
    useEffect,
    useCallback,
    useMemo,
    Fragment,
    type ReactElement,
    type ReactNode
} from 'react';
import type { ICollectionBrowserProps } from '@/types';
import { Button } from '../../../../components/ui/Button';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { Textarea } from '../../../../components/ui/Textarea';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { CopyButton } from '../../../../components/ui/CopyButton';
import { useToast } from '../../../../components/ui/ToastProvider/ToastProvider';
import { formatBytes } from '../../../../lib/format';
import {
    AlertCircle,
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    ChevronDown,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Database,
    Trash2,
    Pencil
} from 'lucide-react';
import styles from './CollectionBrowser.module.scss';

interface ICollectionStat {
    name: string;
    count: number;
    size: number;
    avgObjSize: number;
    indexes: number;
}

/** A column the collection table can be ranked by. */
type CollectionSortKey = 'name' | 'count' | 'size' | 'indexes';

/** Which way a sorted column runs. */
type SortDirection = 'asc' | 'desc';

/**
 * The column the table is ranked by, and the direction it runs in.
 */
interface ICollectionSort {
    /** The ranked column. */
    key: CollectionSortKey;
    /** `asc` puts the smallest first, `desc` the largest. */
    direction: SortDirection;
}

/**
 * The sortable columns of the collection table.
 *
 * `initialDirection` is what a first click on a column produces. The numeric
 * columns open descending because the question an operator brings to this
 * table is nearly always "what is biggest" — which collection is eating disk,
 * which document count explains a slow query — and making them click twice to
 * reach that would be a step for nothing. Name opens ascending, which is plain
 * alphabetical order and the table's resting state.
 */
const COLLECTION_COLUMNS: ReadonlyArray<{
    key: CollectionSortKey;
    label: string;
    numeric: boolean;
    initialDirection: SortDirection;
}> = [
    { key: 'name', label: 'Collection', numeric: false, initialDirection: 'asc' },
    { key: 'count', label: 'Documents', numeric: true, initialDirection: 'desc' },
    { key: 'size', label: 'Size', numeric: true, initialDirection: 'desc' },
    { key: 'indexes', label: 'Indexes', numeric: true, initialDirection: 'desc' }
];

/** Where the table rests before the operator sorts it: alphabetical by name. */
const DEFAULT_SORT: ICollectionSort = { key: 'name', direction: 'asc' };

/**
 * Order two collections by the active column.
 *
 * Names compare with `localeCompare` so the alphabetical view matches what a
 * reader expects of mixed-case, prefixed collection names; every other column
 * is a plain number. Direction is applied by negating the comparison, so one
 * comparator serves both directions instead of two near-identical ones.
 *
 * @param a - Left-hand collection.
 * @param b - Right-hand collection.
 * @param sort - The active column and direction.
 * @returns Negative, zero, or positive per the `Array.prototype.sort` contract.
 */
function compareCollections(a: ICollectionStat, b: ICollectionStat, sort: ICollectionSort): number {
    const ordering = sort.key === 'name'
        ? a.name.localeCompare(b.name)
        : a[sort.key] - b[sort.key];

    return sort.direction === 'asc' ? ordering : -ordering;
}

interface IDatabaseStats {
    dbName: string;
    totalSize: number;
    collections: ICollectionStat[];
}

/** Documents shown per page of a collection. */
const PAGE_SIZE = 10;

/**
 * One page of documents, located by cursor rather than by page number.
 *
 * The API pages this table by keyset — each page is a bounded range on the
 * `_id` index — because offset paging charges for every document it skips, and
 * on an 80-million-document collection a jump to the end would make MongoDB
 * walk the entire index for ten rows. That is why `page` is absent here: a
 * cursor knows where its own edges are, not how many pages precede it. The
 * displayed page number is this component's running count instead.
 */
interface ICursorDocuments {
    documents: any[];
    total: number;
    limit: number;
    totalPages: number;
    startCursor: string | null;
    endCursor: string | null;
    hasNextPage: boolean;
    hasPrevPage: boolean;
}

/**
 * A request for one page: which way to travel, and from where.
 *
 * Retained after the page loads so a refresh — after an edit or a delete — can
 * replay the exact request that produced the current view. Replay is safe even
 * when the anchoring document was the one just removed, because a cursor is a
 * value comparison rather than a reference to a living document.
 */
interface IPageRequest {
    direction: 'first' | 'next' | 'prev' | 'last';
    cursor?: string;
}

/** Opening request for any collection: the newest documents, no cursor. */
const FIRST_PAGE: IPageRequest = { direction: 'first' };

/**
 * Reconcile the page count on screen with the page the operator is actually on.
 *
 * The two come from different authorities and can disagree. The count derives
 * from `estimatedDocumentCount`, which reads collection metadata rather than
 * counting, and can under-report — badly, if that metadata is stale after an
 * unclean shutdown. The position is a real tally of pages walked, each step
 * backed by a cursor the server confirmed documents lie beyond. When the
 * estimate loses, "Page 3 of 1" makes the readout look broken; widening the
 * total to the position keeps it coherent instead.
 *
 * @param totalPages - Page count estimated by the API.
 * @param page - Page the operator has walked to.
 * @returns The larger of the two, never below one.
 */
function displayedTotalPages(totalPages: number, page: number): number {
    return Math.max(totalPages, page, 1);
}

/**
 * Render the collection browser.
 *
 * @param prefix - Namespace to scope to; omit for the whole database.
 * @param allowEdit - Whether the edit affordance is offered.
 * @param allowDelete - Whether the delete affordance is offered.
 * @param title - Heading for the collection list. Omit when the embedding
 * surface already labels the browser, which is the common case — a second
 * heading immediately under the first reads as a duplicate. In the collapsible
 * form the heading doubles as the control that opens the browser, so supply one
 * there rather than leaving the disclosure labelled "Collections".
 * @param collapsible - Whether to start closed behind a disclosure heading.
 */
export function CollectionBrowser({
    prefix,
    allowEdit = true,
    allowDelete = true,
    title,
    collapsible = false
}: ICollectionBrowserProps) {
    // Disclosure state for the collapsible form. Declared unconditionally, and
    // read through `isCollapsed` below, so the always-expanded form runs the
    // same hooks in the same order.
    const [collapsed, setCollapsed] = useState(true);
    const isCollapsed = collapsible && collapsed;

    const [stats, setStats] = useState<IDatabaseStats | null>(null);
    const [sort, setSort] = useState<ICollectionSort>(DEFAULT_SORT);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedCollection, setExpandedCollection] = useState<string | null>(null);
    const [documents, setDocuments] = useState<ICursorDocuments | null>(null);
    const [loadingDocuments, setLoadingDocuments] = useState(false);

    // A paging failure is a per-collection concern, so it is held apart from
    // `error` — which reports a stats failure and replaces the whole browser.
    // Routing a rejected cursor through `error` would blank the inventory and
    // the pagination controls together, leaving the operator no way back to the
    // documents but a reload; scoped here, the failed page is reported in place
    // and the controls that retry it stay on screen.
    const [documentsError, setDocumentsError] = useState<string | null>(null);

    // Page position is tracked here rather than returned by the API — see
    // ICursorDocuments. `pageRequest` is the request that produced the current
    // view, kept so a post-edit refresh can replay it verbatim.
    const [page, setPage] = useState(1);
    const [pageRequest, setPageRequest] = useState<IPageRequest>(FIRST_PAGE);
    const [expandedDocumentId, setExpandedDocumentId] = useState<string | null>(null);
    const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);

    // Edit state. `editingDocumentId` is the row key currently in edit mode;
    // `editDraft` holds the operator's in-progress JSON so a parse error can be
    // reported without discarding their work.
    const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<string>('');
    const [editError, setEditError] = useState<string | null>(null);
    const [savingDocumentId, setSavingDocumentId] = useState<string | null>(null);

    const { push: pushToast } = useToast();

    // SystemAuthGate (console) or the plugin admin route guarantees an admin
    // session at this depth; the same-origin Better Auth cookie authorizes
    // every request below.

    /**
     * Load collection statistics for the browser's scope.
     *
     * The prefix travels as a query parameter rather than being applied after
     * the response, so an embedded caller never receives the inventory of
     * collections it has no business seeing.
     */
    const fetchStats = useCallback(async () => {
        try {
            setLoading(true);
            const query = typeof prefix === 'string' && prefix.length > 0
                ? `?prefix=${encodeURIComponent(prefix)}`
                : '';
            const response = await fetch(`/api/admin/database/stats${query}`, {
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch stats: ${response.statusText}`);
            }

            const result = await response.json();
            setStats(result.data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch database stats');
        } finally {
            setLoading(false);
        }
    }, [prefix]);

    /**
     * Load one page of documents from a collection.
     *
     * The page number travels alongside the request rather than inside it: the
     * API locates pages by cursor and cannot count them, so the caller states
     * where the page it asked for lands. A jump to the last page is the one
     * case the caller cannot know in advance, so it defers to the page count
     * that comes back with the response.
     *
     * Both page numbers are floored at one before they reach state. Neither is
     * trustworthy on its own: a caller steps back from whatever it currently
     * displays, and a jump to the end adopts a count derived from an estimate
     * that can under-report. Either can therefore propose a position below the
     * first page, and a counter reading "Page 0" — or "Page -1" after a second
     * step — is worse than a counter that merely lags.
     *
     * @param collectionName - Collection to read.
     * @param request - Which way to travel and, for a relative step, from where.
     * @param landsOnPage - The page number the result should be labelled with;
     * ignored for a jump to the last page, which reads its own position from
     * the response.
     */
    const fetchDocuments = useCallback(async (
        collectionName: string,
        request: IPageRequest = FIRST_PAGE,
        landsOnPage: number = 1
    ) => {
        try {
            setLoadingDocuments(true);
            setDocumentsError(null);

            const params = new URLSearchParams({
                limit: String(PAGE_SIZE),
                direction: request.direction
            });
            if (request.cursor) {
                params.set('cursor', request.cursor);
            }

            const response = await fetch(
                `/api/admin/database/collections/${collectionName}/documents?${params.toString()}`,
                {
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            if (!response.ok) {
                // A stale cursor comes back as a 400 whose message tells the
                // operator how to recover; keeping only statusText would reduce
                // that instruction to a bare "Bad Request".
                const body = await response.json().catch(() => ({}));
                throw new Error(
                    body?.message || body?.error || `Failed to fetch documents: ${response.statusText}`
                );
            }

            const result = await response.json();
            const data = result.data as ICursorDocuments;

            setDocuments(data);
            setPageRequest(request);
            setPage(Math.max(1, request.direction === 'last' ? data.totalPages : landsOnPage));
        } catch (err) {
            setDocumentsError(err instanceof Error ? err.message : 'Failed to fetch documents');
        } finally {
            setLoadingDocuments(false);
        }
    }, []);

    /**
     * Reload the page currently on screen.
     *
     * Used after an edit or a delete, where the operator should stay exactly
     * where they were. Replaying the stored request is what makes that
     * possible without a page number the API could seek to.
     *
     * @param collectionName - Collection being browsed.
     */
    const refreshCurrentPage = useCallback((collectionName: string) => {
        return fetchDocuments(collectionName, pageRequest, page);
    }, [fetchDocuments, pageRequest, page]);

    // A collapsed browser does not fetch. The statistics request runs one
    // `collStats` command per collection in scope, and the unscoped system
    // console view covers every collection in the deployment, so sending it for
    // a panel nobody opened is real work spent on nothing. The trade is that
    // opening the browser costs a round trip; the loading line covers it.
    useEffect(() => {
        if (isCollapsed) return;
        void fetchStats();
    }, [isCollapsed, fetchStats]);

    const toggleCollection = (collectionName: string) => {
        setExpandedDocumentId(null);
        setEditingDocumentId(null);
        if (expandedCollection === collectionName) {
            setExpandedCollection(null);
            setDocuments(null);
        } else {
            setExpandedCollection(collectionName);
            // Opening a collection always starts at the newest documents, so
            // the page counter resets with it.
            void fetchDocuments(collectionName, FIRST_PAGE, 1);
        }
    };

    const toggleDocument = (documentId: string) => {
        setExpandedDocumentId(prev => (prev === documentId ? null : documentId));
    };

    /**
     * Enter edit mode for a document, seeding the draft with its current JSON.
     *
     * Expands the row as a side effect: an edit box the operator cannot see
     * would look like the button did nothing.
     *
     * @param rowKey - Row key identifying the document.
     * @param doc - The document to edit.
     */
    const startEditing = useCallback((rowKey: string, doc: unknown) => {
        setExpandedDocumentId(rowKey);
        setEditingDocumentId(rowKey);
        setEditDraft(JSON.stringify(doc, null, 2));
        setEditError(null);
    }, []);

    /** Leave edit mode, discarding the draft. */
    const cancelEditing = useCallback(() => {
        setEditingDocumentId(null);
        setEditDraft('');
        setEditError(null);
    }, []);

    /**
     * Validate and save the edited document.
     *
     * Parsing happens before the request so malformed JSON is reported inline
     * against the editor the operator is looking at, rather than as a server
     * error after a round trip.
     *
     * @param collectionName - Collection owning the document.
     * @param documentId - The document's `_id`.
     */
    const saveDocument = useCallback(async (collectionName: string, documentId: string) => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(editDraft);
        } catch (err) {
            setEditError(err instanceof Error ? err.message : 'Invalid JSON');
            return;
        }

        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            setEditError('A document must be a JSON object');
            return;
        }

        setSavingDocumentId(documentId);
        try {
            const response = await fetch(
                `/api/admin/database/collections/${collectionName}/documents/${encodeURIComponent(documentId)}`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(parsed)
                }
            );

            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body?.message || body?.error || `Save failed: ${response.statusText}`);
            }

            pushToast({
                tone: 'success',
                title: 'Document saved',
                description: `Updated ${documentId} in ${collectionName}`
            });

            cancelEditing();
            await Promise.all([
                refreshCurrentPage(collectionName),
                fetchStats()
            ]);
        } catch (err) {
            setEditError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setSavingDocumentId(null);
        }
    }, [editDraft, pushToast, cancelEditing, refreshCurrentPage, fetchStats]);

    const deleteDocument = useCallback(async (collectionName: string, documentId: string) => {
        const confirmed = typeof window !== 'undefined'
            ? window.confirm(
                `Delete document ${documentId} from "${collectionName}"?\n\nThis cannot be undone.`
            )
            : false;
        if (!confirmed) return;

        setDeletingDocumentId(documentId);
        try {
            const response = await fetch(
                `/api/admin/database/collections/${collectionName}/documents/${encodeURIComponent(documentId)}`,
                {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body?.message || body?.error || `Delete failed: ${response.statusText}`);
            }

            pushToast({
                tone: 'success',
                title: 'Document deleted',
                description: `Removed ${documentId} from ${collectionName}`
            });

            if (expandedDocumentId === documentId) setExpandedDocumentId(null);

            // Refresh the page the operator is on, plus the top-level counts.
            await Promise.all([
                refreshCurrentPage(collectionName),
                fetchStats()
            ]);
        } catch (err) {
            pushToast({
                tone: 'danger',
                title: 'Delete failed',
                description: err instanceof Error ? err.message : 'Unknown error'
            });
        } finally {
            setDeletingDocumentId(null);
        }
    }, [pushToast, expandedDocumentId, refreshCurrentPage, fetchStats]);

    /**
     * Rank a column, or flip it if it is already the ranked one.
     *
     * Row expansion is keyed by collection name rather than position, so an
     * open collection stays open across a re-sort and the operator does not
     * lose the documents they were reading.
     *
     * @param key - The column the operator clicked.
     */
    const toggleSort = useCallback((key: CollectionSortKey) => {
        setSort((previous) => {
            if (previous.key === key) {
                return { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' };
            }

            const column = COLLECTION_COLUMNS.find((candidate) => candidate.key === key);
            return { key, direction: column?.initialDirection ?? 'desc' };
        });
    }, []);

    const sortedCollections = useMemo(
        () => [...(stats?.collections ?? [])].sort((a, b) => compareCollections(a, b, sort)),
        [stats?.collections, sort]
    );

    // The browser's heading, and in the collapsible form the control that opens
    // it. A button inside a heading is the disclosure markup a screen reader
    // announces correctly: the label stays part of the document outline, and
    // `aria-expanded` says whether the section beneath it is showing.
    const header = collapsible ? (
        <h3 className={styles.disclosure_heading}>
            <button
                type="button"
                className={styles.disclosure_button}
                aria-expanded={!collapsed}
                onClick={() => setCollapsed(previous => !previous)}
            >
                {collapsed
                    ? <ChevronRight size={16} aria-hidden="true" />
                    : <ChevronDown size={16} aria-hidden="true" />}
                {title ?? 'Collections'}
            </button>
        </h3>
    ) : (
        title !== undefined ? <h3 className={styles.section_title}>{title}</h3> : null
    );

    /**
     * Put one of the browser's short states — closed, loading, failed, empty —
     * on the same outer element and under the same heading as the loaded view.
     *
     * The heading has to outlive every one of those states in the collapsible
     * form. Returning a bare message instead would take the disclosure control
     * with it, so a failed statistics request would leave an error on screen
     * that the operator could no longer close.
     *
     * @param body - What to show in place of the collection table, or null when
     * the browser is closed and there is nothing to show.
     * @returns The browser with that body under its heading.
     */
    const shell = (body: ReactNode): ReactElement => (
        <div className={styles.browser}>
            {header}
            {body}
        </div>
    );

    if (isCollapsed) {
        return shell(null);
    }

    if (loading) {
        return shell(<p className={styles.loading}>Loading database statistics…</p>);
    }

    if (error) {
        return shell(
            <div className="alert alert--danger" role="alert">
                <span className={styles.error_inline}>
                    <AlertCircle size={14} aria-hidden="true" />
                    {error}
                </span>
            </div>
        );
    }

    if (!stats) {
        return shell(<p className={styles.loading}>No database statistics available</p>);
    }

    return (
        <div className={styles.browser}>
            {header}

            <p className={styles.overview}>
                <Database size={14} aria-hidden="true" />
                <code className={styles.db_name}>{stats.dbName}</code>
                <span className={styles.overview_meta}>
                    {stats.collections.length}{' '}
                    {stats.collections.length === 1 ? 'collection' : 'collections'} ·{' '}
                    {formatBytes(stats.totalSize)} total
                </span>
            </p>

            {sortedCollections.length === 0 ? (
                <p className={styles.loading}>
                    {typeof prefix === 'string' && prefix.length > 0
                        ? `No collections found for ${prefix}`
                        : 'No collections found'}
                </p>
            ) : (
                <Table variant="compact">
                    <Thead>
                        <Tr>
                            <Th width="shrink" aria-label="Expand" />
                            {COLLECTION_COLUMNS.map(column => {
                                const isSorted = sort.key === column.key;
                                return (
                                    <Th
                                        key={column.key}
                                        width={column.numeric ? 'shrink' : 'expand'}
                                        numeric={column.numeric}
                                        aria-sort={
                                            isSorted
                                                ? (sort.direction === 'asc' ? 'ascending' : 'descending')
                                                : 'none'
                                        }
                                    >
                                        <button
                                            type="button"
                                            className={styles.sort_button}
                                            onClick={() => toggleSort(column.key)}
                                        >
                                            {column.label}
                                            {isSorted
                                                ? (sort.direction === 'asc'
                                                    ? <ArrowUp size={14} aria-hidden="true" />
                                                    : <ArrowDown size={14} aria-hidden="true" />)
                                                : (
                                                    <ArrowUpDown
                                                        size={14}
                                                        aria-hidden="true"
                                                        className={styles.sort_icon_idle}
                                                    />
                                                )}
                                        </button>
                                    </Th>
                                );
                            })}
                        </Tr>
                    </Thead>
                    <Tbody>
                        {sortedCollections.map(collection => {
                            const isCollectionOpen = expandedCollection === collection.name;
                            return (
                                <Fragment key={collection.name}>
                                    <Tr
                                        isExpanded={isCollectionOpen}
                                        className={styles.collection_row}
                                        onClick={() => toggleCollection(collection.name)}
                                    >
                                        <Td muted>
                                            {/* The row itself is clickable for pointer users; this button is
                                              * what makes the same toggle reachable by keyboard, so it stops
                                              * the click from also firing the row handler and undoing itself. */}
                                            <button
                                                type="button"
                                                className={styles.expand_button}
                                                aria-expanded={isCollectionOpen}
                                                aria-label={`${isCollectionOpen ? 'Collapse' : 'Expand'} ${collection.name}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    toggleCollection(collection.name);
                                                }}
                                            >
                                                {isCollectionOpen
                                                    ? <ChevronDown size={14} />
                                                    : <ChevronRight size={14} />}
                                            </button>
                                        </Td>
                                        <Td>
                                            <code className={styles.collection_name}>{collection.name}</code>
                                        </Td>
                                        <Td muted numeric>{collection.count.toLocaleString()}</Td>
                                        <Td muted numeric className={styles.size_cell}>{formatBytes(collection.size)}</Td>
                                        <Td muted numeric>{collection.indexes.toLocaleString()}</Td>
                                    </Tr>

                                    {isCollectionOpen && (
                                        <Tr className={styles.documents_row}>
                                            <Td colSpan={COLLECTION_COLUMNS.length + 1}>
                                                <div className={styles.documents_panel}>
                                                    {documentsError !== null && (
                                                        <div className="alert alert--danger" role="alert">
                                                            <span className={styles.error_inline}>
                                                                <AlertCircle size={14} aria-hidden="true" />
                                                                {documentsError}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {loadingDocuments ? (
                                                        <p className={styles.loading}>Loading documents...</p>
                                                    ) : documents ? (
                                                        <>
                                                            <div className={styles.documents_header}>
                                                                <span>
                                                                    Showing {documents.documents.length} of {documents.total} documents
                                                                </span>
                                                                <div className={styles.pagination}>
                                                                    {/* First is gated on position, not on `hasPrevPage`. It is an
                                                                      * absolute anchor needing no cursor, so it stays meaningful
                                                                      * where a relative step cannot go: a `prev` landing on a page
                                                                      * emptied by concurrent deletes returns no cursors and both
                                                                      * flags false, and gating on the flag would disable every
                                                                      * control at once — stranding the operator on a blank table. */}
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        icon={<ChevronsLeft size={16} />}
                                                                        aria-label="First page"
                                                                        disabled={page <= 1}
                                                                        onClick={() => void fetchDocuments(collection.name, FIRST_PAGE, 1)}
                                                                    />
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        disabled={!documents.hasPrevPage || documents.startCursor === null}
                                                                        onClick={() => void fetchDocuments(
                                                                            collection.name,
                                                                            { direction: 'prev', cursor: documents.startCursor ?? undefined },
                                                                            page - 1
                                                                        )}
                                                                    >
                                                                        Previous
                                                                    </Button>
                                                                    <span className={styles.page_info}>
                                                                        Page {page.toLocaleString()} of{' '}
                                                                        {displayedTotalPages(documents.totalPages, page).toLocaleString()}
                                                                    </span>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        disabled={!documents.hasNextPage || documents.endCursor === null}
                                                                        onClick={() => void fetchDocuments(
                                                                            collection.name,
                                                                            { direction: 'next', cursor: documents.endCursor ?? undefined },
                                                                            page + 1
                                                                        )}
                                                                    >
                                                                        Next
                                                                    </Button>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        icon={<ChevronsRight size={16} />}
                                                                        aria-label="Last page"
                                                                        disabled={!documents.hasNextPage}
                                                                        onClick={() => void fetchDocuments(collection.name, { direction: 'last' })}
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className={styles.documents_list}>
                                                                <Table variant="compact">
                                                                    <Thead>
                                                                        <Tr>
                                                                            <Th width="shrink" aria-label="Expand" />
                                                                            <Th>_id</Th>
                                                                            <Th>createdAt</Th>
                                                                            <Th>updatedAt</Th>
                                                                            <Th width="shrink" aria-label="Actions" />
                                                                        </Tr>
                                                                    </Thead>
                                                                    <Tbody>
                                                                        {documents.documents.map((doc, index) => {
                                                                            // Only documents with a real _id can be addressed by the API.
                                                                            // Rows without _id render view-only, with edit and delete
                                                                            // disabled — there is no key to send.
                                                                            const docId = doc._id != null ? String(doc._id) : null;
                                                                            const rowKey = docId ?? `__row_${index}`;
                                                                            const isOpen = expandedDocumentId === rowKey;
                                                                            const isEditing = editingDocumentId === rowKey;
                                                                            return (
                                                                                <Fragment key={rowKey}>
                                                                                    <Tr
                                                                                        isExpanded={isOpen}
                                                                                        onClick={() => toggleDocument(rowKey)}
                                                                                        className={styles.document_row}
                                                                                    >
                                                                                        <Td muted>
                                                                                            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                                                        </Td>
                                                                                        <Td>
                                                                                            <code className={styles.document_id}>{docId ?? '—'}</code>
                                                                                        </Td>
                                                                                        <Td muted>
                                                                                            {doc.createdAt
                                                                                                ? <ClientTime date={doc.createdAt} format="short" />
                                                                                                : '—'}
                                                                                        </Td>
                                                                                        <Td muted>
                                                                                            {doc.updatedAt
                                                                                                ? <ClientTime date={doc.updatedAt} format="short" />
                                                                                                : '—'}
                                                                                        </Td>
                                                                                        <Td>
                                                                                            <div className={styles.row_actions} onClick={(e) => e.stopPropagation()}>
                                                                                                <CopyButton
                                                                                                    value={JSON.stringify(doc, null, 2)}
                                                                                                    aria-label="Copy document JSON"
                                                                                                />
                                                                                                {allowEdit && (
                                                                                                    <Button
                                                                                                        variant="ghost"
                                                                                                        size="sm"
                                                                                                        icon={<Pencil size={16} />}
                                                                                                        aria-label={docId ? 'Edit document' : 'Edit unavailable: document has no _id'}
                                                                                                        disabled={!docId}
                                                                                                        onClick={() => docId && startEditing(rowKey, doc)}
                                                                                                    />
                                                                                                )}
                                                                                                {allowDelete && (
                                                                                                    <Button
                                                                                                        variant="ghost"
                                                                                                        size="sm"
                                                                                                        icon={<Trash2 size={16} />}
                                                                                                        aria-label={docId ? 'Delete document' : 'Delete unavailable: document has no _id'}
                                                                                                        disabled={!docId}
                                                                                                        loading={docId !== null && deletingDocumentId === docId}
                                                                                                        onClick={() => docId && void deleteDocument(collection.name, docId)}
                                                                                                    />
                                                                                                )}
                                                                                            </div>
                                                                                        </Td>
                                                                                    </Tr>
                                                                                    {isOpen && (
                                                                                        <Tr className={styles.document_detail_row}>
                                                                                            <Td colSpan={5}>
                                                                                                {isEditing && docId ? (
                                                                                                    <div className={styles.document_editor}>
                                                                                                        <Textarea
                                                                                                            aria-label={`Edit document ${docId}`}
                                                                                                            value={editDraft}
                                                                                                            onChange={(event) => {
                                                                                                                setEditDraft(event.target.value);
                                                                                                                setEditError(null);
                                                                                                            }}
                                                                                                            rows={16}
                                                                                                            spellCheck={false}
                                                                                                        />
                                                                                                        {editError !== null && (
                                                                                                            <p className={styles.editor_error}>{editError}</p>
                                                                                                        )}
                                                                                                        <div className={styles.editor_actions}>
                                                                                                            <span className={styles.editor_hint}>
                                                                                                                Replaces the whole document. `_id` cannot be changed.
                                                                                                            </span>
                                                                                                            <Button
                                                                                                                variant="ghost"
                                                                                                                size="sm"
                                                                                                                onClick={cancelEditing}
                                                                                                            >
                                                                                                                Cancel
                                                                                                            </Button>
                                                                                                            <Button
                                                                                                                size="sm"
                                                                                                                loading={savingDocumentId === docId}
                                                                                                                onClick={() => void saveDocument(collection.name, docId)}
                                                                                                            >
                                                                                                                Save
                                                                                                            </Button>
                                                                                                        </div>
                                                                                                    </div>
                                                                                                ) : (
                                                                                                    <pre className={styles.document_json}>
                                                                                                        {JSON.stringify(doc, null, 2)}
                                                                                                    </pre>
                                                                                                )}
                                                                                            </Td>
                                                                                        </Tr>
                                                                                    )}
                                                                                </Fragment>
                                                                            );
                                                                        })}
                                                                    </Tbody>
                                                                </Table>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <p className={styles.loading}>No documents loaded</p>
                                                    )}
                                                </div>
                                            </Td>
                                        </Tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </Tbody>
                </Table>
            )}
        </div>
    );
}
