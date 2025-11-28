'use client';

import { useEffect, useState } from 'react';

interface ClientTimeProps {
    date: Date | string | null | undefined;
    format?: 'time' | 'datetime' | 'date' | 'relative' | 'short';
    fallback?: string;
}

/**
 * Renders a formatted time/date on the client only to avoid SSR hydration mismatches.
 *
 * During SSR, renders a placeholder to prevent timezone-related hydration errors.
 * Once mounted on the client, displays the actual formatted time in the user's timezone.
 *
 * @param date - The date to format (Date object, ISO string, null, or undefined)
 * @param format - Format type: 'time' (default), 'datetime', 'date', 'relative', or 'short'
 * @param fallback - Text to display when date is null/undefined/invalid (defaults to '—')
 * @returns Formatted date component or fallback text
 */
export function ClientTime({ date, format = 'time', fallback = '—' }: ClientTimeProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        // SSR/initial render: show placeholder to prevent hydration mismatch
        return <span suppressHydrationWarning aria-label="Loading time">{fallback}</span>;
    }

    // Handle null or undefined dates
    if (date == null) {
        return <span aria-label="Time unavailable">{fallback}</span>;
    }

    // Client-side render: parse and validate the date
    const dateObj = typeof date === 'string' ? new Date(date) : date;

    // Check if the date is invalid (Invalid Date or malformed string)
    if (!dateObj || isNaN(dateObj.getTime())) {
        return <span aria-label="Invalid time">{fallback}</span>;
    }

    if (format === 'time') {
        return <span>{dateObj.toLocaleTimeString()}</span>;
    }

    if (format === 'date') {
        return <span>{dateObj.toLocaleDateString()}</span>;
    }

    if (format === 'relative') {
        return <span>{formatRelative(dateObj)}</span>;
    }

    if (format === 'short') {
        return <span>{formatShort(dateObj)}</span>;
    }

    // datetime
    return <span>{dateObj.toLocaleString()}</span>;
}

/**
 * Formats a date as relative time (e.g., "5m ago", "2h ago", "3d ago").
 */
function formatRelative(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

/**
 * Formats a date in short format (e.g., "Jan 15, 2024, 2:30 PM").
 */
function formatShort(date: Date): string {
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}
