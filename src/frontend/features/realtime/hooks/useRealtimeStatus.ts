'use client';

import { useMemo } from 'react';
import { useAppSelector } from '../../../store/hooks';

export type RealtimeTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface RealtimeStatusSummary {
  status: 'idle' | 'deferred' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  label: string;
  tone: RealtimeTone;
  reconnectAttempts: number;
  latencyMs: number | null;
  error: string | null;
  isConnected: boolean;
  isReconnecting: boolean;
  isOffline: boolean;
  isDeferred: boolean;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
}

export function useRealtimeStatus(): RealtimeStatusSummary {
  const connection = useAppSelector(state => state.realtime.connection);

  return useMemo(() => {
    let tone: RealtimeTone = 'neutral';
    let label = 'Idle';

    switch (connection.status) {
      case 'deferred': {
        tone = 'warning';
        const seconds = connection.deferredSecondsRemaining ?? 0;
        label = `Live updates in ${seconds}s…`;
        break;
      }
      case 'connected':
        tone = 'success';
        label = 'Live';
        break;
      case 'connecting':
        tone = 'warning';
        label = 'Connecting…';
        break;
      case 'reconnecting':
        tone = 'warning';
        label = connection.reconnectAttempts > 0
          ? `Reconnecting (${connection.reconnectAttempts})`
          : 'Reconnecting…';
        break;
      case 'disconnected':
        tone = connection.error ? 'danger' : 'warning';
        label = connection.error ? 'Connection lost' : 'Offline';
        break;
      default:
        tone = 'neutral';
        label = 'Idle';
        break;
    }

    const latencyCandidate = [connection.lastLatencyMs, connection.averageLatencyMs]
      .find(value => typeof value === 'number' && Number.isFinite(value)) as number | undefined;

    return {
      status: connection.status,
      label,
      tone,
      reconnectAttempts: connection.reconnectAttempts,
      latencyMs: latencyCandidate ?? null,
      error: connection.error ?? null,
      isConnected: connection.status === 'connected',
      isReconnecting: connection.status === 'reconnecting' || connection.status === 'connecting',
      isOffline: connection.status === 'disconnected',
      isDeferred: connection.status === 'deferred',
      lastConnectedAt: connection.lastConnectedAt ?? null,
      lastDisconnectedAt: connection.lastDisconnectedAt ?? null
    };
  }, [connection]);
}
