'use client';

/**
 * @fileoverview The Users tab of `/system/users`: the searchable, sortable
 * account directory and the per-account actions.
 *
 * The directory is one panel. Its header carries the account count, the search
 * box, and a refresh button, and the table runs to the panel's edges. The email
 * opens the detail panel, so each row's actions are two icon buttons, for group
 * membership and deletion, and the table fits a 1024px window. It stacks into
 * labelled entries only below 768px, where the email, the status badge, and
 * the wallet mark share each entry's heading line, and the table's own sort
 * picker (`stackedSort`) replaces the hidden headers. Both widths drive one
 * sort state.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCcw, RotateCcw, Trash2, Users as UsersIcon, Wallet } from 'lucide-react';
import type { AccountSortDirection, AccountSortField } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Panel } from '../../../../../components/ui/Panel';
import { Input } from '../../../../../components/ui/Input';
import { IconButton } from '../../../../../components/ui/IconButton';
import { Badge } from '../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Pagination } from '../../../../../components/ui/Pagination';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { fetchAccounts as fetchAccountPage, type IAccountRow } from '../../../api/admin-accounts.api';
import { UserDetailPanel } from '../UserDetailPanel';
import { UserGroupsForm } from './UserGroupsForm';
import { DeleteUserForm } from './DeleteUserForm';
import { SortableHeader } from './SortableHeader';
import styles from './UsersMonitor.module.scss';

/** Page size for the account directory table. */
const PAGE_SIZE = 20;

/**
 * How long typing must pause before the search is sent, so a search is one
 * request for the finished text rather than one per keystroke.
 */
const SEARCH_DELAY_MS = 300;

/**
 * The sortable columns in table order. One list feeds the column headers, the
 * stacked-row sort picker, and each cell's stacked label, so the three never
 * name a column differently.
 *
 * Status and Wallet come straight after Email because their cells carry no
 * stacked label: the table puts unlabelled cells that open a row on the
 * stacked entry's heading line, so on a phone the badge and the wallet mark
 * sit beside the address instead of taking a line each.
 */
const SORT_COLUMNS: ReadonlyArray<{ key: AccountSortField; label: string }> = [
    { key: 'email', label: 'Email' },
    { key: 'status', label: 'Verified' },
    { key: 'primaryWallet', label: 'Wallet' },
    { key: 'name', label: 'Name' },
    { key: 'groups', label: 'Groups' },
    { key: 'createdAt', label: 'Created' },
    { key: 'lastSeenAt', label: 'Last seen' }
];

/**
 * Columns whose values are short and must stay on one line, such as a badge
 * or a date. They take only the width their widest value needs and hand the
 * rest to the email, name, and group columns.
 */
const SHRINK_COLUMNS: ReadonlySet<AccountSortField> = new Set<AccountSortField>(['status', 'primaryWallet', 'createdAt', 'lastSeenAt']);

/** Each sortable column's name keyed by field, for the stacked cell labels. */
const COLUMN_LABEL = Object.fromEntries(SORT_COLUMNS.map(column => [column.key, column.label])) as Record<AccountSortField, string>;

/**
 * The direction a column sorts in when first clicked: text columns start at
 * A, while dates and the badge columns start with the most recent or most
 * notable value, which is what an admin opening that column usually wants.
 */
const FIRST_SORT_DIRECTION: Record<AccountSortField, AccountSortDirection> = {
    email: 'asc',
    name: 'asc',
    status: 'asc',
    primaryWallet: 'desc',
    groups: 'desc',
    createdAt: 'desc',
    lastSeenAt: 'desc'
};

/** One account row, as the list endpoint sends it. */
type AccountRow = IAccountRow;

/**
 * Describe how many accounts the list holds, for the panel header.
 *
 * @param total - Accounts matching the search, across every page.
 * @param search - The search the accounts match, or blank for the whole directory.
 * @returns A phrase such as "2,876 accounts" or "3 accounts matching "petrov"".
 */
function describeCount(total: number, search: string): string {
    const counted = `${total.toLocaleString('en-US')} ${total === 1 ? 'account' : 'accounts'}`;
    return search ? `${counted} matching "${search}"` : counted;
}

/**
 * UsersMonitor
 *
 * Admin directory of Better Auth accounts. Lists accounts with search by
 * email or name and a sort on every column, shows verification status, whether
 * a primary wallet is set, group membership, and when each account was last
 * seen, and opens the per-user detail panel, the group-membership editor, or
 * the delete dialog per account.
 *
 * Client-only admin tool: `/system/users` is admin-gated via the Better Auth
 * session cookie, so the SSR + Live Updates pattern does not apply. The
 * loading state is the user-triggered search and pagination case the pattern
 * explicitly permits.
 *
 * @param props.initialSelectedUserId - An account to open in the detail panel
 *   on arrival, from the page's `?user=` deep link, so another admin page (such
 *   as an MCP call's detail) can link straight to the account behind a user id.
 * @returns The account directory and its detail panel.
 */
export function UsersMonitor({ initialSelectedUserId }: { initialSelectedUserId?: string } = {}) {
    const [accounts, setAccounts] = useState<AccountRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [searchDraft, setSearchDraft] = useState('');
    const [sortBy, setSortBy] = useState<AccountSortField>('createdAt');
    const [sortDirection, setSortDirection] = useState<AccountSortDirection>('desc');
    const [selectedUserId, setSelectedUserId] = useState<string | null>(initialSelectedUserId ?? null);
    const latestRequest = useRef(0);

    const { open: openModal, close: closeModal } = useModal();
    const { push: pushToast } = useToast();

    /**
     * Load the current page in the current sort and search. A failure is shown
     * as a toast, so an admin is not left looking at a stale page that seems
     * current.
     *
     * Requests are numbered, and only the answer to the newest one is shown,
     * so a slow answer to an earlier search or page cannot replace the rows of
     * the one asked for after it.
     */
    const fetchAccounts = useCallback(async () => {
        const request = ++latestRequest.current;
        setLoading(true);
        try {
            const data = await fetchAccountPage({
                limit: PAGE_SIZE,
                skip: (page - 1) * PAGE_SIZE,
                search: search || undefined,
                sortBy,
                sortDirection
            });
            if (request === latestRequest.current) {
                setAccounts(data.accounts);
                setTotal(data.total);
            }
        } catch (error) {
            if (request === latestRequest.current) {
                pushToast({ tone: 'danger', title: 'Could not load accounts', description: error instanceof Error ? error.message : String(error) });
            }
        } finally {
            if (request === latestRequest.current) {
                setLoading(false);
            }
        }
    }, [page, search, sortBy, sortDirection, pushToast]);

    /**
     * Sort by a column. Clicking the active column flips the direction;
     * clicking another starts it in that column's natural direction. Either
     * way the table returns to the first page, since the old page number
     * points at different accounts in the new order.
     */
    const handleSort = useCallback((field: AccountSortField) => {
        if (field === sortBy) {
            setSortDirection(previous => (previous === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortBy(field);
            setSortDirection(FIRST_SORT_DIRECTION[field]);
        }
        setPage(1);
    }, [sortBy]);

    /** Load a page whenever the page, sort, or search changes. */
    useEffect(() => {
        void fetchAccounts();
    }, [fetchAccounts]);

    /**
     * Apply the typed search once typing pauses, from the first page, since
     * the old page number means nothing for new results. A draft that matches
     * the search already applied sends nothing.
     *
     * @returns Cleanup that cancels a search still waiting for the pause.
     */
    useEffect(() => {
        const next = searchDraft.trim();
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (next !== search) {
            timer = setTimeout(
                /** Apply the finished search and go back to page one. */
                () => {
                    setSearch(next);
                    setPage(1);
                },
                SEARCH_DELAY_MS
            );
        }
        return () => {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        };
    }, [searchDraft, search]);

    /**
     * Open the membership editor modal for an account. The save handler PUTs
     * the new id list and refreshes the table on success so admins see the
     * authoritative server state, not just the optimistic value.
     */
    const openGroupsModal = useCallback((account: AccountRow) => {
        const modalId = openModal({
            title: 'Manage Groups',
            size: 'sm',
            content: (
                <UserGroupsForm
                    userId={account.id}
                    initialGroups={account.groups ?? []}
                    onCancel={() => closeModal(modalId)}
                    onSubmit={async (selectedIds) => {
                        try {
                            const response = await fetch(
                                `/api/admin/users/${encodeURIComponent(account.id)}/groups`,
                                {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ groups: selectedIds })
                                }
                            );
                            if (!response.ok) {
                                const payload = await response.json().catch(() => null);
                                throw new Error(payload?.message ?? `Update failed (${response.status})`);
                            }
                            pushToast({ tone: 'success', title: 'Group membership updated' });
                            closeModal(modalId);
                            await fetchAccounts();
                        } catch (error) {
                            pushToast({
                                tone: 'danger',
                                title: error instanceof Error ? error.message : 'Update failed'
                            });
                        }
                    }}
                />
            )
        });
    }, [openModal, closeModal, pushToast, fetchAccounts]);

    /**
     * Open the confirmation modal for deleting an account. The form makes the
     * admin type the account's email, and the handler sends that address with
     * the DELETE request so the server can check it too. On success the table
     * is refreshed, so the row shows as deleted from the server's own answer.
     * A refusal, such as deleting your own account or the only admin, comes
     * back as a message and is shown as a toast with the modal left open.
     *
     * This is also the retry path for an already-marked account. The service
     * reruns the revocations and keeps the original mark, so an admin can
     * finish a deletion whose revocation step failed.
     */
    const openDeleteModal = useCallback((account: AccountRow) => {
        const modalId = openModal({
            title: 'Delete User',
            size: 'sm',
            content: (
                <DeleteUserForm
                    email={account.email}
                    onCancel={() => closeModal(modalId)}
                    onSubmit={async (confirmEmail) => {
                        try {
                            const response = await fetch(
                                `/api/admin/users/${encodeURIComponent(account.id)}`,
                                {
                                    method: 'DELETE',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ confirmEmail })
                                }
                            );
                            if (!response.ok) {
                                const payload = await response.json().catch(() => null);
                                throw new Error(payload?.message ?? payload?.error ?? `Delete failed (${response.status})`);
                            }
                            pushToast({ tone: 'success', title: 'User deleted' });
                            closeModal(modalId);
                            await fetchAccounts();
                        } catch (error) {
                            pushToast({
                                tone: 'danger',
                                title: error instanceof Error ? error.message : 'Delete failed'
                            });
                        }
                    }}
                />
            )
        });
    }, [openModal, closeModal, pushToast, fetchAccounts]);

    let body: ReactNode;
    if (accounts.length === 0) {
        body = (
            <p className="text-muted">
                {loading ? 'Loading accounts…' : search ? `No accounts match "${search}".` : 'No accounts yet.'}
            </p>
        );
    } else {
        body = (
            <Table
                variant="compact"
                flush
                stackAt="mobile"
                stackedSort={{ columns: SORT_COLUMNS, active: sortBy, direction: sortDirection, onSort: handleSort }}
            >
                <Thead>
                    <Tr>
                        {SORT_COLUMNS.map(column => (
                            <SortableHeader
                                key={column.key}
                                field={column.key}
                                label={column.label}
                                sortBy={sortBy}
                                sortDirection={sortDirection}
                                onSort={handleSort}
                                shrink={SHRINK_COLUMNS.has(column.key)}
                            />
                        ))}
                        <Th width="shrink" aria-label="Actions" />
                    </Tr>
                </Thead>
                <Tbody>
                    {accounts.map(account => (
                        <Tr key={account.id}>
                            {/* No label on the first three cells: stacked, they
                                share the entry's heading line. The email is a
                                real button, so the keyboard reaches the detail
                                panel through it. */}
                            <Td className={styles.email_cell}>
                                <button
                                    type="button"
                                    className={styles.email_button}
                                    onClick={() => setSelectedUserId(account.id)}
                                    aria-label={`Open details for ${account.email}`}
                                >
                                    {account.email}
                                </button>
                            </Td>
                            <Td>
                                {account.deletedAt ? (
                                    <Badge tone="danger" size="sm">Deleted</Badge>
                                ) : account.emailVerified ? (
                                    <Badge tone="success" size="sm">Verified</Badge>
                                ) : (
                                    <Badge tone="neutral" size="sm">Unverified</Badge>
                                )}
                            </Td>
                            <Td>
                                {/* The address itself is in the detail panel; the
                                    table only says whether one is set. The dash
                                    is dropped while stacked, where the column
                                    name is not shown to explain it. */}
                                {account.primaryWallet ? (
                                    <span className={styles.wallet_mark} role="img" aria-label="Primary wallet set" title="Primary wallet set">
                                        <Wallet size={16} aria-hidden="true" />
                                    </span>
                                ) : (
                                    <span className={`text-muted ${styles.no_wallet}`} aria-label="No primary wallet">—</span>
                                )}
                            </Td>
                            <Td label={COLUMN_LABEL.name}>{account.name || <span className="text-muted">—</span>}</Td>
                            <Td label={COLUMN_LABEL.groups}>
                                {(account.groups ?? []).length === 0 ? (
                                    <span className="text-muted">—</span>
                                ) : (
                                    <div className={styles.group_chips}>
                                        {account.groups.map((groupId) => (
                                            <Badge key={groupId} tone="info" size="sm">
                                                <code>{groupId}</code>
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                            </Td>
                            <Td label={COLUMN_LABEL.createdAt}><ClientTime date={account.createdAt} format="short" /></Td>
                            <Td label={COLUMN_LABEL.lastSeenAt}>
                                {account.lastSeenAt ? (
                                    <ClientTime date={account.lastSeenAt} format="relative" />
                                ) : (
                                    <span className="text-muted">Never</span>
                                )}
                            </Td>
                            {/* No label: stacked, the icons close the entry. A
                                deleted account holds no groups, so it offers no
                                membership editor. It keeps a revocation action,
                                because a deletion whose session, group, or
                                connected-app revocation failed leaves the account
                                marked while its existing sessions and connected
                                apps still work, and repeating the request is how
                                the service finishes it. */}
                            <Td>
                                <div className={styles.row_actions}>
                                    {account.deletedAt ? (
                                        <IconButton
                                            variant="primary"
                                            title="Revoke again"
                                            aria-label={`Re-run revocation for ${account.email}`}
                                            onClick={() => openDeleteModal(account)}
                                        >
                                            <RotateCcw size={16} aria-hidden="true" />
                                        </IconButton>
                                    ) : (
                                        <>
                                            <IconButton
                                                variant="primary"
                                                title="Manage groups"
                                                aria-label={`Manage groups for ${account.email}`}
                                                onClick={() => openGroupsModal(account)}
                                            >
                                                <UsersIcon size={16} aria-hidden="true" />
                                            </IconButton>
                                            <IconButton
                                                variant="danger"
                                                title="Delete"
                                                aria-label={`Delete ${account.email}`}
                                                onClick={() => openDeleteModal(account)}
                                            >
                                                <Trash2 size={16} aria-hidden="true" />
                                            </IconButton>
                                        </>
                                    )}
                                </div>
                            </Td>
                        </Tr>
                    ))}
                </Tbody>
            </Table>
        );
    }

    return (
        <Stack gap="md">
            <Panel
                title="Accounts"
                meta={loading ? 'Loading…' : describeCount(total, search)}
                actions={(
                    <>
                        <div className={styles.search}>
                            <Input
                                type="search"
                                value={searchDraft}
                                onChange={event => setSearchDraft(event.target.value)}
                                placeholder="Search by email or name"
                                aria-label="Search accounts by email or name"
                            />
                        </div>
                        <IconButton
                            title="Refresh"
                            aria-label="Refresh accounts"
                            disabled={loading}
                            onClick={() => void fetchAccounts()}
                        >
                            <RefreshCcw size={16} aria-hidden="true" />
                        </IconButton>
                    </>
                )}
            >
                {body}
            </Panel>

            {total > PAGE_SIZE && (
                <div className={styles.footer}>
                    <Pagination total={total} pageSize={PAGE_SIZE} currentPage={page} onPageChange={setPage} />
                </div>
            )}

            <UserDetailPanel userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
        </Stack>
    );
}
