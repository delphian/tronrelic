'use client';

import { useEffect, useState } from 'react';

interface ClientTimeProps {
    date: Date | string | null | undefined;
    format?: 'time' | 'datetime' | 'date';
    fallback?: string;
}

/**
 * Renders a formatted time/date on the client only to avoid SSR hydration mismatches.
 *
 * During SSR, renders a placeholder to prevent timezone-related hydration errors.
 * Once mounted on the client, displays the actual formatted time in the user's timezone.
 *
 * @param date - The date to format (Date object, ISO string, null, or undefined)
 * @param format - Format type: 'time' (default), 'datetime', or 'date'
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

    // datetime
    return <span>{dateObj.toLocaleString()}</span>;
}
