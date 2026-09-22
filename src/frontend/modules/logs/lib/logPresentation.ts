/**
 * @fileoverview Presentation helpers shared by the log viewer's toolbar, table,
 * and entry panel.
 *
 * Keeping the level order, labels, tones, and timestamp split in one place
 * means the severity chips, the row badges, and the slide-over all describe a
 * level the same way.
 */

import type { LogLevel } from '@/types';
import type { BadgeTone } from '../../../components/ui/Badge';
import type { SystemLog } from '../types';

/** Every level, most severe first, which is the order the severity chips appear in. */
export const LOG_LEVELS_BY_SEVERITY: readonly LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

/**
 * Human label for a level, in sentence case, so the interface reads "Warning"
 * rather than the stored value "warn".
 *
 * @param level - The stored level
 * @returns The label shown on chips, badges, and the entry panel
 */
export function levelLabel(level: LogLevel): string {
    const labels: Record<LogLevel, string> = {
        fatal: 'Fatal',
        error: 'Error',
        warn: 'Warning',
        info: 'Info',
        debug: 'Debug',
        trace: 'Trace'
    };
    return labels[level] ?? level;
}

/**
 * Badge tone for a level, so severity is carried by the same colours the rest
 * of the system pages use for danger, warning, and information.
 *
 * @param level - The stored level
 * @returns The tone for the level's badge and chip
 */
export function levelTone(level: LogLevel): BadgeTone {
    let tone: BadgeTone = 'neutral';
    if (level === 'fatal' || level === 'error') {
        tone = 'danger';
    } else if (level === 'warn') {
        tone = 'warning';
    } else if (level === 'info') {
        tone = 'info';
    }
    return tone;
}

/**
 * Split an entry's timestamp into a date and a time with seconds, in the
 * browser's time zone.
 *
 * The table shows the time prominently and the date quietly beside it,
 * because an operator scanning recent entries reads the time first. Seconds
 * matter when lining entries up against each other. The viewer loads its data
 * after mount, so formatting in the browser cannot cause a hydration mismatch.
 *
 * @param timestamp - ISO 8601 timestamp from the entry
 * @returns The `MM/DD` date and the `HH:mm:ss` time
 */
export function splitLogTimestamp(timestamp: string): { date: string; time: string } {
    const value = new Date(timestamp);
    const pad = (part: number) => String(part).padStart(2, '0');
    return {
        date: `${pad(value.getMonth() + 1)}/${pad(value.getDate())}`,
        time: `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
    };
}

/**
 * Pull the error text out of an entry's context, when it carries one, so the
 * table can show why something failed without the operator opening the entry.
 *
 * Log calls pass the failure as `{ error }`, either as a string or as a
 * serialized error object with a `message`. Anything else yields nothing, and
 * the row shows only the message.
 *
 * @param log - The log entry
 * @returns The error text, or null when the context has none
 */
export function contextErrorText(log: SystemLog): string | null {
    const error: unknown = log.context?.error;
    let text: string | null = null;
    if (typeof error === 'string' && error.trim().length > 0) {
        text = error;
    } else if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
        text = (error as { message: string }).message;
    }
    return text;
}
