'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { config as runtimeConfig } from '../../../../lib/config';
import { Button } from '../../../../components/ui/Button';
import styles from './UsersMonitor.module.css';

interface WalletLink {
    address: string;
    linkedAt: string;
    isPrimary: boolean;
    label?: string;
}

interface UserPreferences {
    theme?: 'light' | 'dark' | 'system';
    notifications?: boolean;
    timezone?: string;
    language?: string;
}

interface UserActivity {
    lastSeen: string;
    pageViews: number;
    firstSeen: string;
}

interface UserRecord {
    id: string;
    wallets: WalletLink[];
    preferences: UserPreferences;
    activity: UserActivity;
    createdAt: string;
    updatedAt: string;
}

interface UserStats {
    totalUsers: number;
    usersWithWallets: number;
    totalWalletLinks: number;
    activeToday: number;
    activeThisWeek: number;
    averageWalletsPerUser: number;
}

interface UsersResponse {
    users: UserRecord[];
    total: number;
    stats: UserStats;
}

interface Props {
    token: string;
}

/**
 * UsersMonitor Component
 *
 * Admin tool for viewing and searching user identities. Displays statistics,
 * paginated user list, and search functionality.
 *
 * **Key Features:**
 * - User statistics overview (total users, active today, etc.)
 * - Paginated user list
 * - Search by UUID or wallet address
 * - Expandable user details showing wallets and preferences
 *
 * **Data Sources:**
 * - `/admin/users` - Paginated users with stats
 *
 * **Security:**
 * Requires admin token authentication via X-Admin-Token header.
 *
 * @param {Props} props - Component props
 * @param {string} props.token - Admin authentication token for API requests
 */
export function UsersMonitor({ token }: Props) {
    const [users, setUsers] = useState<UserRecord[]>([]);
    const [stats, setStats] = useState<UserStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [limit] = useState(20);
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('limit', limit.toString());
            params.set('skip', ((page - 1) * limit).toString());
            if (search) {
                params.set('search', search);
            }

            const response = await fetch(
                `${runtimeConfig.apiBaseUrl}/admin/users?${params.toString()}`,
                {
                    headers: {
                        'X-Admin-Token': token
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch users: ${response.status}`);
            }

            const data: UsersResponse = await response.json();
            setUsers(data.users);
            setTotal(data.total);
            setStats(data.stats);
        } catch (error) {
            console.error('Failed to fetch users:', error);
        } finally {
            setLoading(false);
        }
    }, [token, page, limit, search]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

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

    const totalPages = Math.ceil(total / limit);

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatRelative = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return formatDate(dateString);
    };

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1 className={styles.title}>User Management</h1>
                <p className={styles.subtitle}>
                    View and search visitor identities and linked wallets
                </p>
            </header>

            {stats && (
                <div className={styles.stats}>
                    <div className={styles.statCard}>
                        <span className={styles.statValue}>{stats.totalUsers.toLocaleString()}</span>
                        <span className={styles.statLabel}>Total Users</span>
                    </div>
                    <div className={styles.statCard}>
                        <span className={styles.statValue}>{stats.activeToday.toLocaleString()}</span>
                        <span className={styles.statLabel}>Active Today</span>
                    </div>
                    <div className={styles.statCard}>
                        <span className={styles.statValue}>{stats.activeThisWeek.toLocaleString()}</span>
                        <span className={styles.statLabel}>Active This Week</span>
                    </div>
                    <div className={styles.statCard}>
                        <span className={styles.statValue}>{stats.usersWithWallets.toLocaleString()}</span>
                        <span className={styles.statLabel}>With Wallets</span>
                    </div>
                    <div className={styles.statCard}>
                        <span className={styles.statValue}>{stats.totalWalletLinks.toLocaleString()}</span>
                        <span className={styles.statLabel}>Wallet Links</span>
                    </div>
                    <div className={styles.statCard}>
                        <span className={styles.statValue}>{stats.averageWalletsPerUser.toFixed(2)}</span>
                        <span className={styles.statLabel}>Avg Wallets/User</span>
                    </div>
                </div>
            )}

            <div className={styles.controls}>
                <div className={styles.searchBox}>
                    <input
                        type="text"
                        className={styles.searchInput}
                        placeholder="Search by UUID or wallet address..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={handleKeyDown}
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
                <Button onClick={fetchUsers} size="sm" variant="ghost">
                    Refresh
                </Button>
            </div>

            {loading ? (
                <div className={styles.loading}>Loading users...</div>
            ) : users.length === 0 ? (
                <div className={styles.empty}>
                    {search ? `No users found matching "${search}"` : 'No users found'}
                </div>
            ) : (
                <>
                    <div className={styles.userList}>
                        {users.map((user) => (
                            <div
                                key={user.id}
                                className={`${styles.userCard} ${expandedUserId === user.id ? styles.expanded : ''}`}
                            >
                                <div
                                    className={styles.userHeader}
                                    onClick={() => setExpandedUserId(
                                        expandedUserId === user.id ? null : user.id
                                    )}
                                >
                                    <div className={styles.userInfo}>
                                        <span className={styles.userId}>{user.id}</span>
                                        <span className={styles.userMeta}>
                                            {user.wallets.length > 0 && (
                                                <span className={styles.walletBadge}>
                                                    {user.wallets.length} wallet{user.wallets.length !== 1 ? 's' : ''}
                                                </span>
                                            )}
                                            <span className={styles.pageViews}>
                                                {user.activity.pageViews} views
                                            </span>
                                        </span>
                                    </div>
                                    <div className={styles.userDates}>
                                        <span className={styles.lastSeen}>
                                            Last seen: {formatRelative(user.activity.lastSeen)}
                                        </span>
                                        <span className={styles.createdAt}>
                                            Created: {formatDate(user.createdAt)}
                                        </span>
                                    </div>
                                </div>

                                {expandedUserId === user.id && (
                                    <div className={styles.userDetails}>
                                        <div className={styles.detailSection}>
                                            <h4>Wallets</h4>
                                            {user.wallets.length === 0 ? (
                                                <p className={styles.noData}>No wallets linked</p>
                                            ) : (
                                                <ul className={styles.walletList}>
                                                    {user.wallets.map((wallet) => (
                                                        <li key={wallet.address} className={styles.walletItem}>
                                                            <code className={styles.walletAddress}>
                                                                {wallet.address}
                                                            </code>
                                                            {wallet.isPrimary && (
                                                                <span className={styles.primaryBadge}>Primary</span>
                                                            )}
                                                            {wallet.label && (
                                                                <span className={styles.walletLabel}>
                                                                    {wallet.label}
                                                                </span>
                                                            )}
                                                            <span className={styles.linkedAt}>
                                                                Linked: {formatDate(wallet.linkedAt)}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>

                                        <div className={styles.detailSection}>
                                            <h4>Preferences</h4>
                                            <dl className={styles.prefsList}>
                                                <dt>Theme</dt>
                                                <dd>{user.preferences.theme || 'system'}</dd>
                                                <dt>Notifications</dt>
                                                <dd>{user.preferences.notifications ? 'Enabled' : 'Disabled'}</dd>
                                                <dt>Timezone</dt>
                                                <dd>{user.preferences.timezone || 'Auto'}</dd>
                                                <dt>Language</dt>
                                                <dd>{user.preferences.language || 'English'}</dd>
                                            </dl>
                                        </div>

                                        <div className={styles.detailSection}>
                                            <h4>Activity</h4>
                                            <dl className={styles.prefsList}>
                                                <dt>First Seen</dt>
                                                <dd>{formatDate(user.activity.firstSeen)}</dd>
                                                <dt>Last Seen</dt>
                                                <dd>{formatDate(user.activity.lastSeen)}</dd>
                                                <dt>Page Views</dt>
                                                <dd>{user.activity.pageViews.toLocaleString()}</dd>
                                            </dl>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
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
                        <span className={styles.pageInfo}>
                            Page {page} of {totalPages} ({total} users)
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
