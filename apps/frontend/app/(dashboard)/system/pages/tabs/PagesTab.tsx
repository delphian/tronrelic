'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { Badge } from '../../../../../components/ui/Badge';
import { Plus, Edit, Trash2, Eye, EyeOff, Search } from 'lucide-react';
import type { IPage } from '@tronrelic/types';
import styles from './PagesTab.module.css';
import { PageEditor } from '../components/PageEditor';

/**
 * API response for pages list endpoint.
 */
interface IPagesListResponse {
    pages: IPage[];
    stats: {
        total: number;
        published: number;
        drafts: number;
    };
}

/**
 * Props for PagesTab component.
 */
interface PagesTabProps {
    token: string;
}

/**
 * Pages tab - List and edit pages.
 *
 * Provides comprehensive page management including:
 * - List view with search and filtering
 * - Markdown editor with live preview
 * - Create, update, and delete operations
 * - Publish/unpublish toggle
 */
export function PagesTab({ token }: PagesTabProps) {
    const [pages, setPages] = useState<IPage[]>([]);
    const [stats, setStats] = useState({ total: 0, published: 0, drafts: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [publishedFilter, setPublishedFilter] = useState<'all' | 'published' | 'drafts'>('all');
    const [editingPage, setEditingPage] = useState<IPage | null>(null);
    const [isCreating, setIsCreating] = useState(false);

    /**
     * Fetch pages list from API.
     *
     * Applies current search and filter criteria, updates component state
     * with results and statistics.
     */
    const fetchPages = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (searchQuery) params.append('search', searchQuery);
            if (publishedFilter === 'published') params.append('published', 'true');
            if (publishedFilter === 'drafts') params.append('published', 'false');

            const response = await fetch(`/api/admin/pages?${params}`, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-token': token
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch pages: ${response.statusText}`);
            }

            const data: IPagesListResponse = await response.json();
            setPages(data.pages);
            setStats(data.stats);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch pages');
        } finally {
            setLoading(false);
        }
    }, [token, searchQuery, publishedFilter]);

    /**
     * Delete a page by ID.
     *
     * Sends DELETE request to API, shows confirmation dialog before proceeding,
     * and refreshes the list after successful deletion.
     *
     * @param id - Page ID to delete
     */
    const deletePage = async (id: string) => {
        if (!confirm('Are you sure you want to delete this page? This action cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(`/api/admin/pages/${id}`, {
                method: 'DELETE',
                headers: {
                    'x-admin-token': token
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to delete page: ${response.statusText}`);
            }

            await fetchPages();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete page');
        }
    };

    /**
     * Handle successful page save from editor.
     *
     * Closes the editor modal and refreshes the pages list to show the
     * newly created or updated page.
     */
    const handlePageSaved = () => {
        setEditingPage(null);
        setIsCreating(false);
        void fetchPages();
    };

    /**
     * Handle editor cancel action.
     *
     * Closes the editor modal without saving changes.
     */
    const handleEditorCancel = () => {
        setEditingPage(null);
        setIsCreating(false);
    };

    // Initial load and refresh on filter changes
    useEffect(() => {
        void fetchPages();
    }, [fetchPages]);

    // Show editor when creating or editing
    if (isCreating || editingPage) {
        return (
            <PageEditor
                token={token}
                page={editingPage}
                onSave={handlePageSaved}
                onCancel={handleEditorCancel}
            />
        );
    }

    if (loading) {
        return (
            <Card padding="lg">
                <p>Loading pages...</p>
            </Card>
        );
    }

    return (
        <div className={styles.container}>
            {/* Stats Summary */}
            <Card padding="md">
                <div className={styles.stats}>
                    <div className={styles.stat}>
                        <span className={styles.stat_label}>Total Pages</span>
                        <span className={styles.stat_value}>{stats.total}</span>
                    </div>
                    <div className={styles.stat}>
                        <span className={styles.stat_label}>Published</span>
                        <span className={styles.stat_value}>{stats.published}</span>
                    </div>
                    <div className={styles.stat}>
                        <span className={styles.stat_label}>Drafts</span>
                        <span className={styles.stat_value}>{stats.drafts}</span>
                    </div>
                </div>
            </Card>

            {/* Error Display */}
            {error && (
                <Card tone="muted" padding="md">
                    <p className={styles.error}>{error}</p>
                </Card>
            )}

            {/* Controls */}
            <Card padding="md">
                <div className={styles.controls}>
                    <div className={styles.search}>
                        <Input
                            type="text"
                            placeholder="Search pages..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className={styles.search_input}
                        />
                        <Search size={20} className={styles.search_icon} />
                    </div>
                    <select
                        value={publishedFilter}
                        onChange={e => setPublishedFilter(e.target.value as typeof publishedFilter)}
                        className={styles.filter_select}
                    >
                        <option value="all">All Pages</option>
                        <option value="published">Published Only</option>
                        <option value="drafts">Drafts Only</option>
                    </select>
                    <Button
                        variant="primary"
                        size="md"
                        icon={<Plus size={18} />}
                        onClick={() => setIsCreating(true)}
                    >
                        New Page
                    </Button>
                </div>
            </Card>

            {/* Pages List */}
            <Card padding="md">
                {pages.length === 0 ? (
                    <div className={styles.empty}>
                        <p>No pages found</p>
                        <Button
                            variant="ghost"
                            size="md"
                            icon={<Plus size={18} />}
                            onClick={() => setIsCreating(true)}
                        >
                            Create your first page
                        </Button>
                    </div>
                ) : (
                    <div className={styles.pages_list}>
                        {pages.map(page => (
                            <div key={page._id} className={styles.page_row}>
                                <div className={styles.page_info}>
                                    <div className={styles.page_header}>
                                        <h3 className={styles.page_title}>{page.title}</h3>
                                        <Badge tone={page.published ? 'success' : 'neutral'}>
                                            {page.published ? (
                                                <>
                                                    <Eye size={12} />
                                                    Published
                                                </>
                                            ) : (
                                                <>
                                                    <EyeOff size={12} />
                                                    Draft
                                                </>
                                            )}
                                        </Badge>
                                    </div>
                                    <p className={styles.page_slug}>{page.slug}</p>
                                    {page.description && (
                                        <p className={styles.page_description}>{page.description}</p>
                                    )}
                                    <p className={styles.page_meta}>
                                        Updated: {new Date(page.updatedAt).toLocaleDateString()}
                                    </p>
                                </div>
                                <div className={styles.page_actions}>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        icon={<Edit size={16} />}
                                        onClick={() => setEditingPage(page)}
                                    >
                                        Edit
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        icon={<Trash2 size={16} />}
                                        onClick={() => page._id && deletePage(page._id)}
                                    >
                                        Delete
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
}
