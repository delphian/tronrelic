'use client';

/**
 * @fileoverview The Users tab of `/system/users`: the searchable, sortable
 * account directory and the per-account actions.
 *
 * At full width the directory is a table whose column headers sort it. On a
 * tablet or phone the shared table stacks each account into a labelled entry,
 * with the email as the entry's heading and the actions as its last line, and
 * the table's own sort picker (`stackedSort`) replaces the hidden headers.
 * Both widths drive one sort state.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, PanelRightOpen, RotateCcw, Trash2, Users as UsersIcon } from 'lucide-react';
import type { AccountSortDirection, AccountSortField } from '@/types';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { Badge } from '../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../components/ui/ClientTime';
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
 * The sortable columns in table order. One list feeds the column headers, the
 * stacked-row sort picker, and each cell's stacked label, so the three never
 * name a column differently.
 */
const SORT_COLUMNS: ReadonlyArray<{ key: AccountSortField; label: string }> = [
    { key: 'email', label: 'Email' },
    { key: 'name', label: 'Name' },
    { key: 'status', label: 'Verified' },
    { key: 'primaryWallet', label: 'Wallet' },
    { key: 'groups', label: 'Groups' },
    { key: 'createdAt', label: 'Created' },
    { key: 'lastSeenAt', label: 'Last seen' }
];

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
 * UsersMonitor
 *
 * Admin directory of Better Auth accounts. Lists accounts with search by
 * email/name and a sort on every column, shows verification status, whether a
 * primary wallet is set, group membership, and when each account was last
 * seen, and opens the per-user detail panel, the group-membership editor, or
 * the delete dialog per account.
 *
 * Account-count and wallet-adoption overviews live in the Analytics tab
 * (`AnalyticsDashboard`); first-touch and per-page traffic analytics moved to
 * the Traffic tab (`VisitorsExplorer`). This view focuses on
 * the account list.
 *
 * Client-only admin tool: `/system/users` is admin-gated via the Better Auth
 * session cookie, so the SSR + Live Updates pattern does not apply — the
 * loading state on the table is the user-triggered search/pagination case
 * the pattern explicitly permits. Mirrors the established approach in
 * `UserGroupsForm` / `GroupForm`.
 */
export function UsersMonitor() {
    const [accounts, setAccounts] = useState<AccountRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [sortBy, setSortBy] = useState<AccountSortField>('createdAt');
    const [sortDirection, setSortDirection] = useState<AccountSortDirection>('desc');
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

    const { open: openModal, close: closeModal } = useModal();
    const { push: pushToast } = useToast();

    /**
     * Load the current page in the current sort. A failure is shown as a
     * toast, so an admin is not left looking at a stale page that seems current.
     */
    const fetchAccounts = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchAccountPage({
                limit: PAGE_SIZE,
                skip: (page - 1) * PAGE_SIZE,
                search: search || undefined,
                sortBy,
                sortDirection
            });
            setAccounts(data.accounts);
            setTotal(data.total);
        } catch (error) {
            pushToast({ tone: 'danger', title: 'Could not load accounts', description: error instanceof Error ? error.message : String(error) });
        } finally {
            setLoading(false);
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

    useEffect(() => {
        fetchAccounts();
    }, [fetchAccounts]);

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

    /** Apply the typed search and return to the first page of results. */
    const handleSearch = () => {
        setPage(1);
        setSearch(searchInput);
    };

    /** Drop the search so the full directory shows again from page one. */
    const handleClearSearch = () => {
        setSearchInput('');
        setSearch('');
        setPage(1);
    };

    /**
     * Run the search on Enter, so the field works like a search box without
     * reaching for the button.
     *
     * @param e - The key event from the search field.
     */
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1;

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                {/* h2: the /system/users shell owns the page's single h1. */}
                <h2 className={styles.title}>User Accounts</h2>
                <p className={styles.subtitle}>
                    Better Auth accounts — search by email or name, sort by any column, and open an account for its sessions, sign-in history, and admin note
                </p>
            </header>

            <div className={styles.controls}>
                <div className={styles.search_box}>
                    <Input
                        type="text"
                        className={styles.search_input}
                        placeholder="Search by email or name…"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        aria-label="Search accounts"
                    />
                    <Button onClick={handleSearch} size="sm">
                        Search
                    </Button>
                    {search && (
                        <Button onClick={handleClearSearch} size="sm" variant="ghost">
                            Clear
                        </Button>
                    )}
                </div>
                <Button onClick={fetchAccounts} size="sm" variant="ghost">
                    Refresh
                </Button>
            </div>

            {loading ? (
                <div className={styles.loading}>Loading accounts…</div>
            ) : accounts.length === 0 ? (
                <div className={styles.empty}>
                    {search ? `No accounts found matching "${search}"` : 'No accounts found'}
                </div>
            ) : (
                <>
                    <Table
                        stackAt="tablet"
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
                                    />
                                ))}
                                <Th>Actions</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {accounts.map((account) => (
                                <Tr key={account.id}>
                                    {/* No label: the email is the heading of a stacked entry. */}
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
                                    <Td label={COLUMN_LABEL.name}>{account.name || <span className="text-muted">—</span>}</Td>
                                    <Td label={COLUMN_LABEL.status}>
                                        {account.deletedAt ? (
                                            <Badge tone="danger">Deleted</Badge>
                                        ) : account.emailVerified ? (
                                            <Badge tone="success">Verified</Badge>
                                        ) : (
                                            <Badge tone="neutral">Unverified</Badge>
                                        )}
                                    </Td>
                                    <Td label={COLUMN_LABEL.primaryWallet}>
                                        {/* The address itself is in the detail panel; the
                                            table only says whether one is set. */}
                                        {account.primaryWallet ? (
                                            <CheckCircle2
                                                size={16}
                                                className={styles.wallet_tick}
                                                role="img"
                                                aria-label="Primary wallet set"
                                            />
                                        ) : (
                                            <span className="text-muted" aria-label="No primary wallet">—</span>
                                        )}
                                    </Td>
                                    <Td label={COLUMN_LABEL.groups}>
                                        {(account.groups ?? []).length === 0 ? (
                                            <span className="text-muted">—</span>
                                        ) : (
                                            <div className={styles.group_chips}>
                                                {account.groups.map((groupId) => (
                                                    <Badge key={groupId} tone="info">
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
                                    {/* No label: the actions take the full last line of a stacked entry. */}
                                    <Td className={styles.actions_cell}>
                                        {/* A deleted account holds no groups, so it offers no
                                            membership editor. It keeps a revocation action because
                                            a deletion whose session, group, or connected-app
                                            revocation failed leaves the account marked while its
                                            existing sessions and connected apps still work, and
                                            repeating the request is how the service finishes it. */}
                                        {account.deletedAt ? (
                                            <div className={styles.row_actions}>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => setSelectedUserId(account.id)}
                                                    aria-label={`Open details for ${account.email}`}
                                                >
                                                    <PanelRightOpen size={14} aria-hidden="true" /> Details
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() => openDeleteModal(account)}
                                                    aria-label={`Re-run revocation for ${account.email}`}
                                                >
                                                    <RotateCcw size={14} aria-hidden="true" /> Revoke again
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className={styles.row_actions}>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => setSelectedUserId(account.id)}
                                                    aria-label={`Open details for ${account.email}`}
                                                >
                                                    <PanelRightOpen size={14} aria-hidden="true" /> Details
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() => openGroupsModal(account)}
                                                    aria-label={`Manage groups for ${account.email}`}
                                                >
                                                    <UsersIcon size={14} aria-hidden="true" /> Groups
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="danger"
                                                    onClick={() => openDeleteModal(account)}
                                                    aria-label={`Delete ${account.email}`}
                                                >
                                                    <Trash2 size={14} aria-hidden="true" /> Delete
                                                </Button>
                                            </div>
                                        )}
                                    </Td>
                                </Tr>
                            ))}
                        </Tbody>
                    </Table>

                    <div className={styles.pagination}>
                        <Button
                            onClick={() => setPage(page - 1)}
                            disabled={page <= 1}
                            size="sm"
                            variant="ghost"
                        >
                            Previous
                        </Button>
                        <span className={styles.page_info}>
                            Page {page} of {totalPages} ({total.toLocaleString()} {total === 1 ? 'account' : 'accounts'})
                        </span>
                        <Button
                            onClick={() => setPage(page + 1)}
                            disabled={page >= totalPages}
                            size="sm"
                            variant="ghost"
                        >
                            Next
                        </Button>
                    </div>
                </>
            )}

            <UserDetailPanel userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
        </div>
    );
}
