'use client';

import { useEffect } from 'react';
import { getSocket } from '../../lib/socketClient';
import { useToast, type ToastTone } from '../ui/ToastProvider';

/**
 * Shape of the payload carried by the global `'toast'` WebSocket event. Emitted
 * by the core `send-toast` AI tool through `WebSocketService` and broadcast to
 * every connected session. Only display fields travel — never governed data.
 */
interface ICoreToastPayload {
    tone?: ToastTone;
    title: string;
    description?: string;
    duration?: number;
}

/**
 * Surfaces site-wide toast broadcasts in every browser.
 *
 * The core `send-toast` AI tool emits a raw (non-plugin-namespaced) `'toast'`
 * event on the shared Socket.IO connection; this listener forwards it to the
 * toast provider so a single announcement reaches all sessions. It lived in the
 * trp-ai-assistant plugin until the tool moved to core — keeping the listener in
 * core makes the capability survive a provider swap. Renders no visible UI; it
 * only wires the subscription.
 *
 * @returns Always null — this is a side-effect-only component.
 */
export function CoreToastHandler(): null {
    const { push } = useToast();

    useEffect(() => {
        const socket = getSocket();

        /**
         * Forward an incoming toast broadcast to the toast provider, defaulting
         * tone and dismiss duration so a minimal payload still renders sensibly.
         *
         * @param payload - Display fields from the backend broadcast.
         */
        const handleToast = (payload: ICoreToastPayload): void => {
            if (!payload?.title) {
                return;
            }
            push({
                tone: payload.tone ?? 'info',
                title: payload.title,
                description: payload.description,
                duration: payload.duration ?? 6000
            });
        };

        socket.on('toast', handleToast);

        return () => {
            socket.off('toast', handleToast);
        };
    }, [push]);

    return null;
}
