'use client';

import { useEffect, useState, useRef } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import {
    Users,
    Activity,
    RefreshCw,
    ChevronDown,
    ChevronRight,
    ExternalLink,
    Zap,
    TrendingUp,
    Clock,
    User
} from 'lucide-react';
import { PoolVolumeChart } from './components/PoolVolumeChart';
import styles from './PoolsPage.module.css';

/**
 * Pool data from the API response.
 */
interface IPoolData {
    poolAddress: string | null;
    poolName: string | null;
    totalAmountTrx: number;
    delegationCount: number;
    delegatorCount: number;
    recipientCount: number;
    selfSigned?: boolean;
}

/**
 * Pool delegation record from the API.
 */
interface IPoolDelegation {
    txId: string;
    timestamp: Date;
    fromAddress: string;
    toAddress: string;
    resourceType: 'ENERGY' | 'BANDWIDTH';
    amountSun: number;
    rentalPeriodMinutes: number;
    normalizedAmountTrx: number;
}

/**
 * Pool member data from the API.
 */
interface IPoolMember {
    account: string;
    pool: string;
    permissionId: number;
    permissionName: string;
    discoveredAt: Date;
    lastSeenAt: Date;
}

/**
 * Address book entry for human-readable names.
 */
interface IAddressBookEntry {
    address: string;
    name: string;
    category: string;
}

type TimePeriod = '24h' | '7d' | '30d';

/**
 * Energy Pools Page Component.
 *
 * Displays comprehensive pool analytics including:
 * - Doughnut chart showing delegation volume by pool
 * - List of all pools with expandable details
 * - Pool member information and recent delegations
 * - Real-time updates via WebSocket subscription
 *
 * @param props - Component props
 * @param props.context - Frontend plugin context with API and UI
 */
export function PoolsPage({ context }: { context: IFrontendPluginContext }) {
    const { api, ui } = context;
    const Card = ui.Card;

    const [pools, setPools] = useState<IPoolData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [period, setPeriod] = useState<TimePeriod>('24h');
    const [expandedPool, setExpandedPool] = useState<string | null>(null);
    const [poolDelegations, setPoolDelegations] = useState<Record<string, IPoolDelegation[]>>({});
    const [poolMembers, setPoolMembers] = useState<Record<string, IPoolMember[]>>({});
    const [addressBook, setAddressBook] = useState<Record<string, IAddressBookEntry>>({});
    const [loadingDetails, setLoadingDetails] = useState<string | null>(null);

    // Refs to pool list items for smooth scrolling when clicked from chart
    const poolRefs = useRef<Record<string, HTMLDivElement | null>>({});

    /**
     * Convert period string to hours for API request.
     */
    function periodToHours(p: TimePeriod): number {
        switch (p) {
            case '24h': return 24;
            case '7d': return 168;
            case '30d': return 720;
            default: return 24;
        }
    }

    /**
     * Load pool data from the API.
     */
    async function loadPools() {
        setLoading(true);
        setError(null);

        try {
            const [poolsResponse, addressBookResponse] = await Promise.all([
                api.get('/plugins/resource-tracking/pools', { hours: periodToHours(period) }),
                api.get('/plugins/resource-tracking/address-book')
            ]);

            setPools(poolsResponse.pools || []);

            // Convert address book array to lookup map
            const bookMap: Record<string, IAddressBookEntry> = {};
            for (const entry of addressBookResponse.entries || []) {
                bookMap[entry.address] = entry;
            }
            setAddressBook(bookMap);
        } catch (err) {
            console.error('Failed to load pool data:', err);
            setError('Failed to load pool data');
        } finally {
            setLoading(false);
        }
    }

    /**
     * Load pool details (delegations and members) for a specific pool.
     */
    async function loadPoolDetails(poolAddress: string) {
        setLoadingDetails(poolAddress);

        try {
            const [delegationsResponse, membersResponse] = await Promise.all([
                api.get(`/plugins/resource-tracking/pools/${poolAddress}/delegations`, { limit: 20 }),
                api.get(`/plugins/resource-tracking/pools/${poolAddress}/members`)
            ]);

            setPoolDelegations(prev => ({
                ...prev,
                [poolAddress]: delegationsResponse.delegations || []
            }));

            setPoolMembers(prev => ({
                ...prev,
                [poolAddress]: membersResponse.members || []
            }));
        } catch (err) {
            console.error('Failed to load pool details:', err);
        } finally {
            setLoadingDetails(null);
        }
    }

    useEffect(() => {
        void loadPools();
    }, [api, period]);

    // Subscribe to pool updates for real-time data push.
    // Backend emits aggregated pool data once per block - we receive the full dataset
    // directly via WebSocket instead of making API calls on each event.
    useEffect(() => {
        const { websocket } = context;
        let subscribed = false;

        /**
         * Handle aggregated pool data pushed from backend.
         * Receives complete dataset - no API call needed.
         */
        const handlePoolsUpdated = (data: {
            pools: IPoolData[];
            addressBook: Record<string, IAddressBookEntry>;
            hours: number;
            timestamp: number;
        }) => {
            setPools(data.pools || []);
            setAddressBook(data.addressBook || {});
            setLoading(false);
        };

        /**
         * Subscribe to the pool-updates room.
         * Guards against duplicate subscription calls.
         */
        const doSubscribe = () => {
            if (subscribed) return;
            subscribed = true;
            websocket.subscribe('pool-updates');
        };

        /**
         * Handle socket connection by subscribing to the room.
         * Socket.IO loses room memberships on reconnect, so we must resubscribe.
         */
        const handleConnect = () => {
            subscribed = false; // Reset on reconnect to allow resubscription
            doSubscribe();
        };

        // Listen for aggregated pool data (pushed once per block)
        websocket.on('pools:updated', handlePoolsUpdated);

        // Register connect handler first to catch connection events
        websocket.onConnect(handleConnect);

        // Then check if already connected (handles race condition where socket
        // connects between the onConnect registration and this check)
        if (websocket.isConnected()) {
            doSubscribe();
        }

        return () => {
            websocket.off('pools:updated', handlePoolsUpdated);
            websocket.offConnect(handleConnect);
            // Note: Don't unsubscribe here - React StrictMode double-invokes effects,
            // causing cleanup to run and unsubscribe AFTER subscribe. Room membership
            // is automatically cleaned up when the socket disconnects.
        };
    }, [context.websocket]);

    /**
     * Toggle pool expansion and load details if needed.
     * When expanding, smoothly scroll to the pool entry.
     */
    function handlePoolClick(poolAddress: string) {
        if (expandedPool === poolAddress) {
            setExpandedPool(null);
        } else {
            setExpandedPool(poolAddress);
            // Load details if not already loaded
            if (!poolDelegations[poolAddress]) {
                void loadPoolDetails(poolAddress);
            }
            // Smooth scroll to the pool entry after state update renders
            setTimeout(() => {
                const element = poolRefs.current[poolAddress];
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 50);
        }
    }

    /**
     * Format pool name for display, falling back to truncated address.
     */
    function formatPoolName(pool: IPoolData): string {
        if (pool.poolName) return pool.poolName;
        if (pool.poolAddress) {
            const entry = addressBook[pool.poolAddress];
            if (entry) return entry.name;
            return `${pool.poolAddress.slice(0, 6)}...${pool.poolAddress.slice(-4)}`;
        }
        return 'Unknown Pool';
    }

    /**
     * Format address with name lookup.
     */
    function formatAddress(address: string): string {
        const entry = addressBook[address];
        if (entry) return entry.name;
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    /**
     * Format TRX amount with K/M suffixes.
     */
    function formatTrx(amount: number): string {
        if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
        if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
        return amount.toFixed(0);
    }

    /**
     * Format rental duration from minutes.
     * Returns em dash when duration is unavailable.
     */
    function formatDuration(minutes: number | null | undefined): string {
        if (minutes == null) return '—';
        if (minutes >= 1440) {
            const days = Math.floor(minutes / 1440);
            return `${days}d`;
        }
        if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            return `${hours}h`;
        }
        return `${minutes}m`;
    }

    /**
     * Format timestamp to relative time.
     */
    function formatTimeAgo(date: Date): string {
        const now = new Date();
        const timestamp = new Date(date);
        const diffMs = now.getTime() - timestamp.getTime();
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
        return `${Math.floor(diffMins / 1440)}d ago`;
    }

    // Calculate total stats
    const totalVolume = pools.reduce((sum, p) => sum + p.totalAmountTrx, 0);
    const totalDelegations = pools.reduce((sum, p) => sum + p.delegationCount, 0);

    if (loading && pools.length === 0) {
        return (
            <main className={styles.page}>
                <div className={styles.loading}>
                    <RefreshCw className={styles.spinner} size={32} />
                    <span>Loading pool data...</span>
                </div>
            </main>
        );
    }

    if (error) {
        return (
            <main className={styles.page}>
                <div className={styles.error}>
                    <span>{error}</span>
                    <button onClick={() => void loadPools()} className={styles.retry_button}>
                        Retry
                    </button>
                </div>
            </main>
        );
    }

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <h1 className={styles.title}>
                    <Users size={28} style={{ display: 'inline-block', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                    Energy Pools
                </h1>
                <p className={styles.subtitle}>
                    Track delegation activity from TRON energy rental pools. Pools are detected by Permission_id &ge; 3 on delegation transactions.
                    {' '}<a className="link" href="https://tronrelic.com/tron-permission-id-lending-pool-signals" target="_blank" rel="noopener noreferrer">Learn more</a>.
                </p>
            </header>

            {/* Period selector - 7d/30d temporarily disabled until hourly aggregate queries are implemented */}
            <div className={styles.controls}>
                <div className={styles.period_selector}>
                    {(['24h'] as TimePeriod[]).map((p) => (
                        <button
                            key={p}
                            className={`${styles.period_button} ${period === p ? styles.period_button_active : ''}`}
                            onClick={() => setPeriod(p)}
                        >
                            {p}
                        </button>
                    ))}
                </div>
            </div>

            {/* Stats summary */}
            <div className={styles.stats_row}>
                <Card className={styles.stat_card}>
                    <div className={styles.stat_icon}>
                        <Users size={24} />
                    </div>
                    <div className={styles.stat_content}>
                        <span className={styles.stat_value}>{pools.length}</span>
                        <span className={styles.stat_label}>Active Pools</span>
                    </div>
                </Card>
                <Card className={styles.stat_card}>
                    <div className={styles.stat_icon}>
                        <Zap size={24} />
                    </div>
                    <div className={styles.stat_content}>
                        <span className={styles.stat_value}>{formatTrx(totalVolume)}</span>
                        <span className={styles.stat_label}>Total Volume (TRX)</span>
                    </div>
                </Card>
                <Card className={styles.stat_card}>
                    <div className={styles.stat_icon}>
                        <Activity size={24} />
                    </div>
                    <div className={styles.stat_content}>
                        <span className={styles.stat_value}>{totalDelegations.toLocaleString()}</span>
                        <span className={styles.stat_label}>Total Delegations</span>
                    </div>
                </Card>
            </div>

            <div className={styles.content_layout}>
                {/* Pool chart */}
                <div className={styles.chart_section}>
                    <PoolVolumeChart
                        context={context}
                        hours={periodToHours(period)}
                        onPoolClick={handlePoolClick}
                    />
                </div>

                {/* Pool list */}
                <div className={styles.list_section}>
                    <Card className={styles.pools_card}>
                        <h3 className={styles.section_title}>
                            <TrendingUp size={20} />
                            Pool Rankings
                        </h3>

                        {pools.length === 0 ? (
                            <div className={styles.empty}>
                                <Users size={48} className={styles.empty_icon} />
                                <p>No pool activity detected yet.</p>
                                <p className={styles.empty_hint}>
                                    Pool data accumulates as delegation transactions with Permission_id &ge; 3 are processed.
                                </p>
                            </div>
                        ) : (
                            <div className={styles.pool_list}>
                                {pools.map((pool, index) => {
                                    const isExpanded = expandedPool === pool.poolAddress;
                                    const delegations = pool.poolAddress ? poolDelegations[pool.poolAddress] : [];
                                    const members = pool.poolAddress ? poolMembers[pool.poolAddress] : [];
                                    const isLoadingThis = loadingDetails === pool.poolAddress;
                                    const percentage = totalVolume > 0 ? (pool.totalAmountTrx / totalVolume) * 100 : 0;

                                    return (
                                        <div
                                            key={pool.poolAddress || index}
                                            className={`${styles.pool_item} ${isExpanded ? styles['pool_item--expanded'] : ''}`}
                                            ref={el => { if (pool.poolAddress) poolRefs.current[pool.poolAddress] = el; }}
                                        >
                                            <button
                                                className={`${styles.pool_row} ${isExpanded ? styles['pool_row--expanded'] : ''}`}
                                                onClick={() => pool.poolAddress && handlePoolClick(pool.poolAddress)}
                                                disabled={!pool.poolAddress}
                                            >
                                                <div className={styles.pool_rank}>#{index + 1}</div>
                                                <div className={styles.pool_info}>
                                                    <span className={styles.pool_name}>
                                                        {formatPoolName(pool)}
                                                        {pool.selfSigned && (
                                                            <User
                                                                size={14}
                                                                className={styles.self_signed_icon}
                                                                title="Individual (self-signed custom permission)"
                                                            />
                                                        )}
                                                    </span>
                                                    <span className={styles.pool_address}>
                                                        {pool.poolAddress ? `${pool.poolAddress.slice(0, 10)}...` : 'Unknown'}
                                                    </span>
                                                </div>
                                                <div className={styles.pool_stats}>
                                                    <span className={styles.pool_volume}>{formatTrx(pool.totalAmountTrx)} TRX</span>
                                                    <span className={styles.pool_percentage}>{percentage.toFixed(1)}%</span>
                                                </div>
                                                <div className={styles.pool_meta}>
                                                    <span title="Delegations">{pool.delegationCount.toLocaleString()} txns</span>
                                                    <span title="Unique delegators">{pool.delegatorCount} delegators</span>
                                                </div>
                                                <div className={styles.pool_chevron}>
                                                    {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                                </div>
                                            </button>

                                            {isExpanded && pool.poolAddress && (
                                                <div className={styles.pool_details}>
                                                    {isLoadingThis ? (
                                                        <div className={styles.details_loading}>
                                                            <RefreshCw className={styles.spinner} size={20} />
                                                            <span>Loading details...</span>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            {/* Pool members section */}
                                                            {members && members.length > 0 && (
                                                                <div className={styles.detail_section}>
                                                                    <h4 className={styles.detail_title}>
                                                                        <Users size={16} />
                                                                        Pool Members ({members.length})
                                                                    </h4>
                                                                    <div className={styles.members_grid}>
                                                                        {members.slice(0, 10).map((member, i) => (
                                                                            <div key={i} className={styles.member_item}>
                                                                                <span className={styles.member_address}>
                                                                                    {formatAddress(member.account)}
                                                                                </span>
                                                                                <span className={styles.member_permission}>
                                                                                    {member.permissionName || `Permission ${member.permissionId}`}
                                                                                </span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* Recent delegations section */}
                                                            {delegations && delegations.length > 0 && (
                                                                <div className={styles.detail_section}>
                                                                    <h4 className={styles.detail_title}>
                                                                        <Clock size={16} />
                                                                        Recent Delegations
                                                                    </h4>
                                                                    <div className={styles.delegations_table}>
                                                                        {delegations.slice(0, 10).map((delegation, i) => (
                                                                            <div key={i} className={styles.delegation_row}>
                                                                                <div className={styles.delegation_time}>
                                                                                    {formatTimeAgo(delegation.timestamp)}
                                                                                </div>
                                                                                <div className={styles.delegation_addresses}>
                                                                                    <span>{formatAddress(delegation.fromAddress)}</span>
                                                                                    <span className={styles.arrow}>→</span>
                                                                                    <span>{formatAddress(delegation.toAddress)}</span>
                                                                                </div>
                                                                                <div className={styles.delegation_amount}>
                                                                                    {formatTrx(delegation.normalizedAmountTrx)} TRX
                                                                                </div>
                                                                                <div className={styles.delegation_duration}>
                                                                                    {formatDuration(delegation.rentalPeriodMinutes)}
                                                                                </div>
                                                                                <a
                                                                                    href={`https://tronscan.org/#/transaction/${delegation.txId}`}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    className={styles.delegation_link}
                                                                                    onClick={e => e.stopPropagation()}
                                                                                >
                                                                                    <ExternalLink size={14} />
                                                                                </a>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {(!delegations || delegations.length === 0) && (!members || members.length === 0) && (
                                                                <div className={styles.no_details}>
                                                                    No detailed data available for this pool yet.
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Card>
                </div>
            </div>
        </main>
    );
}
