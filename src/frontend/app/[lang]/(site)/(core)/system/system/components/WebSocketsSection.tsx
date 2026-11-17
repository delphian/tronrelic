'use client';

/**
 * @fileoverview WebSockets tab body: aggregate counts, then one table row per
 * plugin.
 *
 * The plugins used to get a bordered box each, with a five-cell strip and two
 * more lines inside it, so eight plugins took over a thousand pixels and the
 * figures could not be compared down a column. One table puts every plugin's
 * figures in the same columns, and a plugin's rooms open as a row under it.
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { IPluginWebSocketStats, IAggregatePluginWebSocketStats } from '@/types';
import { Stack } from '../../../../../../../components/layout';
import { Panel } from '../../../../../../../components/ui/Panel';
import { Badge } from '../../../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../../../components/ui/ClientTime';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../../components/ui/Table';
import { StatStrip } from './StatStrip';
import styles from './WebSocketsSection.module.scss';

/** How often the counts refresh while the tab is open, in milliseconds. */
const WEBSOCKET_REFRESH_MS = 5000;

/** Columns in a plugin row, which a room list row spans. */
const PLUGIN_COLUMNS = 7;

/**
 * WebSocket monitoring body.
 *
 * Polls every five seconds while mounted. The aggregate counts render as one
 * strip, and the per-plugin figures as one table whose rows open to list
 * each plugin's rooms.
 *
 * @returns The tab's panels.
 */
export function WebSocketsSection() {
    const [aggregate, setAggregate] = useState<IAggregatePluginWebSocketStats | null>(null);
    const [pluginStats, setPluginStats] = useState<IPluginWebSocketStats[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    /**
     * Load the aggregate and per-plugin counts together, so the strip and the
     * table never show figures from two different moments.
     */
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
        const interval = setInterval(() => void fetchStats(), WEBSOCKET_REFRESH_MS);
        return () => clearInterval(interval);
    }, [fetchStats]);

    /**
     * Open or close one plugin's room list.
     *
     * @param pluginId - The plugin whose row was clicked.
     */
    const toggleRooms = useCallback((pluginId: string) => {
        setExpanded((current) => {
            const next = new Set(current);
            if (next.has(pluginId)) {
                next.delete(pluginId);
            } else {
                next.add(pluginId);
            }
            return next;
        });
    }, []);

    return (
        <Stack gap="lg">
            {error && <p className="alert" role="alert">{error}</p>}

            {aggregate && (
                <Panel
                    title="Aggregate"
                    meta={aggregate.mostActivePlugin
                        ? <>Most active: <code className={styles.code}>{aggregate.mostActivePlugin.pluginId}</code> ({aggregate.mostActivePlugin.subscriptionCount.toLocaleString()} subs)</>
                        : undefined}
                >
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
                </Panel>
            )}

            <Panel title="Plugins" meta="Select a plugin with rooms to list them.">
                {pluginStats.length === 0 ? (
                    <p className="text-muted">No plugins with WebSocket capabilities found.</p>
                ) : (
                    <Table variant="compact" flush stackAt="mobile">
                        <Thead>
                            <Tr>
                                <Th scope="col">Plugin</Th>
                                <Th scope="col" numeric>Rooms</Th>
                                <Th scope="col" numeric>Subs</Th>
                                <Th scope="col" numeric>Events</Th>
                                <Th scope="col" numeric>Events/min</Th>
                                <Th scope="col" numeric>Errors</Th>
                                <Th scope="col" width="shrink">Last event</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {pluginStats.map((stats) => (
                                <PluginRows
                                    key={stats.pluginId}
                                    stats={stats}
                                    expanded={expanded.has(stats.pluginId)}
                                    onToggle={toggleRooms}
                                />
                            ))}
                        </Tbody>
                    </Table>
                )}
            </Panel>
        </Stack>
    );
}

/** Inputs for one plugin's rows. */
interface IPluginRowsProps {
    /** The plugin's counts and rooms. */
    stats: IPluginWebSocketStats;
    /** Whether the plugin's room list is open. */
    expanded: boolean;
    /** Opens or closes the room list, keyed by plugin id. */
    onToggle: (pluginId: string) => void;
}

/**
 * One plugin's row, followed by its room list while the row is open.
 *
 * A plugin with no rooms has nothing to open, so its row is not clickable.
 *
 * @param props - The plugin, whether its rooms are showing, and the toggle.
 * @returns The plugin row and, when open, the room list row.
 */
function PluginRows({ stats, expanded, onToggle }: IPluginRowsProps) {
    const hasRooms = stats.roomStats.length > 0;
    const Chevron = expanded ? ChevronDown : ChevronRight;

    return (
        <Fragment>
            <Tr
                onClick={hasRooms ? () => onToggle(stats.pluginId) : undefined}
                isExpanded={hasRooms ? expanded : undefined}
            >
                <Td>
                    <span className={styles.plugin}>
                        {hasRooms && <Chevron size={14} aria-hidden className={styles.chevron} />}
                        <span>
                            <span className={styles.plugin_title}>{stats.pluginTitle}</span>
                            <code className={styles.plugin_id}>{stats.pluginId}</code>
                        </span>
                        {stats.hasSubscriptionHandler && <Badge tone="success" size="xs">Active</Badge>}
                    </span>
                </Td>
                <Td label="Rooms" numeric>{stats.activeRooms.toLocaleString()}</Td>
                <Td label="Subs" numeric>{stats.totalSubscriptions.toLocaleString()}</Td>
                <Td label="Events" numeric>{stats.totalEventsEmitted.toLocaleString()}</Td>
                <Td label="Events/min" numeric>{stats.eventsPerMinute.toLocaleString()}</Td>
                <Td label="Errors" numeric>
                    {stats.totalSubscriptionErrors > 0
                        ? <Badge tone="danger" size="xs">{stats.totalSubscriptionErrors.toLocaleString()}</Badge>
                        : '0'}
                </Td>
                <Td label="Last event" muted>
                    {stats.lastEventEmittedAt ? <ClientTime date={stats.lastEventEmittedAt} format="relative" /> : '—'}
                </Td>
            </Tr>
            {hasRooms && expanded && (
                <Tr isExpanded>
                    <Td colSpan={PLUGIN_COLUMNS}>
                        <ul className={styles.rooms} aria-label={`${stats.pluginTitle} rooms`}>
                            {stats.roomStats.map((room) => (
                                <li key={room.fullRoomName} className={styles.room}>
                                    <span className={styles.room_short}>{room.roomName}</span>
                                    <code className={styles.room_full}>{room.fullRoomName}</code>
                                    <span className={styles.room_count}>
                                        {room.memberCount.toLocaleString()} {room.memberCount === 1 ? 'sub' : 'subs'}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </Td>
                </Tr>
            )}
        </Fragment>
    );
}
