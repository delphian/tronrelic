'use client';

import { useCallback, useEffect, useState } from 'react';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { getRuntimeConfig } from '../../../../../lib/runtimeConfig';
import { cn } from '../../../../../lib/cn';
import styles from './OverviewBar.module.scss';

type Status = 'ok' | 'warn' | 'down' | 'idle' | 'loading';

interface SystemTile {
    id: string;
    label: string;
    status: Status;
    primary: string;
    secondary?: string;
}

interface RedisStatus {
    connected: boolean;
    responseTime: number | null;
}

interface BlockchainStatus {
    lag: number;
    isHealthy: boolean;
    netCatchUpRate: number | null;
    liveChainThrottleBlocks: number;
}

interface BlockchainMetrics {
    successRate: number;
}

interface DatabaseStatus {
    connected: boolean;
    responseTime: number | null;
}

interface ClickHouseStatus {
    connected: boolean;
}

interface ServerMetrics {
    uptime: number;
    cpuUsage: number;
}

interface AggregateWebSocketStats {
    totalSubscriptions: number;
    totalSubscriptionErrors: number;
    totalRooms: number;
}

/**
 * Always-on telemetry strip rendered above the system console.
 *
 * Polls the lightest health endpoint on each subsystem every 15s so
 * admins get a true bird's-eye view without expanding any console row.
 * Each tile shows a status dot, the system name in caps, and one or two
 * monospace KPIs. Clicking a tile scrolls to the matching ConsoleRow.
 *
 * Polling is independent of the per-section bodies — the strip stays
 * live even with every section collapsed, which is the entire reason
 * for its existence.
 */
export function OverviewBar() {
    const runtimeConfig = getRuntimeConfig();
    const [tiles, setTiles] = useState<SystemTile[]>(initialTiles());
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);

    const fetchAll = useCallback(async () => {
        const apiUrl = runtimeConfig.apiUrl;

        const [redisRes, serverRes, chainStatusRes, chainMetricsRes, mongoRes, clickhouseRes, websocketsRes] =
            await Promise.allSettled([
                fetch(`${apiUrl}/admin/system/health/redis`).then((r) => r.json()),
                fetch(`${apiUrl}/admin/system/health/server`).then((r) => r.json()),
                fetch(`${apiUrl}/admin/system/blockchain/status`).then((r) => r.json()),
                fetch(`${apiUrl}/admin/system/blockchain/metrics`).then((r) => r.json()),
                fetch(`${apiUrl}/admin/system/health/database`).then((r) => r.json()),
                fetch(`${apiUrl}/admin/system/health/clickhouse`).then((r) => r.json()),
                fetch(`${apiUrl}/admin/system/websockets/aggregate`).then((r) => r.json())
            ]);

        const redis = redisRes.status === 'fulfilled' ? (redisRes.value.status as RedisStatus | null) : null;
        const server = serverRes.status === 'fulfilled' ? (serverRes.value.metrics as ServerMetrics | null) : null;
        const chain = chainStatusRes.status === 'fulfilled' ? (chainStatusRes.value.status as BlockchainStatus | null) : null;
        const chainMetrics = chainMetricsRes.status === 'fulfilled' ? (chainMetricsRes.value.metrics as BlockchainMetrics | null) : null;
        const mongo = mongoRes.status === 'fulfilled' ? (mongoRes.value.status as DatabaseStatus | null) : null;
        const clickhouse = clickhouseRes.status === 'fulfilled' ? (clickhouseRes.value.status as ClickHouseStatus | null) : null;
        const ws = websocketsRes.status === 'fulfilled' ? (websocketsRes.value.aggregate as AggregateWebSocketStats | null) : null;

        setTiles([
            buildConfigTile(),
            buildServerTile(redis, server),
            buildBlockchainTile(chain, chainMetrics),
            buildWebsocketsTile(ws),
            buildMongoTile(mongo),
            buildClickHouseTile(clickhouse)
        ]);
        setLastUpdated(new Date().toISOString());
    }, [runtimeConfig.apiUrl]);

    useEffect(() => {
        void fetchAll();
        const interval = setInterval(() => void fetchAll(), 15000);
        return () => clearInterval(interval);
    }, [fetchAll]);

    return (
        <div className={styles.bar} role="region" aria-label="System telemetry overview">
            <div className={styles.tiles}>
                {tiles.map((tile) => (
                    <a key={tile.id} href={`#${tile.id}`} className={styles.tile}>
                        <span
                            className={cn(
                                styles.dot,
                                tile.status === 'ok' && styles.dot_ok,
                                tile.status === 'warn' && styles.dot_warn,
                                tile.status === 'down' && styles.dot_down,
                                tile.status === 'idle' && styles.dot_idle,
                                tile.status === 'loading' && styles.dot_loading
                            )}
                            aria-hidden="true"
                        />
                        <span className={styles.label}>{tile.label}</span>
                        <span className={styles.primary}>{tile.primary}</span>
                        {tile.secondary && <span className={styles.secondary}>{tile.secondary}</span>}
                    </a>
                ))}
            </div>
            <div className={styles.meta}>
                <span className={styles.meta_label}>Refresh 15s</span>
                {lastUpdated && (
                    <span className={styles.meta_time}>
                        <ClientTime date={lastUpdated} format="time" />
                    </span>
                )}
            </div>
        </div>
    );
}

function initialTiles(): SystemTile[] {
    return [
        { id: 'config', label: 'Config', status: 'idle', primary: '—' },
        { id: 'server', label: 'Server', status: 'loading', primary: '—' },
        { id: 'blockchain', label: 'Chain', status: 'loading', primary: '—' },
        { id: 'websockets', label: 'Sockets', status: 'loading', primary: '—' },
        { id: 'mongo', label: 'Mongo', status: 'loading', primary: '—' },
        { id: 'clickhouse', label: 'ClickHouse', status: 'loading', primary: '—' }
    ];
}

function buildConfigTile(): SystemTile {
    return { id: 'config', label: 'Config', status: 'idle', primary: 'Static' };
}

function buildServerTile(redis: RedisStatus | null, server: ServerMetrics | null): SystemTile {
    if (!redis && !server) {
        return { id: 'server', label: 'Server', status: 'down', primary: 'Offline' };
    }
    const redisDown = redis && !redis.connected;
    const status: Status = redisDown ? 'down' : 'ok';
    const primary = server ? `${server.cpuUsage.toFixed(1)}% cpu` : 'no metrics';
    const secondary = redis?.responseTime != null ? `redis ${redis.responseTime}ms` : 'redis ?';
    return { id: 'server', label: 'Server', status, primary, secondary };
}

function buildBlockchainTile(status: BlockchainStatus | null, metrics: BlockchainMetrics | null): SystemTile {
    if (!status) {
        return { id: 'blockchain', label: 'Chain', status: 'down', primary: 'Offline' };
    }
    const lag = status.lag;
    const throttle = status.liveChainThrottleBlocks;
    let tone: Status = 'ok';
    if (lag >= 100) tone = 'down';
    else if (lag >= throttle) tone = 'warn';
    if (status.netCatchUpRate !== null && status.netCatchUpRate < 0) tone = 'warn';
    if (!status.isHealthy) tone = 'down';

    const primary = `lag ${lag.toLocaleString()}`;
    const secondary = metrics ? `${metrics.successRate.toFixed(1)}% ok` : undefined;
    return { id: 'blockchain', label: 'Chain', status: tone, primary, secondary };
}

function buildWebsocketsTile(ws: AggregateWebSocketStats | null): SystemTile {
    if (!ws) {
        return { id: 'websockets', label: 'Sockets', status: 'down', primary: 'Offline' };
    }
    const tone: Status = ws.totalSubscriptionErrors > 0 ? 'warn' : 'ok';
    const primary = `${ws.totalSubscriptions.toLocaleString()} subs`;
    const secondary = ws.totalSubscriptionErrors > 0
        ? `${ws.totalSubscriptionErrors} err`
        : `${ws.totalRooms.toLocaleString()} rooms`;
    return { id: 'websockets', label: 'Sockets', status: tone, primary, secondary };
}

function buildMongoTile(mongo: DatabaseStatus | null): SystemTile {
    if (!mongo) {
        return { id: 'mongo', label: 'Mongo', status: 'down', primary: 'Offline' };
    }
    const tone: Status = mongo.connected ? 'ok' : 'down';
    const primary = mongo.responseTime != null ? `${mongo.responseTime}ms` : 'no rtt';
    const secondary = mongo.connected ? 'connected' : 'disconnected';
    return { id: 'mongo', label: 'Mongo', status: tone, primary, secondary };
}

function buildClickHouseTile(clickhouse: ClickHouseStatus | null): SystemTile {
    if (!clickhouse) {
        return { id: 'clickhouse', label: 'ClickHouse', status: 'idle', primary: 'Not configured' };
    }
    const tone: Status = clickhouse.connected ? 'ok' : 'down';
    const primary = clickhouse.connected ? 'connected' : 'disconnected';
    return { id: 'clickhouse', label: 'ClickHouse', status: tone, primary };
}
