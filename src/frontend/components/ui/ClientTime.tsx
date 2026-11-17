'use client';

import { useEffect, useState } from 'react';

interface ClientTimeProps {
    date: Date | string | null | undefined;
    format?: 'time' | 'datetime' | 'date' | 'relative' | 'short';
    fallback?: string;
}

/**
 * Forces 24-hour time in every format that shows a clock time.
 *
 * TronRelic shows times in 24-hour form everywhere, because operators compare
 * them against cron schedules and log entries that use it. The browser's
 * locale would otherwise pick AM/PM for US visitors. `hourCycle: 'h23'` is used
 * rather than `hour12: false`, because with `hour12: false` some locales show
 * midnight as 24:00.
 */
const HOUR_CYCLE_24: Intl.DateTimeFormatOptions = { hourCycle: 'h23' };

/**
 * The one way a calendar date is written: a short month name, the day, and
 * the year, as in "Nov 15, 2026".
 *
 * Shared by the `date` and `short` formats and by `relative` once an event is
 * more than a week old, so those three write a date the same way. `date` used
 * the browser's numeric locale form ("11/15/2026"), which sat beside the
 * other two on the same page and reads differently in the US and Europe.
 * `datetime` still uses the locale form.
 */
const CALENDAR_DATE: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
};

/**
 * Write a calendar date as one unbreakable unit.
 *
 * "Nov 15, 2026" contains spaces, so a narrow table column would break it
 * across two lines ("Nov 15," over "2026") where the numeric form it replaced
 * never broke. Joining the parts with non-breaking spaces keeps a date on one
 * line wherever it is printed, and the column sizes itself to the whole date.
 *
 * @param date - The already-validated date to write.
 * @returns The date as "Nov 15, 2026", with non-breaking spaces.
 */
function formatCalendarDate(date: Date): string {
    return date.toLocaleDateString('en-US', CALENDAR_DATE).replace(/ /g, ' ');
}

/**
 * Renders a formatted time/date on the client only to avoid SSR hydration mismatches.
 *
 * During SSR, renders a placeholder to prevent timezone-related hydration errors.
 * Once mounted on the client, displays the actual formatted time in the user's
 * timezone, always in 24-hour form.
 *
 * @param date - The date to format (Date object, ISO string, null, or undefined)
 * @param format - Format type: 'time' (default), 'datetime', 'date' ("Nov 15, 2026"), 'relative', or 'short'
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
        return <span>{dateObj.toLocaleTimeString(undefined, HOUR_CYCLE_24)}</span>;
    }

    if (format === 'date') {
        return <span>{formatCalendarDate(dateObj)}</span>;
    }

    if (format === 'relative') {
        return <span>{formatRelative(dateObj)}</span>;
    }

    if (format === 'short') {
        return <span>{formatShort(dateObj)}</span>;
    }

    // datetime
    return <span>{dateObj.toLocaleString(undefined, HOUR_CYCLE_24)}</span>;
}

/**
 * How far ahead of the browser's clock a time can be and still read as "just
 * now". A server stamps past events with its own clock, which can run a few
 * seconds ahead of the visitor's, and such an event must not read as upcoming.
 */
const CLOCK_SKEW_TOLERANCE_MS = 5_000;

/**
 * Formats a date as relative time, past ("5m ago", "2h ago", "3d ago") or
 * future ("in 5m", "in 2h", "in 3d").
 *
 * Suits a column of closely spaced events, where the distance matters more
 * than the clock time, such as when a job last ran or runs next. Anything more
 * than a week away in either direction falls back to a plain date.
 *
 * @param date - The already-validated date to describe.
 * @returns The relative distance, or a date for anything over a week away.
 */
function formatRelative(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const isFuture = diffMs < -CLOCK_SKEW_TOLERANCE_MS;
    const distanceMs = Math.abs(diffMs);
    const mins = Math.floor(distanceMs / (1000 * 60));
    const hours = Math.floor(distanceMs / (1000 * 60 * 60));
    const days = Math.floor(distanceMs / (1000 * 60 * 60 * 24));

    let amount: string | null = null;
    if (mins < 60) {
        amount = `${mins}m`;
    } else if (hours < 24) {
        amount = `${hours}h`;
    } else if (days < 7) {
        amount = `${days}d`;
    }

    let label: string;
    if (amount === null) {
        label = formatCalendarDate(date);
    } else if (mins < 1) {
        label = isFuture ? 'in <1m' : 'just now';
    } else {
        label = isFuture ? `in ${amount}` : `${amount} ago`;
    }
    return label;
}

/**
 * Formats a date in short format (e.g., "Jan 15, 2024, 14:30").
 *
 * Gives a compact absolute time for places where the full `datetime` form is
 * too wide, such as a table column.
 *
 * @param date - The already-validated date to format.
 * @returns The short date and 24-hour time.
 */
function formatShort(date: Date): string {
    return date.toLocaleDateString('en-US', {
        ...CALENDAR_DATE,
        hour: '2-digit',
        minute: '2-digit',
        ...HOUR_CYCLE_24
    });
}
