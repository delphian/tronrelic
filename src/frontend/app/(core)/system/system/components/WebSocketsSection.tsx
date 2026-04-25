'use client';

import { useCallback, useEffect, useState } from 'react';
import { Radio, Activity, Users, Send, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import type { IPluginWebSocketStats, IAggregatePluginWebSocketStats } from '@/types';
import { Badge } from '../../../../../components/ui/Badge';
import { Stack, Grid } from '../../../../../components/layout';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { getRuntimeConfig } from '../../../../../lib/runtimeConfig';
import { HealthMetric } from './HealthMetric';
import styles from './WebSocketsSection.module.scss';

interface Props {
    token: string;
}

/**
 * WebSocket monitoring body.
 *
 * Rendered inside a CollapsibleSection — this component only mounts when
 * the section is expanded, which means the 5-second polling interval
 * does not start until the admin opens the section. Per-plugin
 * breakdowns expand inline to show their rooms without a separate route.
 *
 * Auth follows the canonical admin pattern from docs/system/system-api.md:
 * X-Admin-Token header against ${runtimeConfig.apiUrl}/admin/...
 * URLs. Token presence is guaranteed by SystemAuthGate higher in the tree.
 */
export function WebSocketsSection({ token }: Props) {
    const [aggregate, setAggregate] = useState<IAggregatePluginWebSocketStats | null>(null);
    const [pluginStats, setPluginStats] = useState<IPluginWebSocketStats[]>([]);
    const [error, setError] = useState<string | null>(null);
    const runtimeConfig = getRuntimeConfig();

    const fetchStats = useCallback(async () => {
        try {
            const [aggregateRes, statsRes] = await Promise.all([
                fetch(`${runtimeConfig.apiUrl}/admin/system/websockets/aggregate`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiUrl}/admin/system/websockets/stats`, {
                    headers: { 'X-Admin-Token': token }
                })
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
    }, [token, runtimeConfig.apiUrl]);

    useEffect(() => {
        void fetchStats();
        const interval = setInterval(() => void fetchStats(), 5000);
        return () => clearInterval(interval);
    }, [fetchStats]);

    return (
        <Stack gap="md">
            {error && (
                <div className="alert alert--danger" role="alert">
                    {error}
                </div>
            )}

            {aggregate && (
                <>
                    <Grid columns="responsive" gap="sm">
                        <HealthMetric
                            icon={<Radio size={20} />}
                            label="Plugins"
                            value={aggregate.totalPlugins.toLocaleString()}
                            detail="with WebSocket handlers"
                        />
                        <HealthMetric
                            icon={<Users size={20} />}
                            label="Active Subscriptions"
                            value={aggregate.totalSubscriptions.toLocaleString()}
                            detail={`across ${aggregate.totalRooms.toLocaleString()} rooms`}
                        />
                        <HealthMetric
                            icon={<Send size={20} />}
                            label="Events Emitted"
                            value={aggregate.totalEventsEmitted.toLocaleString()}
                            detail="since startup"
                        />
                        <HealthMetric
                            icon={<AlertTriangle size={20} />}
                            label="Subscription Errors"
                            value={aggregate.totalSubscriptionErrors.toLocaleString()}
                            tone={aggregate.totalSubscriptionErrors > 0 ? 'danger' : 'neutral'}
                            detail="total failures"
                        />
                    </Grid>

                    {aggregate.mostActivePlugin && (
                        <p className={styles.most_active}>
                            <strong>Most active plugin:</strong>{' '}
                            {aggregate.mostActivePlugin.pluginId}{' '}
                            ({aggregate.mostActivePlugin.subscriptionCount.toLocaleString()} subscriptions)
                        </p>
                    )}
                </>
            )}

            <div className={styles.plugin_list}>
                {pluginStats.length === 0 ? (
                    <p className="text-muted">No plugins with WebSocket capabilities found.</p>
                ) : (
                    pluginStats.map((stats) => <PluginStats key={stats.pluginId} stats={stats} />)
                )}
            </div>
        </Stack>
    );
}

interface PluginStatsProps {
    stats: IPluginWebSocketStats;
}

/**
 * Per-plugin row with expandable room breakdown.
 */
function PluginStats({ stats }: PluginStatsProps) {
    const [expanded, setExpanded] = useState(false);
    const hasErrors = stats.totalSubscriptionErrors > 0;

    return (
        <article className={styles.plugin}>
            <header className={styles.plugin_header}>
                <div className={styles.plugin_identity}>
                    <h3 className={styles.plugin_title}>{stats.pluginTitle}</h3>
                    <code className={styles.plugin_id}>{stats.pluginId}</code>
                </div>
                {stats.hasSubscriptionHandler && <Badge tone="success">Active</Badge>}
            </header>

            <Grid columns="responsive" gap="sm">
                <HealthMetric
                    icon={<Activity size={20} />}
                    label="Active Rooms"
                    value={stats.activeRooms.toLocaleString()}
                />
                <HealthMetric
                    icon={<Users size={20} />}
                    label="Subscriptions"
                    value={stats.totalSubscriptions.toLocaleString()}
                />
                <HealthMetric
                    icon={<Send size={20} />}
                    label="Events Emitted"
                    value={stats.totalEventsEmitted.toLocaleString()}
                />
                <HealthMetric
                    icon={<Send size={20} />}
                    label="Events / min"
                    value={stats.eventsPerMinute.toLocaleString()}
                />
                <HealthMetric
                    icon={<AlertTriangle size={20} />}
                    label="Errors"
                    value={stats.totalSubscriptionErrors.toLocaleString()}
                    tone={hasErrors ? 'danger' : 'neutral'}
                />
            </Grid>

            {stats.roomStats.length > 0 && (
                <div className={styles.rooms}>
                    <button
                        type="button"
                        className={styles.rooms_toggle}
                        onClick={() => setExpanded((prev) => !prev)}
                        aria-expanded={expanded}
                    >
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
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
                                        {room.memberCount === 1 ? 'subscriber' : 'subscribers'}
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
