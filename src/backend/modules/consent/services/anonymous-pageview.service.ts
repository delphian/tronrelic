/**
 * @fileoverview Counts page views from visitors who have not allowed analytics.
 *
 * A visitor in a consent region who declines analytics, or has not answered
 * the banner yet, gets no `tronrelic_tid` cookie, and neither does a visitor
 * elsewhere who opted out from "Privacy choices". Their page views cannot
 * enter the traffic module's `traffic_events` table: every visitor, session,
 * and source figure there is built from that identifier. Without this counter
 * those page views would vanish entirely. Instead each one adds one to a
 * counter for the current UTC day, with no identifier, address, or path, so
 * the operator still sees how much traffic the dashboard is missing.
 *
 * Page views arrive on a public endpoint, so the body is treated as untrusted
 * and the route is rate-limited per address.
 */

import type { IConsentDailyCount, IConsentPageviewStats, IDatabaseService } from '@/types';
import type { IConsentPageviewDailyDocument } from '../database/index.js';
import { PAGEVIEW_DAILY_COLLECTION } from '../database/index.js';

/** Window the stats read uses when the caller does not name one. */
export const DEFAULT_PAGEVIEW_STATS_DAYS = 30;

/** Longest window the stats read accepts. */
export const MAX_PAGEVIEW_STATS_DAYS = 365;

/** Milliseconds in one day, for stepping back through the window. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Format a moment as the UTC day the counters are keyed by.
 *
 * @param date - Any moment.
 * @returns The UTC day as `YYYY-MM-DD`.
 */
function toDayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/**
 * Stores anonymous page views as daily counters and summarises them for the
 * admin page.
 */
export class AnonymousPageviewService {
    /**
     * @param database - Core database service holding the daily counters.
     */
    constructor(private readonly database: IDatabaseService) {}

    /**
     * Count one page view, unless the browser reports that it is automated.
     *
     * The beacon sets `automated` from `navigator.webdriver`, the same signal
     * the traffic module uses to label a row as a bot. Counting those would
     * inflate the figure with test runners and headless crawlers.
     *
     * @param raw - The untrusted request body.
     * @param now - When the page view arrived, injectable so tests can pin the day.
     * @returns True when the page view was counted.
     */
    async record(raw: unknown, now: Date = new Date()): Promise<boolean> {
        const automated = typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).automated === true;
        if (!automated) {
            await this.increment(toDayKey(now));
        }
        return !automated;
    }

    /**
     * Summarise the page views recorded in a trailing window of whole UTC days.
     *
     * @param days - Window length in days, today included. Clamped to
     *   1–`MAX_PAGEVIEW_STATS_DAYS`; anything that is not a number uses the default.
     * @param now - The moment the window ends at, injectable for tests.
     * @returns The total and one count per day, with zero for a day with none.
     */
    async getStats(days: number, now: Date = new Date()): Promise<IConsentPageviewStats> {
        const windowDays = Number.isFinite(days)
            ? Math.min(MAX_PAGEVIEW_STATS_DAYS, Math.max(1, Math.floor(days)))
            : DEFAULT_PAGEVIEW_STATS_DAYS;
        const dayKeys: string[] = [];
        for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
            dayKeys.push(toDayKey(new Date(now.getTime() - offset * DAY_MS)));
        }
        const windowStart = dayKeys[0];
        const windowEnd = dayKeys[dayKeys.length - 1];

        const documents = await this.counters()
            .find({ day: { $gte: windowStart, $lte: windowEnd } })
            .toArray();
        const perDay = new Map<string, number>(documents.map(document => [document.day, document.count]));
        const byDay: IConsentDailyCount[] = dayKeys.map(day => ({ day, count: perDay.get(day) ?? 0 }));
        const total = byDay.reduce((sum, entry) => sum + entry.count, 0);

        return { days: windowDays, windowStart, windowEnd, total, byDay };
    }

    /**
     * Add one to a day's counter, creating it on the first page view.
     *
     * Two page views arriving together on a new day can both try to create
     * the counter. The unique index rejects the second with a duplicate-key
     * error, which means the counter now exists, so the increment is repeated
     * without the upsert.
     *
     * @param day - The UTC day, as `YYYY-MM-DD`.
     * @returns Resolves once the increment is stored.
     */
    private async increment(day: string): Promise<void> {
        try {
            await this.counters().updateOne({ day }, { $inc: { count: 1 } }, { upsert: true });
        } catch (error) {
            if ((error as { code?: number }).code !== 11000) {
                throw error;
            }
            await this.counters().updateOne({ day }, { $inc: { count: 1 } });
        }
    }

    /**
     * The daily counter collection, typed.
     *
     * @returns The raw collection handle.
     */
    private counters() {
        return this.database.getCollection<IConsentPageviewDailyDocument>(PAGEVIEW_DAILY_COLLECTION);
    }
}
