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

import { useState, useEffect, useCallback } from 'react';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { Database, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import styles from './CollectionBrowser.module.css';

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
    token: string | null;
}

export function CollectionBrowser({ token }: CollectionBrowserProps) {
    const [stats, setStats] = useState<IDatabaseStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedCollection, setExpandedCollection] = useState<string | null>(null);
    const [documents, setDocuments] = useState<IPaginatedDocuments | null>(null);
    const [loadingDocuments, setLoadingDocuments] = useState(false);

    const fetchStats = useCallback(async () => {
        if (!token) return;

        try {
            setLoading(true);
            const response = await fetch('/api/admin/database/stats', {
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-token': token
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
        if (!token) return;

        try {
            setLoadingDocuments(true);
            const response = await fetch(
                `/api/admin/database/collections/${collectionName}/documents?page=${page}&limit=10&sort=-_id`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-admin-token': token
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
        if (expandedCollection === collectionName) {
            setExpandedCollection(null);
            setDocuments(null);
        } else {
            setExpandedCollection(collectionName);
            void fetchDocuments(collectionName);
        }
    };

    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
    };

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
                    {stats.collections.map(collection => (
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
                                                {documents.documents.map((doc, index) => (
                                                    <details key={doc._id || index} className={styles.document}>
                                                        <summary className={styles.document_summary}>
                                                            <code>_id: {String(doc._id)}</code>
                                                        </summary>
                                                        <pre className={styles.document_json}>
                                                            {JSON.stringify(doc, null, 2)}
                                                        </pre>
                                                    </details>
                                                ))}
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
