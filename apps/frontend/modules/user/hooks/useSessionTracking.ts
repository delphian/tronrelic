/**
 * useSessionTracking Hook
 *
 * Manages user session tracking for analytics. Handles:
 * - Starting sessions on page load (captures country, device, referrer)
 * - Recording page visits during navigation
 * - Sending heartbeats to track engagement duration
 * - Ending sessions on page unload
 *
 * This hook should be used once at the app level, typically in a provider
 * that has access to the user ID.
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { startSession, recordPage, heartbeat, endSession } from '../api';

/** Heartbeat interval in milliseconds (30 seconds) */
const HEARTBEAT_INTERVAL = 30000;

interface UseSessionTrackingOptions {
    /** User UUID - tracking only runs when this is provided */
    userId: string | null;
    /** Whether tracking is enabled (defaults to true) */
    enabled?: boolean;
}

/**
 * Hook to manage session tracking for a user.
 *
 * Automatically starts a session, tracks page visits, sends periodic
 * heartbeats, and ends the session when the user leaves.
 *
 * @param options - Configuration options
 * @param options.userId - User UUID (required for tracking)
 * @param options.enabled - Whether tracking is enabled
 */
export function useSessionTracking({
    userId,
    enabled = true
}: UseSessionTrackingOptions): void {
    const pathname = usePathname();
    const sessionStartedRef = useRef(false);
    const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const lastPathRef = useRef<string | null>(null);

    /**
     * Start session and begin heartbeat interval.
     */
    const initSession = useCallback(async () => {
        if (!userId || sessionStartedRef.current) return;

        try {
            // Pass document.referrer for first-visit tracking
            const referrer = typeof document !== 'undefined' ? document.referrer : undefined;
            await startSession(userId, referrer);
            sessionStartedRef.current = true;

            // Record initial page
            if (pathname) {
                await recordPage(userId, pathname);
                lastPathRef.current = pathname;
            }

            // Start heartbeat interval
            heartbeatIntervalRef.current = setInterval(async () => {
                try {
                    await heartbeat(userId);
                } catch (error) {
                    // Non-critical - log but don't disrupt
                    console.warn('Session heartbeat failed:', error);
                }
            }, HEARTBEAT_INTERVAL);
        } catch (error) {
            // Non-critical - log but don't disrupt user experience
            console.warn('Failed to start session:', error);
        }
    }, [userId, pathname]);

    /**
     * End session and cleanup.
     */
    const cleanupSession = useCallback(() => {
        // Clear heartbeat interval
        if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = null;
        }

        // End session if one was started
        if (userId && sessionStartedRef.current) {
            // Use sendBeacon for reliability on page unload
            const apiBaseUrl = typeof window !== 'undefined'
                ? (window as { __RUNTIME_CONFIG__?: { apiBaseUrl?: string } }).__RUNTIME_CONFIG__?.apiBaseUrl || ''
                : '';

            if (navigator.sendBeacon && apiBaseUrl) {
                navigator.sendBeacon(
                    `${apiBaseUrl}/user/${userId}/session/end`,
                    JSON.stringify({})
                );
            } else {
                // Fallback to regular request (may not complete on unload)
                endSession(userId).catch(() => {
                    // Ignore errors on cleanup
                });
            }
            sessionStartedRef.current = false;
        }
    }, [userId]);

    // Initialize session on mount
    useEffect(() => {
        if (!enabled || !userId) return;

        initSession();

        // Handle page visibility changes (tab switching)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                // User switched away - send a heartbeat to capture current duration
                if (userId && sessionStartedRef.current) {
                    heartbeat(userId).catch(() => {});
                }
            }
        };

        // Handle page unload
        const handleBeforeUnload = () => {
            cleanupSession();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            cleanupSession();
        };
    }, [enabled, userId, initSession, cleanupSession]);

    // Track page changes
    useEffect(() => {
        if (!enabled || !userId || !sessionStartedRef.current) return;
        if (!pathname || pathname === lastPathRef.current) return;

        // Record new page visit
        recordPage(userId, pathname).catch((error) => {
            console.warn('Failed to record page visit:', error);
        });
        lastPathRef.current = pathname;
    }, [enabled, userId, pathname]);
}
