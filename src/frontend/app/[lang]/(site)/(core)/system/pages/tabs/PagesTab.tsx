'use client';

/**
 * @fileoverview Pages tab of /system/pages: the page list, and the editor and
 * translation editor it opens.
 *
 * The list is paged on the server, 25 pages at a time, and the search and
 * status filter are applied there too, so a CMS of any size draws one short
 * table of two-line rows. Each page, each search, and each filter change is
 * fetched when the admin asks, which is the user-triggered loading the SSR
 * rule allows. Review
 * state comes from the core content service: a change made through the
 * service token or an automated caller waits in /system/curation while the
 * approved version stays live, and the row says so in a warning badge whose
 * tooltip explains it.
 *
 * Pages are addressed by their core content id. A page the adoption migration
 * has not reached yet has no content id, so it is shown read-only with a badge
 * saying why.
 */

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { Plus, Edit, Trash2, RotateCcw, Languages } from 'lucide-react';
import type { IContentTranslationStatus, IPage } from '@/types';
import { Badge } from '../../../../../../../components/ui/Badge';
import { Button } from '../../../../../../../components/ui/Button';
import { ClientTime } from '../../../../../../../components/ui/ClientTime';
import { IconButton } from '../../../../../../../components/ui/IconButton';
import { Input } from '../../../../../../../components/ui/Input';
import { Pagination } from '../../../../../../../components/ui/Pagination';
import { Panel } from '../../../../../../../components/ui/Panel';
import { Select } from '../../../../../../../components/ui/Select';
import { StatTile, StatGrid } from '../../../../../../../components/ui/StatTile';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../../components/ui/Table';
import { Tooltip } from '../../../../../../../components/ui/Tooltip';
import { ContentTranslations, getTranslationStatuses, TranslationStatusBadges } from '../../../../../../../modules/content';
import { PageEditor } from '../components/PageEditor';
import styles from './PagesTab.module.scss';

/** Pages listed per page of the table. */
const PAGE_SIZE = 25;

/**
 * How long typing must pause before the search is sent, so a search is one
 * request for the finished text rather than one per keystroke.
 */
const SEARCH_DELAY_MS = 300;

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

/** API response for the pages list endpoint: one page of pages, their total, and the counts. */
interface IPagesListResponse {
    pages: IPage[];
    total: number;
    stats: IPageStats;
}

/** The list filters the status dropdown offers. */
type PageListFilter = 'all' | 'published' | 'drafts' | 'pending' | 'deleted';

/**
 * Loads one page of the list. Named so the loader can be typed before it is
 * defined, which it needs because it calls itself to recover from a page
 * number that ran past the end of the results.
 */
type PageListLoader = (nextPage: number, nextSearch: string, nextFilter: PageListFilter) => Promise<void>;

/**
 * Render a translated page body for the translation editor's preview, through
 * the same endpoint the page editor uses so the two previews cannot disagree.
 *
 * @param markdown - The translated body, without frontmatter.
 * @returns The rendered HTML.
 * @throws Error with the server's message when rendering fails.
 */
async function renderPagePreview(markdown: string): Promise<string> {
    const response = await fetch('/api/admin/pages/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: markdown })
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || data.error || 'Failed to generate preview');
    }
    const data: { html: string } = await response.json();

    return data.html;
}

/**
 * Build the list request's query string for one page of a search and filter.
 *
 * @param page - The page to load, counting from 1.
 * @param search - The search text, already trimmed; blank for none.
 * @param filter - The status filter.
 * @returns The query string, without the leading `?`.
 */
function listQuery(page: number, search: string, filter: PageListFilter): string {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), skip: String((page - 1) * PAGE_SIZE) });
    if (search) params.set('search', search);
    if (filter === 'published') params.set('published', 'true');
    if (filter === 'drafts') params.set('published', 'false');
    if (filter === 'pending') params.set('curation', 'pending');
    if (filter === 'deleted') params.set('deleted', 'true');

    return params.toString();
}

/**
 * Describe the rows on screen and how many match in all, for the panel's
 * header line.
 *
 * @param page - The page shown, counting from 1.
 * @param shown - Rows on that page.
 * @param total - Rows matching the search and filter across every page.
 * @returns A phrase such as "26–50 of 61 pages".
 */
function describeRange(page: number, shown: number, total: number): string {
    const first = (page - 1) * PAGE_SIZE + 1;
    const noun = total === 1 ? 'page' : 'pages';

    return shown === 0 ? `0 of ${total} ${noun}` : `${first}–${first + shown - 1} of ${total} ${noun}`;
}

/**
 * The review and adoption badges for one row: published or draft, whether an
 * edit waits for review or was rejected, whether the page is deleted, and
 * whether it predates managed content. A badge whose meaning needs a sentence
 * carries it in a tooltip, so the row stays one line.
 *
 * @param page - The listed page.
 * @returns The badges.
 */
function StatusBadges({ page }: { page: IPage }) {
    const servingApproved = page.hasApprovedVersion === true;
    return (
        <span className={styles.badges}>
            <Badge tone={page.published ? 'success' : 'neutral'} size="xs">
                {page.published ? 'Published' : 'Draft'}
            </Badge>
            {page.curation === 'pending' && (
                <Tooltip content={servingApproved
                    ? 'Visitors see the last approved version until this edit is approved. Review it in System → Curation.'
                    : 'Nothing is served at this address until a curator approves the page in System → Curation.'}
                >
                    <Badge tone="warning" size="xs">Awaiting review</Badge>
                </Tooltip>
            )}
            {page.curation === 'rejected' && (
                <Tooltip content={servingApproved
                    ? 'A curator rejected the latest edit. Visitors still see the last approved version.'
                    : 'A curator rejected this page, so nothing is served at its address.'}
                >
                    <Badge tone="danger" size="xs">Edit rejected</Badge>
                </Tooltip>
            )}
            {page.deletedAt && <Badge tone="neutral" size="xs">Deleted</Badge>}
            {!page.contentId && (
                <Tooltip content="This page predates managed content and cannot be changed until the migration module:pages:007_adopt_pages_as_managed_content runs from System → Database.">
                    <Badge tone="warning" size="xs">Not adopted</Badge>
                </Tooltip>
            )}
        </span>
    );
}

/**
 * Pages tab — the paged page list with its counts, search, and status filter,
 * and the page and translation editors it opens in place of the list.
 *
 * @returns The tab.
 */
export function PagesTab() {
    const [pages, setPages] = useState<IPage[]>([]);
    const [total, setTotal] = useState(0);
    const [stats, setStats] = useState<IPageStats | null>(null);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [searchDraft, setSearchDraft] = useState('');
    const [listFilter, setListFilter] = useState<PageListFilter>('all');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingPage, setEditingPage] = useState<IPage | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [translatingPage, setTranslatingPage] = useState<(IPage & { contentId: string }) | null>(null);
    // Null until loaded, and left null when the request fails, so a row never
    // claims a page has no translations when the answer is unknown.
    const [translationStatuses, setTranslationStatuses] = useState<Record<string, IContentTranslationStatus[]> | null>(null);
    // Numbers each list request so only the newest one's answer is shown, and a
    // slow answer to an older search cannot replace the rows of a newer one.
    const latestRequest = useRef(0);

    /**
     * Load the translation status of every listed page, so the list shows
     * which languages each page is live in without opening its editor. Runs
     * after the list itself, and a failure only hides the status badges.
     *
     * @param listed - The pages just loaded.
     */
    const loadTranslationStatuses = useCallback(async (listed: IPage[]) => {
        const ids = listed.map((listedPage) => listedPage.contentId).filter((id): id is string => Boolean(id));
        try {
            setTranslationStatuses(await getTranslationStatuses('core:page', ids));
        } catch {
            setTranslationStatuses(null);
        }
    }, []);

    /**
     * Fetch one page of the list for a search and filter and show it, with
     * the counts above it.
     *
     * A page number chosen before the request can be past the end of the
     * results by the time the answer arrives, because a save, a deletion, or
     * another admin's change can take rows out of the current filter. The pager
     * hides itself once the remaining rows fit one page, so showing that empty
     * page would leave the rest of the list unreachable. The loader therefore
     * asks for the last page that still exists instead of showing nothing.
     *
     * @param nextPage - The page to show, counting from 1.
     * @param nextSearch - The search text the rows must match, or blank.
     * @param nextFilter - The status filter.
     */
    const load: PageListLoader = useCallback(async (nextPage: number, nextSearch: string, nextFilter: PageListFilter): Promise<void> => {
        const request = ++latestRequest.current;
        setLoading(true);
        try {
            const response = await fetch(`/api/admin/pages?${listQuery(nextPage, nextSearch, nextFilter)}`, {
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch pages: ${response.statusText}`);
            }
            const data: IPagesListResponse = await response.json();
            const isPastEnd = data.pages.length === 0 && data.total > 0 && (nextPage - 1) * PAGE_SIZE >= data.total;
            if (request === latestRequest.current && isPastEnd) {
                void load(Math.ceil(data.total / PAGE_SIZE), nextSearch, nextFilter);
            } else if (request === latestRequest.current) {
                setPages(data.pages);
                setTotal(data.total);
                setStats(data.stats);
                setPage(nextPage);
                setSearch(nextSearch);
                setListFilter(nextFilter);
                setError(null);
                void loadTranslationStatuses(data.pages);
            }
        } catch (err) {
            if (request === latestRequest.current) {
                setError(err instanceof Error ? err.message : 'Failed to fetch pages');
            }
        } finally {
            if (request === latestRequest.current) {
                setLoading(false);
            }
        }
    }, [loadTranslationStatuses]);

    /**
     * Reload the page on screen after a change that can remove a row from it,
     * stepping back a page when the change emptied the last one.
     *
     * @param removed - How many rows the change took off this view.
     */
    const reload = useCallback((removed: number): void => {
        const lastPage = Math.max(1, Math.ceil(Math.max(0, total - removed) / PAGE_SIZE));
        void load(Math.min(page, lastPage), search, listFilter);
    }, [load, total, page, search, listFilter]);

    /** Load the first page once the tab mounts. */
    useEffect(() => {
        void load(1, '', 'all');
    }, [load]);

    /**
     * Send the search once typing pauses. A draft that matches the search
     * already shown sends nothing, which keeps the first render from fetching
     * twice.
     *
     * @returns Cleanup that cancels a search still waiting for the pause.
     */
    useEffect(() => {
        const next = searchDraft.trim();
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (next !== search) {
            timer = setTimeout(
                /** Search from the first page, since the old page number means nothing for new results. */
                () => { void load(1, next, listFilter); },
                SEARCH_DELAY_MS
            );
        }
        return () => {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        };
    }, [searchDraft, search, listFilter, load]);

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

            reload(1);
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

            reload(1);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to restore page');
        }
    };

    /** Close the editor and refresh the list after a successful save. */
    const handlePageSaved = () => {
        setEditingPage(null);
        setIsCreating(false);
        reload(0);
    };

    /** Close the editor without saving changes. */
    const handleEditorCancel = () => {
        setEditingPage(null);
        setIsCreating(false);
    };

    /**
     * Show another page of the same search and filter.
     *
     * @param nextPage - The page the pager asked for.
     */
    const handlePageChange = useCallback((nextPage: number): void => {
        void load(nextPage, search, listFilter);
    }, [load, search, listFilter]);

    /**
     * Switch the status filter and load its first page. The dropdown shows the
     * new choice at once rather than waiting for the answer.
     *
     * @param nextFilter - The filter the admin picked.
     */
    const handleFilterChange = useCallback((nextFilter: PageListFilter): void => {
        setListFilter(nextFilter);
        void load(1, search, nextFilter);
    }, [load, search]);

    // Show the translation editor for one page. Core manages translations of
    // every content type; pages supplies the preview renderer for its body.
    if (translatingPage) {
        return (
            <ContentTranslations
                typeId="core:page"
                contentId={translatingPage.contentId}
                title={translatingPage.title}
                publicPath={translatingPage.slug}
                renderPreview={renderPagePreview}
                onClose={() => setTranslatingPage(null)}
            />
        );
    }

    // Show the editor when creating or editing.
    if (isCreating || editingPage) {
        return (
            <PageEditor
                page={editingPage}
                onSave={handlePageSaved}
                onCancel={handleEditorCancel}
            />
        );
    }

    const filtered = search !== '' || listFilter !== 'all';
    let body: ReactNode;
    if (stats === null) {
        body = error ? null : <p className={styles.placeholder}>Loading pages…</p>;
    } else if (pages.length === 0) {
        body = (
            <div className={styles.placeholder}>
                {filtered ? (
                    <p>No pages match this search and filter.</p>
                ) : (
                    <>
                        <p>No pages yet.</p>
                        <Button variant="ghost" icon={<Plus size={18} />} onClick={() => setIsCreating(true)}>
                            Create your first page
                        </Button>
                    </>
                )}
            </div>
        );
    } else {
        // Four columns fit a tablet; on a phone each page stacks into an entry
        // led by its title. The translations sit under the title, which is
        // where the shared badge row is designed to go: it carries its own
        // "Translations:" label, which a column of its own would repeat on
        // every row under the column header. A page with no translation shows
        // no line rather than saying so. The table is the panel's last child
        // so `flush` can run it to the card's edges.
        body = (
            <Table variant="compact" flush stackAt="mobile">
                <Thead>
                    <Tr>
                        <Th scope="col" width="expand">Page</Th>
                        <Th scope="col" width="shrink">Status</Th>
                        <Th scope="col" width="shrink">Updated</Th>
                        <Th scope="col" width="shrink"><span className={styles.sr_only}>Actions</span></Th>
                    </Tr>
                </Thead>
                <Tbody>
                    {pages.map(listed => {
                        const statuses = listed.contentId && translationStatuses
                            ? (translationStatuses[listed.contentId] ?? []).filter(status => !status.deleted)
                            : [];
                        return (
                            <Tr key={listed.contentId ?? listed._id}>
                                <Td>
                                    <div className={styles.title_cell}>
                                        <div className={styles.title_line}>
                                            <span className={styles.page_title}>{listed.title}</span>
                                            <Link href={listed.slug} className={styles.page_slug} target="_blank">
                                                {listed.slug}
                                            </Link>
                                        </div>
                                        {statuses.length > 0 && <TranslationStatusBadges statuses={statuses} />}
                                    </div>
                                </Td>
                                <Td label="Status">
                                    <StatusBadges page={listed} />
                                </Td>
                                <Td muted label="Updated">
                                    <ClientTime date={listed.updatedAt} format="short" />
                                </Td>
                                <Td>
                                    <div className={styles.actions}>
                                        {listed.contentId && listed.deletedAt && (
                                            <Button
                                                variant="ghost"
                                                size="xs"
                                                icon={<RotateCcw size={14} />}
                                                onClick={() => listed.contentId && void restorePage(listed.contentId)}
                                            >
                                                Restore
                                            </Button>
                                        )}
                                        {listed.contentId && !listed.deletedAt && (
                                            <>
                                                <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    icon={<Edit size={14} />}
                                                    onClick={() => setEditingPage(listed)}
                                                >
                                                    Edit
                                                </Button>
                                                <IconButton
                                                    variant="primary"
                                                    size="sm"
                                                    aria-label={`Translations of ${listed.title}`}
                                                    title="Translations"
                                                    onClick={() => listed.contentId && setTranslatingPage({ ...listed, contentId: listed.contentId })}
                                                >
                                                    <Languages size={16} aria-hidden="true" />
                                                </IconButton>
                                                <IconButton
                                                    variant="danger"
                                                    size="sm"
                                                    aria-label={`Delete ${listed.title}`}
                                                    title="Delete"
                                                    onClick={() => listed.contentId && void deletePage(listed.contentId)}
                                                >
                                                    <Trash2 size={16} aria-hidden="true" />
                                                </IconButton>
                                            </>
                                        )}
                                    </div>
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
            {stats && (
                <StatGrid size="sm">
                    <StatTile size="sm" label="Total pages" value={stats.total} />
                    <StatTile size="sm" label="Published" value={stats.published} />
                    <StatTile size="sm" label="Drafts" value={stats.drafts} />
                    <StatTile size="sm" label="Awaiting review" value={stats.pendingReview} />
                    <StatTile size="sm" label="Deleted" value={stats.deleted} />
                </StatGrid>
            )}

            <Panel
                title="Pages"
                meta={loading ? 'Loading…' : describeRange(page, pages.length, total)}
                actions={(
                    <Pagination total={total} pageSize={PAGE_SIZE} currentPage={page} onPageChange={handlePageChange} />
                )}
            >
                <div className={styles.controls}>
                    <Input
                        type="search"
                        placeholder="Search titles, slugs, descriptions"
                        value={searchDraft}
                        onChange={e => setSearchDraft(e.target.value)}
                        aria-label="Search pages"
                        className={styles.search}
                    />
                    <Select
                        value={listFilter}
                        onChange={e => handleFilterChange(e.target.value as PageListFilter)}
                        aria-label="Filter pages by status"
                    >
                        <option value="all">All pages</option>
                        <option value="published">Published</option>
                        <option value="drafts">Drafts</option>
                        <option value="pending">Awaiting review</option>
                        <option value="deleted">Deleted</option>
                    </Select>
                    <Button
                        variant="primary"
                        icon={<Plus size={16} />}
                        onClick={() => setIsCreating(true)}
                        className={styles.new_page}
                    >
                        New page
                    </Button>
                </div>
                {error && <div className="alert" role="alert">{error}</div>}
                {body}
            </Panel>
        </>
    );
}
