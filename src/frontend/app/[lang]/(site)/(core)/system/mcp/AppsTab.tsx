'use client';

/**
 * @fileoverview Connected apps tab of /system/mcp: every user's OAuth grants,
 * each revocable by an admin.
 *
 * Grants across every user run to hundreds of rows, so the list is paged on
 * the server and searched by the user's email or name rather than loaded
 * whole. The first page arrives with the page; each later page and each
 * search is fetched when the admin asks, which is the user-triggered loading
 * the SSR rule allows.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IConnectedAppAdminRow } from '@/types';
import { Stack } from '../../../../../../components/layout';
import { ConfirmDialog } from '../../../../../../components/ui/ConfirmDialog';
import { Input } from '../../../../../../components/ui/Input';
import { useModal } from '../../../../../../components/ui/ModalProvider';
import { Pagination } from '../../../../../../components/ui/Pagination';
import { Panel } from '../../../../../../components/ui/Panel';
import { useToast } from '../../../../../../components/ui/ToastProvider';
import { ConnectedAppsTable, connectedAppKey, type IConnectedAppRow } from '../../../../../../modules/user';
import { MCP_APPS_PAGE_SIZE, listMcpApps, revokeMcpApp } from '../../../../../../modules/mcp';
import styles from './page.module.scss';

/**
 * How long typing must pause before the search is sent, so a search is one
 * request for the finished text rather than one per keystroke.
 */
const SEARCH_DELAY_MS = 300;

/** Longest search the backend accepts: the longest an email address can be. */
const SEARCH_MAX_LENGTH = 254;

/**
 * Props for {@link AppsTab}.
 */
interface IAppsTabProps {
    /** SSR-fetched first page of grants. */
    initialApps: IConnectedAppAdminRow[];
    /** Total grants across all users. */
    initialTotal: number;
}

/**
 * Describe the rows on screen and how many there are in all, for the line
 * beside the pager.
 *
 * @param page - The page shown, counting from 1.
 * @param shown - Rows on that page.
 * @param total - Rows across every page.
 * @param search - The search the rows match, or blank.
 * @returns A sentence such as "26–50 of 318 grants".
 */
function describeRange(page: number, shown: number, total: number, search: string): string {
    const first = (page - 1) * MCP_APPS_PAGE_SIZE + 1;
    const range = shown === 0 ? `0 of ${total}` : `${first}–${first + shown - 1} of ${total}`;
    const noun = total === 1 ? 'grant' : 'grants';
    return search ? `${range} ${noun} held by accounts matching "${search}"` : `${range} ${noun}`;
}

/**
 * Render the connected apps list.
 *
 * @param props - {@link IAppsTabProps}.
 * @returns The apps panel.
 */
export function AppsTab({ initialApps, initialTotal }: IAppsTabProps) {
    const [apps, setApps] = useState<IConnectedAppAdminRow[]>(initialApps);
    const [total, setTotal] = useState(initialTotal);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [searchDraft, setSearchDraft] = useState('');
    const [searchTruncated, setSearchTruncated] = useState(false);
    const [loading, setLoading] = useState(false);
    const [revokingKey, setRevokingKey] = useState<string | null>(null);
    const latestRequest = useRef(0);
    const { open, close } = useModal();
    const { push } = useToast();

    /**
     * Fetch one page of grants for a search and show it.
     *
     * Requests are numbered, and only the answer to the newest one is shown,
     * so a slow answer to an older search cannot replace the rows of the
     * search typed after it.
     *
     * @param nextPage - The page to show, counting from 1.
     * @param nextSearch - The search the rows must match, or blank for every grant.
     */
    const load = useCallback(async (nextPage: number, nextSearch: string): Promise<void> => {
        const request = ++latestRequest.current;
        setLoading(true);
        try {
            const result = await listMcpApps(MCP_APPS_PAGE_SIZE, (nextPage - 1) * MCP_APPS_PAGE_SIZE, nextSearch);
            if (request === latestRequest.current) {
                setApps(result.apps);
                setTotal(result.total);
                setPage(nextPage);
                setSearch(nextSearch);
                setSearchTruncated(result.searchTruncated);
            }
        } catch (error) {
            if (request === latestRequest.current) {
                push({ tone: 'danger', title: 'Could not load connected apps', description: error instanceof Error ? error.message : String(error) });
            }
        } finally {
            if (request === latestRequest.current) {
                setLoading(false);
            }
        }
    }, [push]);

    /**
     * Send the search once typing pauses. A draft that matches the search
     * already shown sends nothing, which is what keeps the first render from
     * fetching the page the server already rendered.
     *
     * @returns Cleanup that cancels a search still waiting for the pause.
     */
    useEffect(() => {
        const next = searchDraft.trim();
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (next !== search) {
            timer = setTimeout(
                /** Search from the first page, since the old page number means nothing for new results. */
                () => { void load(1, next); },
                SEARCH_DELAY_MS
            );
        }
        return () => {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        };
    }, [searchDraft, search, load]);

    /**
     * Show another page of the same search.
     *
     * @param nextPage - The page the pager asked for.
     */
    const handlePageChange = useCallback((nextPage: number): void => {
        void load(nextPage, search);
    }, [load, search]);

    /**
     * Revoke one grant after confirmation, then reload the page so a row from
     * the next page moves up to fill the gap. When the revoked row was the
     * only one on the last page, the page before it is shown instead.
     *
     * @param app - The row whose revoke button was pressed.
     */
    const handleRevoke = useCallback((app: IConnectedAppRow): void => {
        const userId = app.userId;
        if (userId) {
            const modalId = open({
                title: 'Revoke connected app',
                content: (
                    <ConfirmDialog
                        label={app.clientName}
                        confirmLabel="Revoke"
                        message={<>Revoke <strong>{app.clientName}</strong> for {app.userEmail ?? userId}? Its tokens stop working at once; the user can reconnect it later if they are still in the MCP group.</>}
                        onConfirm={
                            async () => {
                            const key = connectedAppKey(app);
                            setRevokingKey(key);
                            try {
                                await revokeMcpApp(userId, app.clientId);
                                setApps(current => current.filter(row => connectedAppKey(row) !== key));
                                push({ tone: 'success', title: 'App revoked', description: app.clientName });
                                const lastPage = Math.max(1, Math.ceil(Math.max(0, total - 1) / MCP_APPS_PAGE_SIZE));
                                void load(Math.min(page, lastPage), search);
                            } catch (error) {
                                push({ tone: 'danger', title: 'Could not revoke app', description: error instanceof Error ? error.message : String(error) });
                            } finally {
                                setRevokingKey(null);
                                close(modalId);
                            }
                        }}
                        onCancel={() => close(modalId)}
                    />
                )
            });
        }
    }, [open, close, push, load, page, search, total]);

    return (
        <Stack gap="md">
            <Panel
                title="Connected apps"
                meta={loading
                    ? 'Loading…'
                    : 'Apps members have authorized to act as them. Removing someone from the MCP group blocks their apps within 30 seconds.'}
                actions={(
                    <div className={styles.apps_search}>
                        <Input
                            type="search"
                            value={searchDraft}
                            maxLength={SEARCH_MAX_LENGTH}
                            onChange={event => setSearchDraft(event.target.value)}
                            placeholder="Search by user email or name"
                            aria-label="Search connected apps by user email or name"
                        />
                    </div>
                )}
            >
                {searchTruncated && (
                    <div className="alert" role="status">
                        More accounts match &quot;{search}&quot; than one search reads, so only the apps of the most recently
                        active of them are listed. Type more of the address to narrow it.
                    </div>
                )}
                <ConnectedAppsTable
                    apps={apps}
                    showUser
                    onRevoke={handleRevoke}
                    revokingKey={revokingKey}
                    emptyMessage={search ? `No connected apps belong to an account matching "${search}".` : 'No apps are connected.'}
                />
            </Panel>
            {total > 0 && (
                <div className={styles.apps_footer}>
                    <span className={styles.apps_range} aria-live="polite">{describeRange(page, apps.length, total, search)}</span>
                    <Pagination total={total} pageSize={MCP_APPS_PAGE_SIZE} currentPage={page} onPageChange={handlePageChange} />
                </div>
            )}
        </Stack>
    );
}
