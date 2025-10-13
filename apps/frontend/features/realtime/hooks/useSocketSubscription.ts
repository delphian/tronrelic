'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { SocketSubscriptions } from '@tronrelic/shared';
import { useAppDispatch } from '../../../store/hooks';
import { registerSubscription, unregisterSubscription } from '../slice';
import { getSocket } from '../../../lib/socketClient';

interface UseSocketSubscriptionOptions {
  enabled?: boolean;
  immediate?: boolean;
}

function createSubscriptionId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useSocketSubscription(
  subscription: SocketSubscriptions | null | false,
  options: UseSocketSubscriptionOptions = {}
) {
  const { enabled = true, immediate = true } = options;
  const dispatch = useAppDispatch();
  const idRef = useRef<string | null>(null);
  const payloadRef = useRef<SocketSubscriptions | null>(null);

  if (!idRef.current) {
    idRef.current = createSubscriptionId('sub');
  }

  const isActive = Boolean(enabled && subscription);
  const memoizedPayload = useMemo(() => (subscription && enabled ? subscription : null), [enabled, subscription]);

  useEffect(() => {
    payloadRef.current = memoizedPayload;
  }, [memoizedPayload]);

  useEffect(() => {
    const id = idRef.current as string;

    if (!isActive || !memoizedPayload) {
      dispatch(unregisterSubscription({ id }));
      return;
    }

    dispatch(registerSubscription({ id, payload: memoizedPayload }));

    if (immediate) {
      const socket = getSocket();
      if (socket.connected) {
        socket.emit('subscribe', memoizedPayload);
      }
    }

    return () => {
      dispatch(unregisterSubscription({ id }));
    };
  }, [dispatch, immediate, isActive, memoizedPayload]);
}
