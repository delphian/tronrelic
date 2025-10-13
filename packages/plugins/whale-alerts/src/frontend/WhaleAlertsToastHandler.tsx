'use client';

import { useEffect, useRef } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { useToast } from '@tronrelic/frontend/components/ui/ToastProvider';

/**
 * Props for the whale alerts toast handler component.
 *
 * The context provides access to the plugin-scoped WebSocket client with automatic
 * event prefixing, ensuring events are properly namespaced to 'whale-alerts:'.
 */
interface WhaleAlertsToastHandlerProps {
    context: IFrontendPluginContext;
}

/**
 * Display toast notifications for whale transfers.
 *
 * The handler subscribes to the plugin-namespaced 'large-transfer' event using the
 * plugin context's WebSocket client, which automatically prefixes events with the
 * plugin ID. This ensures the handler listens for 'whale-alerts:large-transfer'
 * events emitted by the backend observer.
 *
 * Event deduplication is handled via refs to prevent duplicate toasts from reconnections
 * or React Strict Mode double-mounting.
 *
 * @param context - Plugin context providing namespaced WebSocket client
 * @returns null (component only manages side effects)
 */
export function WhaleAlertsToastHandler({ context }: WhaleAlertsToastHandlerProps) {
    const { push } = useToast();
    const toastedEventKeys = useRef<Set<string>>(new Set());
    const hydratedRef = useRef(false);
    const { websocket } = context;

    useEffect(() => {
        hydratedRef.current = true;
    }, []);

    useEffect(() => {
        /**
         * Handle incoming whale transaction events and display toast notifications.
         *
         * Validates incoming payloads to ensure they contain valid transaction data,
         * prevents duplicate toasts via event key tracking with size-limited cache,
         * and displays toast notifications directly. The key-based deduplication
         * protects against React Strict Mode double-mounting and reconnection event
         * replays that could cause duplicate toasts.
         *
         * @param payload - Transaction payload from the backend observer
         */
        const handleLargeTransfer = (payload: any) => {
            if (!hydratedRef.current) {
                return;
            }

            // Enhanced validation with error logging
            if (!payload || typeof payload !== 'object') {
                console.error('WhaleAlertsToastHandler: Received malformed large-transfer event - payload is not an object', { payload });
                return;
            }

            const txId = payload?.txId;
            if (!txId || typeof txId !== 'string') {
                console.error('WhaleAlertsToastHandler: Received large-transfer event with invalid or missing txId', { payload });
                return;
            }

            const toastKey = `large-transfer:${txId}`;
            if (toastedEventKeys.current.has(toastKey)) {
                return;
            }

            toastedEventKeys.current.add(toastKey);
            if (toastedEventKeys.current.size > 500) {
                const oldest = toastedEventKeys.current.values().next().value;
                if (oldest) {
                    toastedEventKeys.current.delete(oldest);
                }
            }

            // Display toast notification for whale transfer
            const amount = Number(payload.amountTRX ?? 0);
            const formattedAmount = Number.isFinite(amount) ? amount.toLocaleString() : 'Unknown';
            const fromAddress = payload.from?.address ?? 'Unknown';
            const toAddress = payload.to?.address ?? 'Unknown';

            push({
                tone: 'warning',
                title: 'Whale transfer detected',
                description: `${formattedAmount} TRX • ${fromAddress} → ${toAddress}`,
                duration: 7000
            });
        };

        // Subscribe to whale transfer events using plugin-namespaced WebSocket client
        // This automatically listens for 'whale-alerts:large-transfer' events
        websocket.on('large-transfer', handleLargeTransfer);

        return () => {
            websocket.off('large-transfer', handleLargeTransfer);
        };
    }, [push, websocket]);

    return null;
}
