/**
 * @file savedPromptCron.ts
 *
 * Cron + relative-time utilities for the Query tab's saved-prompts surface
 * (SavedPromptsPanel, PromptEditModal). All cron evaluation is pinned to UTC
 * end-to-end so it matches the backend `scheduled-prompts-runner`, which passes
 * `{ tz: 'UTC' }` to the same cron-parser. Mixing local time anywhere here would
 * let the countdown lie to a non-UTC viewer.
 */

import cronstrue from 'cronstrue';
// Default-import + destructure: cron-parser's ESM default export carries the
// named functions, so a bare named import breaks under Next.js bundling.
import cronParser from 'cron-parser';

const { parseExpression: parseCronExpression } = cronParser;

/** Preset cron values offered as one-click fills for non-expert admins. */
export const CRON_PRESETS: Array<{ label: string; cron: string }> = [
    { label: 'Every hour', cron: '0 * * * *' },
    { label: 'Every 6 hours', cron: '0 */6 * * *' },
    { label: 'Daily 09:00 UTC', cron: '0 9 * * *' },
    { label: 'Weekly Mon 09:00 UTC', cron: '0 9 * * 1' }
];

/**
 * Master scheduler tick in ms. Mirrors the backend `SCHEDULED_PROMPTS_SCHEDULE`
 * (every two minutes at :00s) — the runner only evaluates cron expressions at
 * even-minute boundaries, so the UI must not promise a "next run" finer than
 * this cadence.
 */
export const SCHEDULER_TICK_MS = 120_000;

/**
 * Convert a cron expression to a human-readable sentence, or null for invalid
 * input so the UI can render a distinct error state rather than a misleading
 * description.
 *
 * @param expression - The cron expression.
 * @returns A human sentence with a "(UTC)" suffix, or null when unparseable.
 */
export function describeCron(expression: string): string | null {
    if (!expression.trim()) {
        return null;
    }
    try {
        // Cron is pinned to UTC; the description must advertise that — otherwise
        // "At 01:00" reads as local time to a non-UTC viewer and the countdown
        // appears to lie.
        return `${cronstrue.toString(expression, { throwExceptionOnParseError: true })} (UTC)`;
    } catch {
        return null;
    }
}

/**
 * Resolve the next cron firing to a millisecond delta from `now`, clamped up to
 * the next master-tick boundary so the countdown reflects when the backend will
 * actually evaluate the cron rather than when the cron alone would next fire.
 *
 * @param expression - The cron expression.
 * @param now - Current epoch ms.
 * @returns Milliseconds until the next tick-aligned firing, or null when invalid.
 */
export function getMsUntilNextCron(expression: string, now: number): number | null {
    if (!expression.trim()) {
        return null;
    }
    try {
        const cronNextMs = parseCronExpression(expression, { currentDate: now, tz: 'UTC' })
            .next()
            .toDate()
            .getTime();
        const tickAlignedMs = Math.ceil(cronNextMs / SCHEDULER_TICK_MS) * SCHEDULER_TICK_MS;
        return tickAlignedMs - now;
    } catch {
        return null;
    }
}

/**
 * Resolve the next cron firing to an absolute Date in UTC, unaligned to the
 * master-tick grid so the wall-clock display reflects the authored expression
 * rather than the backend's <=2-minute evaluation jitter.
 *
 * @param expression - The cron expression.
 * @param now - Current epoch ms.
 * @returns The next firing Date, or null when invalid.
 */
export function getNextCronDate(expression: string, now: number): Date | null {
    if (!expression.trim()) {
        return null;
    }
    try {
        return parseCronExpression(expression, { currentDate: now, tz: 'UTC' }).next().toDate();
    } catch {
        return null;
    }
}

/**
 * Format a Date using the viewer's locale and timezone with a short zone label,
 * so the admin never has to mentally convert UTC to their own clock.
 *
 * @param date - The date to format.
 * @returns A short localized wall-clock string with a zone label.
 */
export function formatLocalWallClock(date: Date): string {
    return date.toLocaleString(undefined, {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
    });
}

/**
 * Humanize a millisecond delta into "in Xh Ym" / "in Ym" / "in Xs" form,
 * flooring to whole units so a per-30s re-render produces no visible jitter.
 *
 * @param ms - Milliseconds until the event.
 * @returns A human "in ..." string.
 */
export function formatTimeUntil(ms: number): string {
    if (ms <= 0) {
        return 'any moment';
    }
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) return `in ${totalSeconds}s`;
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) return `in ${totalMinutes}m`;
    const totalHours = Math.floor(totalMinutes / 60);
    const remainderMinutes = totalMinutes % 60;
    if (totalHours < 24) {
        return remainderMinutes === 0
            ? `in ${totalHours}h`
            : `in ${totalHours}h ${remainderMinutes}m`;
    }
    const totalDays = Math.floor(totalHours / 24);
    const remainderHours = totalHours % 24;
    return remainderHours === 0
        ? `in ${totalDays}d`
        : `in ${totalDays}d ${remainderHours}h`;
}

/**
 * Relative-time formatter, chosen over absolute timestamps so rendering never
 * depends on the viewer's timezone (and so never causes a hydration mismatch).
 *
 * @param iso - An ISO timestamp.
 * @returns A "just now" / "Xm ago" / "Xh ago" / "Xd ago" string.
 */
export function formatRelativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
