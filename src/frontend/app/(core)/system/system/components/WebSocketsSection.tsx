'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { IPluginWebSocketStats, IAggregatePluginWebSocketStats } from '@/types';
import { Badge } from '../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { StatStrip } from './StatStrip';
import styles from './WebSocketsSection.module.scss';

/**
 * WebSocket monitoring body.
 *
 * Polls every 5s while mounted. Aggregate metrics render as a single
 * StatStrip; per-plugin breakdowns expand inline as a flat list of mini
 * strips so an admin can scan all sockets without nested cards.
 */
export function WebSocketsSection() {
    const [aggregate, setAggregate] = useState<IAggregatePluginWebSocketStats | null>(null);
    const [pluginStats, setPluginStats] = useState<IPluginWebSocketStats[]>([]);
    const [error, setError] = useState<string | null>(null);

    const fetchStats = useCallback(async () => {
        try {
            const [aggregateRes, statsRes] = await Promise.all([
                fetch(`/api/admin/system/websockets/aggregate`),
                fetch(`/api/admin/system/websockets/stats`)
            ]);

            if (!aggregateRes.ok || !statsRes.ok) {
                throw new Error('Failed to fetch WebSocket statistics');
            }

            const aggregateData = await aggregateRes.json();
            const statsData = await statsRes.json();

            setAggregate(aggregateData.aggregate);
            setPluginStats(statsData.stats);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        }
    }, []);

    useEffect(() => {
        void fetchStats();
        const interval = setInterval(() => void fetchStats(), 5000);
        return () => clearInterval(interval);
    }, [fetchStats]);

    return (
        <div className={styles.subsection}>
            {error && (
                <div className="alert alert--danger" role="alert">
                    {error}
                </div>
            )}

            {aggregate && (
                <div className={styles.block}>
                    <h4 className={styles.block_title}>Aggregate</h4>
                    <StatStrip
                        items={[
                            {
                                label: 'Plugins',
                                value: aggregate.totalPlugins.toLocaleString(),
                                detail: 'with handlers'
                            },
                            {
                                label: 'Subscriptions',
                                value: aggregate.totalSubscriptions.toLocaleString(),
                                detail: `${aggregate.totalRooms.toLocaleString()} rooms`
                            },
                            {
                                label: 'Events Emitted',
                                value: aggregate.totalEventsEmitted.toLocaleString(),
                                detail: 'since startup'
                            },
                            {
                                label: 'Sub Errors',
                                value: aggregate.totalSubscriptionErrors.toLocaleString(),
                                detail: 'total failures',
                                tone: aggregate.totalSubscriptionErrors > 0 ? 'danger' : undefined
                            }
                        ]}
                    />
                    {aggregate.mostActivePlugin && (
                        <p className={styles.block_note}>
                            Most active: <code>{aggregate.mostActivePlugin.pluginId}</code>{' '}
                            ({aggregate.mostActivePlugin.subscriptionCount.toLocaleString()} subs)
                        </p>
                    )}
                </div>
            )}

            <div className={styles.block}>
                <h4 className={styles.block_title}>Plugins</h4>
                <div className={styles.plugin_list}>
                    {pluginStats.length === 0 ? (
                        <p className={styles.block_note}>No plugins with WebSocket capabilities found.</p>
                    ) : (
                        pluginStats.map((stats) => <PluginStats key={stats.pluginId} stats={stats} />)
                    )}
                </div>
            </div>
        </div>
    );
}

interface PluginStatsProps {
    stats: IPluginWebSocketStats;
}

function PluginStats({ stats }: PluginStatsProps) {
    const [expanded, setExpanded] = useState(false);
    const hasErrors = stats.totalSubscriptionErrors > 0;

    return (
        <article className={styles.plugin}>
            <header className={styles.plugin_header}>
                <div className={styles.plugin_identity}>
                    <span className={styles.plugin_title}>{stats.pluginTitle}</span>
                    <code className={styles.plugin_id}>{stats.pluginId}</code>
                </div>
                {stats.hasSubscriptionHandler && <Badge tone="success">Active</Badge>}
            </header>

            <StatStrip
                minColWidth="100px"
                items={[
                    { label: 'Rooms', value: stats.activeRooms.toLocaleString() },
                    { label: 'Subs', value: stats.totalSubscriptions.toLocaleString() },
                    { label: 'Events', value: stats.totalEventsEmitted.toLocaleString() },
                    { label: 'Events/min', value: stats.eventsPerMinute.toLocaleString() },
                    {
                        label: 'Errors',
                        value: stats.totalSubscriptionErrors.toLocaleString(),
                        tone: hasErrors ? 'danger' : undefined
                    }
                ]}
            />

            {stats.roomStats.length > 0 && (
                <div className={styles.rooms}>
                    <button
                        type="button"
                        className={styles.rooms_toggle}
                        onClick={() => setExpanded((prev) => !prev)}
                        aria-expanded={expanded}
                    >
                        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        Room details ({stats.roomStats.length})
                    </button>
                    {expanded && (
                        <ul className={styles.rooms_list}>
                            {stats.roomStats.map((room) => (
                                <li key={room.fullRoomName} className={styles.room}>
                                    <div className={styles.room_names}>
                                        <span className={styles.room_short}>{room.roomName}</span>
                                        <code className={styles.room_full}>{room.fullRoomName}</code>
                                    </div>
                                    <Badge tone={room.memberCount > 0 ? 'success' : 'neutral'}>
                                        {room.memberCount.toLocaleString()}{' '}
                                        {room.memberCount === 1 ? 'sub' : 'subs'}
                                    </Badge>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {stats.lastEventEmittedAt && (
                <footer className={styles.plugin_footer}>
                    Last event: <ClientTime date={stats.lastEventEmittedAt} format="datetime" />
                </footer>
            )}
        </article>
    );
}
