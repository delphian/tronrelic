'use client';

/**
 * Collection browser component for MongoDB database admin interface.
 *
 * Provides browsing of all database collections with document viewing capabilities.
 * Displays collection statistics (count, size, indexes) and allows pagination through documents.
 *
 * Why this component exists:
 * - Administrators need visibility into database contents without external tools
 * - Collection statistics help identify large collections and storage usage
 * - Document viewing enables quick debugging and data verification
 */

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { CopyButton } from '../../../../../components/ui/CopyButton';
import { useToast } from '../../../../../components/ui/ToastProvider/ToastProvider';
import { config as runtimeConfig } from '../../../../../lib/config';
import { Database, ChevronDown, ChevronRight, FileText, Trash2 } from 'lucide-react';
import styles from './CollectionBrowser.module.scss';

interface ICollectionStat {
    name: string;
    count: number;
    size: number;
    avgObjSize: number;
    indexes: number;
}

interface IDatabaseStats {
    dbName: string;
    totalSize: number;
    collections: ICollectionStat[];
}

interface IPaginatedDocuments {
    documents: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
}

interface CollectionBrowserProps {
    token: string;
}

export function CollectionBrowser({ token }: CollectionBrowserProps) {
    const [stats, setStats] = useState<IDatabaseStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedCollection, setExpandedCollection] = useState<string | null>(null);
    const [documents, setDocuments] = useState<IPaginatedDocuments | null>(null);
    const [loadingDocuments, setLoadingDocuments] = useState(false);
    const [expandedDocumentId, setExpandedDocumentId] = useState<string | null>(null);
    const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
    const { push: pushToast } = useToast();

    // SystemAuthGate guarantees a non-empty token at this depth, so the
    // fetch helpers do not gate on token. Gating without resetting the
    // loading flags would strand the panel in a permanent loading state.

    const fetchStats = useCallback(async () => {
        try {
            setLoading(true);
            const response = await fetch(`${runtimeConfig.apiBaseUrl}/admin/database/stats`, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                }
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
    }, [token]);

    const fetchDocuments = useCallback(async (collectionName: string, page: number = 1) => {
        try {
            setLoadingDocuments(true);
            const response = await fetch(
                `${runtimeConfig.apiBaseUrl}/admin/database/collections/${collectionName}/documents?page=${page}&limit=10&sort=-_id`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Admin-Token': token
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch documents: ${response.statusText}`);
            }

            const result = await response.json();
            setDocuments(result.data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch documents');
        } finally {
            setLoadingDocuments(false);
        }
    }, [token]);

    useEffect(() => {
        void fetchStats();
    }, [fetchStats]);

    const toggleCollection = (collectionName: string) => {
        setExpandedDocumentId(null);
        if (expandedCollection === collectionName) {
            setExpandedCollection(null);
            setDocuments(null);
        } else {
            setExpandedCollection(collectionName);
            void fetchDocuments(collectionName);
        }
    };

    const toggleDocument = (documentId: string) => {
        setExpandedDocumentId(prev => (prev === documentId ? null : documentId));
    };

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
                `${runtimeConfig.apiBaseUrl}/admin/database/collections/${collectionName}/documents/${encodeURIComponent(documentId)}`,
                {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Admin-Token': token
                    }
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

            // Refresh the current page of documents and the top-level counts.
            const currentPage = documents?.page ?? 1;
            await Promise.all([
                fetchDocuments(collectionName, currentPage),
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
    }, [token, pushToast, expandedDocumentId, documents?.page, fetchDocuments, fetchStats]);

    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
    };

    const sortedCollections = useMemo(
        () => [...(stats?.collections ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
        [stats?.collections]
    );

    if (loading) {
        return (
            <Card>
                <p>Loading database statistics...</p>
            </Card>
        );
    }

    if (error) {
        return (
            <Card tone="muted">
                <p style={{ color: 'var(--color-danger)' }}>{error}</p>
            </Card>
        );
    }

    if (!stats) {
        return (
            <Card>
                <p>No database statistics available</p>
            </Card>
        );
    }

    return (
        <div className={styles.browser}>
            {/* Database Overview */}
            <Card padding="lg">
                <div className={styles.overview}>
                    <Database size={24} />
                    <div>
                        <h3 className={styles.overview_title}>{stats.dbName}</h3>
                        <p className={styles.overview_subtitle}>
                            {stats.collections.length} collections • {formatBytes(stats.totalSize)} total size
                        </p>
                    </div>
                </div>
            </Card>

            {/* Collections List */}
            <Card padding="lg">
                <h3 className={styles.section_title}>Collections</h3>
                <div className={styles.collections}>
                    {sortedCollections.map(collection => (
                        <div key={collection.name} className={styles.collection_item}>
                            <button
                                className={styles.collection_header}
                                onClick={() => toggleCollection(collection.name)}
                                aria-expanded={expandedCollection === collection.name}
                            >
                                {expandedCollection === collection.name ? (
                                    <ChevronDown size={16} />
                                ) : (
                                    <ChevronRight size={16} />
                                )}
                                <FileText size={16} />
                                <span className={styles.collection_name}>{collection.name}</span>
                                <div className={styles.collection_stats}>
                                    <Badge tone="neutral">{collection.count.toLocaleString()} docs</Badge>
                                    <Badge tone="neutral">{formatBytes(collection.size)}</Badge>
                                    <Badge tone="neutral">{collection.indexes} indexes</Badge>
                                </div>
                            </button>

                            {expandedCollection === collection.name && (
                                <div className={styles.documents_panel}>
                                    {loadingDocuments ? (
                                        <p className={styles.loading}>Loading documents...</p>
                                    ) : documents ? (
                                        <>
                                            <div className={styles.documents_header}>
                                                <span>
                                                    Showing {documents.documents.length} of {documents.total} documents
                                                </span>
                                                <div className={styles.pagination}>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={!documents.hasPrevPage}
                                                        onClick={() => void fetchDocuments(collection.name, documents.page - 1)}
                                                    >
                                                        Previous
                                                    </Button>
                                                    <span className={styles.page_info}>
                                                        Page {documents.page} of {documents.totalPages}
                                                    </span>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={!documents.hasNextPage}
                                                        onClick={() => void fetchDocuments(collection.name, documents.page + 1)}
                                                    >
                                                        Next
                                                    </Button>
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
                                                            // Rows without _id render view-only with delete disabled.
                                                            const docId = doc._id != null ? String(doc._id) : null;
                                                            const rowKey = docId ?? `__row_${index}`;
                                                            const isOpen = expandedDocumentId === rowKey;
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
                                                                                    ariaLabel="Copy document JSON"
                                                                                />
                                                                                <Button
                                                                                    variant="ghost"
                                                                                    size="sm"
                                                                                    icon={<Trash2 size={16} />}
                                                                                    aria-label={docId ? 'Delete document' : 'Delete unavailable: document has no _id'}
                                                                                    disabled={!docId}
                                                                                    loading={docId !== null && deletingDocumentId === docId}
                                                                                    onClick={() => docId && void deleteDocument(collection.name, docId)}
                                                                                />
                                                                            </div>
                                                                        </Td>
                                                                    </Tr>
                                                                    {isOpen && (
                                                                        <Tr className={styles.document_detail_row}>
                                                                            <Td colSpan={5}>
                                                                                <pre className={styles.document_json}>
                                                                                    {JSON.stringify(doc, null, 2)}
                                                                                </pre>
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
                                        <p>No documents loaded</p>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );
}
