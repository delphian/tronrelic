'use client';

import { useEffect, useState } from 'react';

interface ClientTimeProps {
    date: Date | string;
    format?: 'time' | 'datetime' | 'date';
}

/**
 * Renders a formatted time/date on the client only to avoid SSR hydration mismatches.
 *
 * During SSR, renders a placeholder to prevent timezone-related hydration errors.
 * Once mounted on the client, displays the actual formatted time in the user's timezone.
 *
 * @param date - The date to format (Date object or ISO string)
 * @param format - Format type: 'time' (default), 'datetime', or 'date'
 */
export function ClientTime({ date, format = 'time' }: ClientTimeProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        // SSR/initial render: show placeholder to prevent hydration mismatch
        return <span suppressHydrationWarning>—</span>;
    }

    // Client-side render: show actual formatted time
    const dateObj = typeof date === 'string' ? new Date(date) : date;

    if (format === 'time') {
        return <span>{dateObj.toLocaleTimeString()}</span>;
    }

    if (format === 'date') {
        return <span>{dateObj.toLocaleDateString()}</span>;
    }

    // datetime
    return <span>{dateObj.toLocaleString()}</span>;
}
