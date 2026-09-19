'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Badge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { Card } from '../../../../../components/ui/Card';
import { Input } from '../../../../../components/ui/Input';
import { Select } from '../../../../../components/ui/Select';
import { StatTile, StatGrid } from '../../../../../components/ui/StatTile';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Plus, Edit, Trash2, Eye, EyeOff, Search, RotateCcw, Clock, XCircle, Archive } from 'lucide-react';
import type { IPage } from '@/types';
import styles from './PagesTab.module.scss';
import { PageEditor } from '../components/PageEditor';

/**
 * Page counts returned with the list. Published and draft counts describe the
 * latest edits of live pages; review and deletion counts come from the core
 * content service.
 */
interface IPageStats {
    total: number;
    published: number;
    drafts: number;
    pendingReview: number;
    deleted: number;
}

/**
 * API response for pages list endpoint.
 */
interface IPagesListResponse {
    pages: IPage[];
    stats: IPageStats;
}

/** The list filters the status dropdown offers. */
type PageListFilter = 'all' | 'published' | 'drafts' | 'pending' | 'deleted';

/**
 * Pages tab - List and edit pages.
 *
 * Provides comprehensive page management including:
 * - List view with search and filtering, including pages awaiting review and
 *   soft-deleted pages
 * - Markdown editor with live preview
 * - Create, update, soft-delete, and restore operations
 * - Review state per page: a change made through the service token or an
 *   automated caller waits in /system/curation while the approved version
 *   stays live
 *
 * Pages are addressed by their core content id. A page the adoption migration
 * has not reached yet has no content id, so it is shown read-only with a note.
 */
export function PagesTab() {
    const [pages, setPages] = useState<IPage[]>([]);
    const [stats, setStats] = useState<IPageStats>({ total: 0, published: 0, drafts: 0, pendingReview: 0, deleted: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [listFilter, setListFilter] = useState<PageListFilter>('all');
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
            if (listFilter === 'published') params.append('published', 'true');
            if (listFilter === 'drafts') params.append('published', 'false');
            if (listFilter === 'pending') params.append('curation', 'pending');
            if (listFilter === 'deleted') params.append('deleted', 'true');

            const response = await fetch(`/api/admin/pages?${params}`, {
                headers: { 'Content-Type': 'application/json' }
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
    }, [searchQuery, listFilter]);

    /**
     * Soft-delete a page by content id.
     *
     * Deletion never removes data and never frees the page's URL, so the
     * confirmation tells the admin how to undo it rather than warning that it
     * is permanent.
     *
     * @param id - The page's core content id
     */
    const deletePage = async (id: string) => {
        if (!confirm('Delete this page? It stops being served, and you can restore it from the Deleted filter. Its URL stays reserved.')) {
            return;
        }

        try {
            const response = await fetch(`/api/admin/pages/${id}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.message || `Failed to delete page: ${response.statusText}`);
            }

            await fetchPages();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete page');
        }
    };

    /**
     * Restore a soft-deleted page by content id, then refresh the list.
     *
     * @param id - The page's core content id
     */
    const restorePage = async (id: string) => {
        try {
            const response = await fetch(`/api/admin/pages/${id}/restore`, {
                method: 'POST'
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.message || `Failed to restore page: ${response.statusText}`);
            }

            await fetchPages();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to restore page');
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
                {/*
                  * Tiles sit inside this card, so they draw no surface of
                  * their own — nested boxes would read as a grid of cards
                  * inside a card.
                  */}
                <StatGrid size="sm">
                    <StatTile size="sm" surface={false} label="Total Pages" value={stats.total} />
                    <StatTile size="sm" surface={false} label="Published" value={stats.published} />
                    <StatTile size="sm" surface={false} label="Drafts" value={stats.drafts} />
                    <StatTile size="sm" surface={false} label="Awaiting Review" value={stats.pendingReview} />
                    <StatTile size="sm" surface={false} label="Deleted" value={stats.deleted} />
                </StatGrid>
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
                    <Select
                        value={listFilter}
                        onChange={e => setListFilter(e.target.value as PageListFilter)}
                        aria-label="Filter pages by status"
                    >
                        <option value="all">All Pages</option>
                        <option value="published">Published Only</option>
                        <option value="drafts">Drafts Only</option>
                        <option value="pending">Awaiting Review</option>
                        <option value="deleted">Deleted</option>
                    </Select>
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
                            <div key={page.contentId ?? page._id} className={styles.page_row}>
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
                                        {page.curation === 'pending' && (
                                            <Badge tone="warning">
                                                <Clock size={12} />
                                                Awaiting review
                                            </Badge>
                                        )}
                                        {page.curation === 'rejected' && (
                                            <Badge tone="danger">
                                                <XCircle size={12} />
                                                Edit rejected
                                            </Badge>
                                        )}
                                        {page.deletedAt && (
                                            <Badge tone="neutral">
                                                <Archive size={12} />
                                                Deleted
                                            </Badge>
                                        )}
                                    </div>
                                    <Link href={page.slug} className={styles.page_slug} target="_blank">
                                        {page.slug}
                                    </Link>
                                    {page.description && (
                                        <p className={styles.page_description}>{page.description}</p>
                                    )}
                                    {(page.curation === 'pending' || page.curation === 'rejected') && page.hasApprovedVersion && (
                                        <p className={styles.page_notice}>
                                            Visitors see the last approved version until this edit is approved. Review it in System → Curation.
                                        </p>
                                    )}
                                    {!page.contentId && (
                                        <p className={styles.page_notice}>
                                            This page predates managed content and cannot be changed until the
                                            migration <code>module:pages:007_adopt_pages_as_managed_content</code> runs
                                            from System → Database.
                                        </p>
                                    )}
                                    <p className={styles.page_meta}>
                                        Updated: <ClientTime date={page.updatedAt} format="date" />
                                    </p>
                                </div>
                                <div className={styles.page_actions}>
                                    {page.contentId && page.deletedAt && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            icon={<RotateCcw size={16} />}
                                            onClick={() => page.contentId && void restorePage(page.contentId)}
                                        >
                                            Restore
                                        </Button>
                                    )}
                                    {page.contentId && !page.deletedAt && (
                                        <>
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
                                                onClick={() => page.contentId && void deletePage(page.contentId)}
                                            >
                                                Delete
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
}
