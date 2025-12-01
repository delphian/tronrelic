'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { config as runtimeConfig } from '../../../../lib/config';
import { Button } from '../../../../components/ui/Button';
import { ClientTime } from '../../../../components/ui/ClientTime';
import styles from './UsersMonitor.module.css';

/**
 * Format seconds into a human-readable duration string.
 */
function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/**
 * Get device emoji for display.
 */
function getDeviceEmoji(device: DeviceCategory): string {
    switch (device) {
        case 'mobile': return '📱';
        case 'tablet': return '📲';
        case 'desktop': return '🖥️';
        default: return '❓';
    }
}

interface WalletLink {
    address: string;
    linkedAt: string;
    isPrimary: boolean;
    verified: boolean;
    lastUsed: string;
    label?: string;
}

interface UserPreferences {
    theme?: 'light' | 'dark' | 'system';
    notifications?: boolean;
    timezone?: string;
    language?: string;
}

/** Device category derived from user-agent */
type DeviceCategory = 'mobile' | 'tablet' | 'desktop' | 'unknown';

/** A page visit within a session */
interface PageVisit {
    path: string;
    timestamp: string;
}

/** A user session with engagement metrics */
interface UserSession {
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number;
    pages: PageVisit[];
    device: DeviceCategory;
    referrerDomain: string | null;
    country: string | null;
}

interface UserActivity {
    firstSeen: string;
    lastSeen: string;
    pageViews: number;
    sessionsCount: number;
    totalDurationSeconds: number;
    sessions: UserSession[];
    pageViewsByPath: Record<string, number>;
    countryCounts: Record<string, number>;
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
                    <div className={styles.stat_card}>
                        <span className={styles.stat_value}>{stats.totalUsers.toLocaleString()}</span>
                        <span className={styles.stat_label}>Total Users</span>
                    </div>
                    <div className={styles.stat_card}>
                        <span className={styles.stat_value}>{stats.activeToday.toLocaleString()}</span>
                        <span className={styles.stat_label}>Active Today</span>
                    </div>
                    <div className={styles.stat_card}>
                        <span className={styles.stat_value}>{stats.activeThisWeek.toLocaleString()}</span>
                        <span className={styles.stat_label}>Active This Week</span>
                    </div>
                    <div className={styles.stat_card}>
                        <span className={styles.stat_value}>{stats.usersWithWallets.toLocaleString()}</span>
                        <span className={styles.stat_label}>With Wallets</span>
                    </div>
                    <div className={styles.stat_card}>
                        <span className={styles.stat_value}>{stats.totalWalletLinks.toLocaleString()}</span>
                        <span className={styles.stat_label}>Wallet Links</span>
                    </div>
                    <div className={styles.stat_card}>
                        <span className={styles.stat_value}>{stats.averageWalletsPerUser.toFixed(2)}</span>
                        <span className={styles.stat_label}>Avg Wallets/User</span>
                    </div>
                </div>
            )}

            <div className={styles.controls}>
                <div className={styles.search_box}>
                    <input
                        type="text"
                        className={styles.search_input}
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
                    <div className={styles.user_list}>
                        {users.map((user) => (
                            <div
                                key={user.id}
                                className={`${styles.user_card} ${expandedUserId === user.id ? styles.expanded : ''}`}
                            >
                                <div
                                    className={styles.user_header}
                                    onClick={() => setExpandedUserId(
                                        expandedUserId === user.id ? null : user.id
                                    )}
                                >
                                    <div className={styles.user_info}>
                                        <span className={styles.user_id}>{user.id}</span>
                                        <span className={styles.user_meta}>
                                            {user.wallets.length > 0 && (
                                                <span className={styles.wallet_badge}>
                                                    {user.wallets.length} wallet{user.wallets.length !== 1 ? 's' : ''}
                                                </span>
                                            )}
                                            <span className={styles.page_views}>
                                                {user.activity.pageViews} views
                                            </span>
                                        </span>
                                    </div>
                                    <div className={styles.user_dates}>
                                        <span className={styles.last_seen}>
                                            Last seen: <ClientTime date={user.activity.lastSeen} format="relative" />
                                        </span>
                                        <span className={styles.created_at}>
                                            Created: <ClientTime date={user.createdAt} format="short" />
                                        </span>
                                    </div>
                                </div>

                                {expandedUserId === user.id && (
                                    <div className={styles.user_details}>
                                        <div className={styles.detail_section}>
                                            <h4>Wallets</h4>
                                            {user.wallets.length === 0 ? (
                                                <p className={styles.no_data}>No wallets linked</p>
                                            ) : (
                                                <ul className={styles.wallet_list}>
                                                    {user.wallets.map((wallet) => (
                                                        <li key={wallet.address} className={styles.wallet_item}>
                                                            <code className={styles.wallet_address}>
                                                                {wallet.address}
                                                            </code>
                                                            <div className={styles.wallet_badges}>
                                                                {wallet.isPrimary && (
                                                                    <span className={styles.primary_badge}>Primary</span>
                                                                )}
                                                                {wallet.verified ? (
                                                                    <span className={styles.verified_badge}>Verified</span>
                                                                ) : (
                                                                    <span className={styles.unverified_badge}>Unverified</span>
                                                                )}
                                                            </div>
                                                            {wallet.label && (
                                                                <span className={styles.wallet_label}>
                                                                    {wallet.label}
                                                                </span>
                                                            )}
                                                            <span className={styles.linked_at}>
                                                                Linked: <ClientTime date={wallet.linkedAt} format="short" />
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>

                                        <div className={styles.detail_section}>
                                            <h4>Preferences</h4>
                                            <dl className={styles.prefs_list}>
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

                                        <div className={styles.detail_section}>
                                            <h4>Activity</h4>
                                            <dl className={styles.prefs_list}>
                                                <dt>First Seen</dt>
                                                <dd><ClientTime date={user.activity.firstSeen} format="short" /></dd>
                                                <dt>Last Seen</dt>
                                                <dd><ClientTime date={user.activity.lastSeen} format="short" /></dd>
                                                <dt>Page Views</dt>
                                                <dd>{user.activity.pageViews.toLocaleString()}</dd>
                                                <dt>Sessions</dt>
                                                <dd>{user.activity.sessionsCount.toLocaleString()}</dd>
                                                <dt>Total Time</dt>
                                                <dd>{formatDuration(user.activity.totalDurationSeconds)}</dd>
                                            </dl>
                                        </div>

                                        {/* Country Distribution */}
                                        <div className={styles.detail_section}>
                                            <h4>Countries</h4>
                                            {!user.activity.countryCounts || Object.keys(user.activity.countryCounts).length === 0 ? (
                                                <p className={styles.no_data}>No country data</p>
                                            ) : (
                                                <div className={styles.country_list}>
                                                    {Object.entries(user.activity.countryCounts)
                                                        .sort(([, a], [, b]) => b - a)
                                                        .slice(0, 10)
                                                        .map(([country, count]) => (
                                                            <div key={country} className={styles.country_item}>
                                                                <span className={styles.country_code}>{country || 'Unknown'}</span>
                                                                <span className={styles.country_count}>{count}</span>
                                                            </div>
                                                        ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Recent Sessions */}
                                        <div className={styles.detail_section}>
                                            <h4>Recent Sessions</h4>
                                            {!user.activity.sessions || user.activity.sessions.length === 0 ? (
                                                <p className={styles.no_data}>No session data</p>
                                            ) : (
                                                <div className={styles.sessions_list}>
                                                    {user.activity.sessions.slice(0, 5).map((session) => (
                                                        <div key={session.startedAt} className={styles.session_item}>
                                                            <div className={styles.session_header}>
                                                                <span className={styles.session_device}>
                                                                    {getDeviceEmoji(session.device)} {session.device}
                                                                </span>
                                                                {session.country && (
                                                                    <span className={styles.session_country}>
                                                                        {session.country}
                                                                    </span>
                                                                )}
                                                                {session.referrerDomain && (
                                                                    <span className={styles.session_referrer}>
                                                                        from {session.referrerDomain}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className={styles.session_meta}>
                                                                <span className={styles.session_duration}>
                                                                    {formatDuration(session.durationSeconds)}
                                                                </span>
                                                                <span className={styles.session_time}>
                                                                    <ClientTime date={session.startedAt} format="relative" />
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Top Pages */}
                                        <div className={styles.detail_section}>
                                            <h4>Top Pages</h4>
                                            {!user.activity.pageViewsByPath || Object.keys(user.activity.pageViewsByPath).length === 0 ? (
                                                <p className={styles.no_data}>No page data</p>
                                            ) : (
                                                <div className={styles.pages_list}>
                                                    {Object.entries(user.activity.pageViewsByPath)
                                                        .sort(([, a], [, b]) => b - a)
                                                        .slice(0, 10)
                                                        .map(([path, count]) => (
                                                            <div key={path} className={styles.page_item}>
                                                                <span className={styles.page_path}>{path}</span>
                                                                <span className={styles.page_count}>{count}</span>
                                                            </div>
                                                        ))}
                                                </div>
                                            )}
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
                        <span className={styles.page_info}>
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
