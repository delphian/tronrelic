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
 * section to inspect the plugin's data. Without a prefix it shows the whole
 * database for the system console. A scoped browser lists each collection
 * without the prefix and states the prefix once in its header, because the
 * same 20-odd characters on every row wrapped each name on a phone.
 *
 * Editing replaces the whole document rather than patching fields, because the
 * editor is a JSON blob: what the operator sees is what gets written, including
 * fields they removed. `_id` is not editable — the API discards it — so a save
 * either replaces a document in place or fails, and can never silently re-key.
 *
 * The inventory is a real table with sortable columns rather than a list of
 * rows carrying badges. Document count and stored size are quantities an
 * operator compares across collections — which one grew, which one is worth an
 * index — and a column of right-aligned figures answers that by scanning. The
 * browser draws its own panel card, shared with the ClickHouse browser, so do
 * not wrap it in another card.
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
import { AlertCircle, ChevronDown, ChevronRight, Trash2, Pencil } from 'lucide-react';
import { BrowserPanel, type IBrowserSummary } from '../BrowserPanel';
import { BrowserPager } from '../BrowserPager';
import { InventoryTable, InventoryRow } from '../InventoryTable';
import { useInventorySort } from '../../hooks/useInventorySort';
import { stripNamePrefix } from '../../lib/stripNamePrefix';
import { formatCount } from '../../lib/formatCount';
import type { IInventoryColumn } from '../../types/IInventoryColumn';
import type { IInventorySort } from '../../types/IInventorySort';
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

/**
 * The sortable columns of the collection table.
 *
 * The numeric columns open descending because the question an operator brings
 * to this table is nearly always "what is biggest" — which collection is eating
 * disk, which document count explains a slow query. Name opens ascending, which
 * is plain alphabetical order and the table's resting state.
 */
const COLLECTION_COLUMNS: ReadonlyArray<IInventoryColumn<CollectionSortKey>> = [
    { key: 'name', label: 'Collection', numeric: false, initialDirection: 'asc' },
    { key: 'count', label: 'Documents', numeric: true, initialDirection: 'desc' },
    { key: 'size', label: 'Size', numeric: true, initialDirection: 'desc' },
    { key: 'indexes', label: 'Indexes', numeric: true, initialDirection: 'desc' }
];

/** Where the table rests before the operator sorts it: alphabetical by name. */
const DEFAULT_SORT: IInventorySort<CollectionSortKey> = { key: 'name', direction: 'asc' };

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
function compareCollections(
    a: ICollectionStat,
    b: ICollectionStat,
    sort: IInventorySort<CollectionSortKey>
): number {
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
 */
function displayedTotalPages(totalPages: number, page: number): number {
    return Math.max(totalPages, page, 1);
}

/**
 * Render the collection browser.
 *
 * @param prefix - Namespace to scope to; omit for the whole database. Listed
 * names are shown without it, and the header states it once.
 * @param allowEdit - Whether the edit affordance is offered.
 * @param allowDelete - Whether the delete affordance is offered.
 * @param title - Title of the browser's panel; "Collections" when omitted. In
 * the collapsible form it doubles as the control that opens the browser.
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
    const { sort, toggleSort } = useInventorySort(COLLECTION_COLUMNS, DEFAULT_SORT);
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

    // The prefix as a usable value, or undefined for the unscoped view. An
    // empty string is treated as no prefix, matching what the API does with it.
    const scopePrefix = typeof prefix === 'string' && prefix.length > 0 ? prefix : undefined;

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
            const query = scopePrefix !== undefined
                ? `?prefix=${encodeURIComponent(scopePrefix)}`
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
    }, [scopePrefix]);

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
     * @param collectionName - Collection whose current page to reload.
     */
    const refreshCurrentPage = useCallback((collectionName: string) => {
        return fetchDocuments(collectionName, pageRequest, page);
    }, [fetchDocuments, pageRequest, page]);

    /**
     * Fetch the statistics once the browser is open, and again when its scope
     * changes.
     *
     * A collapsed browser does not fetch. The statistics request runs one
     * `collStats` command per collection in scope, and the unscoped system
     * console view covers every collection in the deployment, so sending it for
     * a panel nobody opened is real work spent on nothing. The trade is that
     * opening the browser costs a round trip; the loading line covers it.
     */
    useEffect(() => {
        if (!isCollapsed) {
            void fetchStats();
        }
    }, [isCollapsed, fetchStats]);

    /**
     * Open a collection's documents, or close them if it is the open one.
     *
     * Any open or edited document belongs to the previous collection, so both
     * are cleared before the switch.
     *
     * @param collectionName - The collection the operator clicked.
     */
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

    /**
     * Unfold a document's full JSON, or fold it back up if it is the open one.
     *
     * @param documentId - Row key of the document the operator clicked.
     */
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

    /**
     * Delete a document after the operator confirms it.
     *
     * The confirmation names the document and the collection, because the
     * delete cannot be undone. Afterwards the operator stays on the page they
     * were on, and the inventory's counts are refreshed with it.
     *
     * @param collectionName - Collection owning the document.
     * @param documentId - The document's `_id`.
     */
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

    /** The inventory in the order the active sort asks for, copied so state is never sorted in place. */
    const sortedCollections = useMemo(
        () => [...(stats?.collections ?? [])].sort((a, b) => compareCollections(a, b, sort)),
        [stats?.collections, sort]
    );

    // The header's summary line. Kept once the statistics have loaded, so a
    // browser closed again after being opened still says what it holds.
    const summary: IBrowserSummary | null = stats === null ? null : {
        databases: [stats.dbName],
        prefix: scopePrefix,
        count: stats.collections.length,
        singular: 'collection',
        plural: 'collections',
        totalSize: stats.totalSize
    };

    /**
     * Build the documents panel shown beneath an open collection.
     *
     * Only the open collection calls this, so `documents` and the paging state
     * always belong to it.
     *
     * @param collectionName - The open collection.
     * @returns The page bar and the page's documents, or the loading, error, or
     * empty message in their place.
     */
    const renderDocuments = (collectionName: string): ReactNode => (
        <div className={styles.documents_panel}>
            {documentsError !== null && (
                <div className="alert alert--danger" role="alert">
                    <span className={styles.error_inline}>
                        <AlertCircle size={14} aria-hidden="true" />
                        {documentsError}
                    </span>
                </div>
            )}
            {loadingDocuments && <p className={styles.message}>Loading documents…</p>}
            {!loadingDocuments && documents === null && (
                <p className={styles.message}>No documents loaded</p>
            )}
            {!loadingDocuments && documents !== null && (
                <>
                    {/* First is gated on position, not on `hasPrevPage`. It is an
                      * absolute anchor needing no cursor, so it stays meaningful
                      * where a relative step cannot go: a `prev` landing on a page
                      * emptied by concurrent deletes returns no cursors and both
                      * flags false, and gating on the flag would disable every
                      * control at once — stranding the operator on a blank table. */}
                    <BrowserPager
                        summary={formatCount(documents.total, 'document', 'documents')}
                        page={page}
                        totalPages={displayedTotalPages(documents.totalPages, page)}
                        canFirst={page > 1}
                        canPrevious={documents.hasPrevPage && documents.startCursor !== null}
                        canNext={documents.hasNextPage && documents.endCursor !== null}
                        canLast={documents.hasNextPage}
                        onFirst={() => void fetchDocuments(collectionName, FIRST_PAGE, 1)}
                        onPrevious={() => void fetchDocuments(
                            collectionName,
                            { direction: 'prev', cursor: documents.startCursor ?? undefined },
                            page - 1
                        )}
                        onNext={() => void fetchDocuments(
                            collectionName,
                            { direction: 'next', cursor: documents.endCursor ?? undefined },
                            page + 1
                        )}
                        onLast={() => void fetchDocuments(collectionName, { direction: 'last' })}
                    />
                    <Table variant="compact" stackAt="mobile">
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
                                        >
                                            <Td muted>
                                                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                            </Td>
                                            <Td>
                                                <code className={styles.document_id}>{docId ?? '—'}</code>
                                            </Td>
                                            <Td muted label="createdAt">
                                                {doc.createdAt
                                                    ? <ClientTime date={doc.createdAt} format="short" />
                                                    : '—'}
                                            </Td>
                                            <Td muted label="updatedAt">
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
                                                            icon={<Pencil size={16} />}
                                                            aria-label={docId ? 'Edit document' : 'Edit unavailable: document has no _id'}
                                                            disabled={!docId}
                                                            onClick={() => docId && startEditing(rowKey, doc)}
                                                        />
                                                    )}
                                                    {allowDelete && (
                                                        <Button
                                                            variant="ghost"
                                                            icon={<Trash2 size={16} />}
                                                            aria-label={docId ? 'Delete document' : 'Delete unavailable: document has no _id'}
                                                            disabled={!docId}
                                                            loading={docId !== null && deletingDocumentId === docId}
                                                            onClick={() => docId && void deleteDocument(collectionName, docId)}
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
                                                                <Button variant="ghost" onClick={cancelEditing}>
                                                                    Cancel
                                                                </Button>
                                                                <Button
                                                                    loading={savingDocumentId === docId}
                                                                    onClick={() => void saveDocument(collectionName, docId)}
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
                </>
            )}
        </div>
    );

    // What the panel shows beneath its header. Every state keeps the header,
    // because in the collapsible form the heading is the disclosure control:
    // dropping it with a failed request would leave an error on screen the
    // operator could no longer close.
    let body: ReactNode = null;
    if (isCollapsed) {
        body = null;
    } else if (loading) {
        body = <p className={styles.message}>Loading database statistics…</p>;
    } else if (error) {
        body = (
            <div className="alert alert--danger" role="alert">
                <span className={styles.error_inline}>
                    <AlertCircle size={14} aria-hidden="true" />
                    {error}
                </span>
            </div>
        );
    } else if (!stats) {
        body = <p className={styles.message}>No database statistics available</p>;
    } else if (sortedCollections.length === 0) {
        body = (
            <p className={styles.message}>
                {scopePrefix !== undefined ? `No collections found for ${scopePrefix}` : 'No collections found'}
            </p>
        );
    } else {
        body = (
            <InventoryTable
                columns={COLLECTION_COLUMNS}
                sort={sort}
                onSort={toggleSort}
                rowCount={sortedCollections.length}
            >
                {sortedCollections.map(collection => {
                    const isCollectionOpen = expandedCollection === collection.name;
                    return (
                        <InventoryRow
                            key={collection.name}
                            name={collection.name}
                            label={stripNamePrefix(collection.name, scopePrefix)}
                            expanded={isCollectionOpen}
                            onToggle={() => toggleCollection(collection.name)}
                            figures={[
                                {
                                    key: 'count',
                                    value: collection.count.toLocaleString(),
                                    summary: formatCount(collection.count, 'doc', 'docs'),
                                    numeric: true
                                },
                                {
                                    key: 'size',
                                    value: formatBytes(collection.size),
                                    summary: formatBytes(collection.size),
                                    numeric: true
                                },
                                {
                                    key: 'indexes',
                                    value: collection.indexes.toLocaleString(),
                                    summary: formatCount(collection.indexes, 'index', 'indexes'),
                                    numeric: true
                                }
                            ]}
                        >
                            {isCollectionOpen ? renderDocuments(collection.name) : null}
                        </InventoryRow>
                    );
                })}
            </InventoryTable>
        );
    }

    return (
        <BrowserPanel
            title={title ?? 'Collections'}
            collapsible={collapsible}
            collapsed={collapsed}
            onToggle={() => setCollapsed(previous => !previous)}
            summary={summary}
        >
            {body}
        </BrowserPanel>
    );
}
