'use client';

import { useEffect } from 'react';
import { getSocket } from '../../lib/socketClient';
import { useToast, type ToastTone } from '../ui/ToastProvider';

/**
 * Shape of the per-user `'notification'` WebSocket event. The notifications
 * module's toast channel emits it to the recipient's `user:${id}` room after the
 * dispatch pipeline has already filtered out anyone who silenced the category —
 * so receiving this event means the user should see it. Only display fields
 * travel; never governed data.
 */
interface INotificationPayload {
    id: string;
    categoryId: string;
    categoryLabel: string;
    severity: 'info' | 'success' | 'warning' | 'error';
    title: string;
    body?: string;
    createdAt: string;
}

/**
 * Map a backend severity to a toast tone. `'error'` becomes the `'danger'` tone;
 * the others map by name.
 */
const SEVERITY_TONE: Record<INotificationPayload['severity'], ToastTone> = {
    info: 'info',
    success: 'success',
    warning: 'warning',
    error: 'danger'
};

/**
 * Surfaces identity-targeted notifications as toasts.
 *
 * Complements {@link CoreToastHandler}, which broadcasts to every session. This
 * handler is per-user: the server emits only to the logged-in recipient's
 * identity room, so the toast appears for the targeted user (e.g. an admin when
 * a scheduled AI prompt runs) and no one else. Renders no visible UI.
 *
 * @returns Always null — side-effect-only component.
 */
export function NotificationHandler(): null {
    const { push } = useToast();

    useEffect(() => {
        const socket = getSocket();

        /**
         * Forward an incoming notification to the toast provider, mapping
         * severity to tone and defaulting a generous dwell time since these are
         * targeted (not broadcast) and worth reading.
         *
         * @param payload - Display fields from the backend.
         */
        const handleNotification = (payload: INotificationPayload): void => {
            if (!payload?.title) {
                return;
            }
            push({
                tone: SEVERITY_TONE[payload.severity] ?? 'info',
                title: payload.title,
                description: payload.body,
                duration: 8000
            });
        };

        socket.on('notification', handleNotification);

        return () => {
            socket.off('notification', handleNotification);
        };
    }, [push]);

    return null;
}
