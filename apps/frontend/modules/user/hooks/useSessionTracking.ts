/**
 * useSessionTracking Hook
 *
 * Manages user session tracking for analytics. Handles:
 * - Starting sessions on page load (captures country, device, referrer)
 * - Recording page visits during navigation
 * - Sending heartbeats to track engagement duration
 * - Ending sessions on page unload
 *
 * Referrer handling:
 * - First checks for preserved referrer cookie (set by middleware during redirects)
 * - Falls back to document.referrer if no cookie present
 * - Clears the cookie after reading to prevent stale attribution
 *
 * This hook should be used once at the app level, typically in a provider
 * that has access to the user ID.
 */

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { usePathname } from 'next/navigation';
import { startSession, recordPage, heartbeat, endSession } from '../api';
import { ORIGINAL_REFERRER_COOKIE } from '../../../middleware';

/** Heartbeat interval in milliseconds (30 seconds) */
const HEARTBEAT_INTERVAL = 30000;

/**
 * Get the preserved referrer from cookie and clear it.
 *
 * The middleware sets this cookie when redirecting requests that have
 * an external referrer, preserving the original traffic source.
 *
 * @returns The preserved referrer URL or undefined
 */
function getAndClearPreservedReferrer(): string | undefined {
    if (typeof document === 'undefined') {
        return undefined;
    }

    // Parse cookies (handles values containing '=' like URLs with query params)
    const cookies = document.cookie.split(';').reduce((acc, cookie) => {
        const parts = cookie.trim().split('=');
        const key = parts.shift();
        if (key) {
            acc[key] = decodeURIComponent(parts.join('='));
        }
        return acc;
    }, {} as Record<string, string>);

    const preserved = cookies[ORIGINAL_REFERRER_COOKIE];

    // Clear the cookie after reading (attributes must match original for proper deletion)
    if (preserved) {
        document.cookie = `${ORIGINAL_REFERRER_COOKIE}=; path=/; max-age=0; secure; samesite=lax`;
    }

    return preserved;
}

/**
 * Get the effective referrer for session tracking.
 *
 * Priority:
 * 1. Preserved referrer cookie (set by middleware during redirects)
 * 2. document.referrer (standard browser referrer)
 *
 * @returns The referrer URL or undefined
 */
function getEffectiveReferrer(): string | undefined {
    // Check for preserved referrer first (handles redirect case)
    const preserved = getAndClearPreservedReferrer();
    if (preserved) {
        return preserved;
    }

    // Fall back to standard document.referrer
    if (typeof document !== 'undefined' && document.referrer) {
        return document.referrer;
    }

    return undefined;
}

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
    const [sessionStarted, setSessionStarted] = useState(false);
    const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const lastPathRef = useRef<string | null>(null);

    // Track whether cleanup has been called to prevent double-cleanup
    const cleanupCalledRef = useRef(false);

    /**
     * Start session and begin heartbeat interval.
     * Does NOT record initial page - that's handled by the pathname effect.
     */
    const initSession = useCallback(async () => {
        if (!userId) return;

        try {
            // Get referrer (checks preserved cookie first, then document.referrer)
            const referrer = getEffectiveReferrer();
            // Pass viewport width for screen size tracking
            const screenWidth = typeof window !== 'undefined' ? window.innerWidth : undefined;
            await startSession(userId, referrer, screenWidth);
            setSessionStarted(true);
            cleanupCalledRef.current = false;

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
    }, [userId]);

    /**
     * End session and cleanup.
     */
    const cleanupSession = useCallback(() => {
        // Prevent double-cleanup
        if (cleanupCalledRef.current) return;
        cleanupCalledRef.current = true;

        // Clear heartbeat interval
        if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = null;
        }

        // End session if one was started
        if (userId) {
            // Use sendBeacon for reliability on page unload
            const apiBaseUrl = typeof window !== 'undefined'
                ? (window as { __RUNTIME_CONFIG__?: { apiBaseUrl?: string } }).__RUNTIME_CONFIG__?.apiBaseUrl || ''
                : '';

            if (navigator.sendBeacon && apiBaseUrl) {
                const blob = new Blob([JSON.stringify({})], { type: 'application/json' });
                navigator.sendBeacon(
                    `${apiBaseUrl}/user/${userId}/session/end`,
                    blob
                );
            } else {
                // Fallback to regular request (may not complete on unload)
                endSession(userId).catch(() => {
                    // Ignore errors on cleanup
                });
            }
            setSessionStarted(false);
        }
    }, [userId]);

    // Initialize session on mount (runs once per userId)
    useEffect(() => {
        if (!enabled || !userId || sessionStarted) return;

        initSession();
    }, [enabled, userId, sessionStarted, initSession]);

    // Setup event listeners for visibility and unload
    useEffect(() => {
        if (!enabled || !userId || !sessionStarted) return;

        // Handle page visibility changes (tab switching)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                // User switched away - send a heartbeat to capture current duration
                heartbeat(userId).catch(() => {});
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
    }, [enabled, userId, sessionStarted, cleanupSession]);

    // Track page changes (including initial page after session starts)
    useEffect(() => {
        if (!enabled || !userId || !sessionStarted) return;
        if (!pathname || pathname === lastPathRef.current) return;

        // Record page visit (works for both initial and subsequent pages)
        recordPage(userId, pathname).catch((error) => {
            console.warn('Failed to record page visit:', error);
        });
        lastPathRef.current = pathname;
    }, [enabled, userId, sessionStarted, pathname]);
}
