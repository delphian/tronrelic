'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Users as UsersIcon } from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { UserGroupsForm } from './UserGroupsForm';
import styles from './UsersMonitor.module.scss';

/** Page size for the account directory table. */
const PAGE_SIZE = 20;

/**
 * Wire shape of a Better Auth account row returned by `GET /admin/users`.
 *
 * Mirrors the backend `IAccountSummary` but types `createdAt` as the JSON
 * string the API actually sends (the domain type uses `Date`). `<ClientTime>`
 * consumes the string directly.
 */
interface AccountRow {
    id: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    createdAt: string;
    groups: string[];
    primaryWallet: string | null;
}

/** Response shape of the paginated account-directory endpoint. */
interface AccountsResponse {
    accounts: AccountRow[];
    total: number;
}

/**
 * UsersMonitor
 *
 * Admin directory of Better Auth accounts. Lists accounts with search by
 * email/name, surfaces verification status, primary wallet, and group
 * membership, and opens the group-membership editor per account.
 *
 * Account-count and wallet-adoption overviews live in the Analytics tab
 * (`AnalyticsDashboard`); first-touch and per-page traffic analytics moved to
 * the Traffic tab (`VisitorAnalytics` / `PageActivity`). This view focuses on
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

    const { open: openModal, close: closeModal } = useModal();
    const { push: pushToast } = useToast();

    const fetchAccounts = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('limit', PAGE_SIZE.toString());
            params.set('skip', ((page - 1) * PAGE_SIZE).toString());
            if (search) {
                params.set('search', search);
            }

            const response = await fetch(
                `/api/admin/users?${params.toString()}`
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch accounts: ${response.status}`);
            }

            const data: AccountsResponse = await response.json();
            setAccounts(data.accounts);
            setTotal(data.total);
        } catch (error) {
            console.error('Failed to fetch accounts:', error);
        } finally {
            setLoading(false);
        }
    }, [page, search]);

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

    const handleSearch = () => {
        setPage(1);
        setSearch(searchInput);
    };

    const handleClearSearch = () => {
        setSearchInput('');
        setSearch('');
        setPage(1);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1;

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1 className={styles.title}>User Accounts</h1>
                <p className={styles.subtitle}>
                    Better Auth accounts — search by email or name and manage group membership
                </p>
            </header>

            <div className={styles.controls}>
                <div className={styles.search_box}>
                    <input
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
                    <div className={styles.table_wrapper}>
                        <table className={styles.user_table}>
                            <thead>
                                <tr>
                                    <th>Email</th>
                                    <th>Name</th>
                                    <th>Verified</th>
                                    <th>Primary Wallet</th>
                                    <th>Groups</th>
                                    <th>Created</th>
                                    <th><span className="text-muted">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {accounts.map((account) => (
                                    <tr key={account.id} className={styles.user_row}>
                                        <td>{account.email}</td>
                                        <td>{account.name || <span className="text-muted">—</span>}</td>
                                        <td>
                                            {account.emailVerified ? (
                                                <Badge tone="success">Verified</Badge>
                                            ) : (
                                                <Badge tone="neutral">Unverified</Badge>
                                            )}
                                        </td>
                                        <td>
                                            {account.primaryWallet ? (
                                                <code className={styles.user_id}>{account.primaryWallet}</code>
                                            ) : (
                                                <span className="text-muted">—</span>
                                            )}
                                        </td>
                                        <td>
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
                                        </td>
                                        <td><ClientTime date={account.createdAt} format="short" /></td>
                                        <td>
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => openGroupsModal(account)}
                                                aria-label={`Manage groups for ${account.email}`}
                                            >
                                                <UsersIcon size={14} aria-hidden="true" /> Groups
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

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
        </div>
    );
}
