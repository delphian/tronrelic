/**
 * @fileoverview One-off backfill of the permanent Search Console archive.
 *
 * The daily `gsc:fetch` job archives only the last 30 days it refetches.
 * Everything older that Google still holds has to be pulled once, by hand,
 * or it is lost when it passes Google's 16-month limit. This class runs that
 * pull in the background, one 7-day window at a time, and records progress
 * under the `gsc:archiveBackfill` key-value entry so an operator can watch it
 * and resume after a failure.
 *
 * - Google keeps 16 months of Search Console data, so that is the default reach.
 * - Google returns at most 50,000 rows per day per search type. A 7-day window
 *   is at most 350,000 rows, under the fetcher's 500,000-row pagination limit,
 *   so no backfill window is cut short.
 * - Progress lives in this process. A restart mid-run leaves the stored state
 *   `running`, which is reported as `interrupted`.
 */

import type { IDatabaseService, ISystemLogService } from '@/types';
import { GSC_DATA_DELAY_DAYS } from './gsc.service.js';
import { GscArchiveBackfillError } from './GscArchiveBackfillError.js';
import type { IGscArchive, IGscArchiveCoverage } from './IGscArchive.js';
import type { IGscArchiveSource } from './IGscArchiveSource.js';
import { parseGscDay, toGscDayKey } from './parseGscDay.js';

/** Where a backfill run stands. `interrupted` is derived at read time, never stored. */
export type GscArchiveBackfillState = 'idle' | 'running' | 'completed' | 'failed' | 'interrupted';

/**
 * Progress of the latest backfill run, as stored and as reported to the admin.
 */
export interface IGscArchiveBackfillStatus {
    /** Where the run stands. */
    state: GscArchiveBackfillState;
    /** First day requested (YYYY-MM-DD), or null before any run. */
    startDate: string | null;
    /** Last day requested (YYYY-MM-DD), or null before any run. */
    endDate: string | null;
    /** When the run began (ISO-8601). */
    startedAt: string | null;
    /** When the run completed or failed (ISO-8601). */
    finishedAt: string | null;
    /**
     * Last day of the newest window fully archived. After a failure, a new run
     * starting the day after this resumes where the failed one stopped.
     */
    completedThrough: string | null;
    /** Windows archived so far. */
    windowsDone: number;
    /** Windows the run was split into. */
    windowsTotal: number;
    /** Rows Google returned so far, across the keyword, daily, and page requests. */
    rowsFetched: number;
    /** Why the run failed, or null. */
    error: string | null;
}

/**
 * Everything the admin status endpoint reports about the archive.
 */
export interface IGscArchiveOverview {
    /** False when the deployment has no ClickHouse. */
    enabled: boolean;
    /** The latest backfill run. */
    backfill: IGscArchiveBackfillStatus;
    /** Which days the archive holds, or null when the archive is disabled. */
    coverage: IGscArchiveCoverage | null;
}

/** Key-value entry holding the latest run's progress. */
const KV_BACKFILL_STATUS = 'gsc:archiveBackfill';

/** Days per backfill window; see the file header for why seven. */
const BACKFILL_WINDOW_DAYS = 7;

/** How far back the default range reaches, matching what Google keeps. */
const DEFAULT_BACKFILL_MONTHS = 16;

/**
 * Widest range accepted. A little over Google's 16 months, so a typo such as
 * a wrong year is refused instead of queuing hundreds of empty windows.
 */
const MAX_BACKFILL_DAYS = 550;

/** Milliseconds in one day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Status reported before any backfill has run. */
const IDLE_STATUS: IGscArchiveBackfillStatus = {
    state: 'idle',
    startDate: null,
    endDate: null,
    startedAt: null,
    finishedAt: null,
    completedThrough: null,
    windowsDone: 0,
    windowsTotal: 0,
    rowsFetched: 0,
    error: null
};

/**
 * Split an inclusive day range into consecutive windows of at most
 * `BACKFILL_WINDOW_DAYS`, oldest first, so progress advances through time
 * and `completedThrough` always marks a contiguous archived span.
 *
 * @param start - First day, UTC midnight.
 * @param end - Last day, UTC midnight, not before `start`.
 * @returns Inclusive `YYYY-MM-DD` windows covering the range exactly.
 */
function splitIntoWindows(start: Date, end: Date): Array<{ start: string; end: string }> {
    const windows: Array<{ start: string; end: string }> = [];
    for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += BACKFILL_WINDOW_DAYS * DAY_MS) {
        const windowEnd = Math.min(cursor + (BACKFILL_WINDOW_DAYS - 1) * DAY_MS, end.getTime());
        windows.push({ start: toGscDayKey(new Date(cursor)), end: toGscDayKey(new Date(windowEnd)) });
    }
    return windows;
}

/**
 * Runs and reports the one-off archive backfill.
 */
export class GscArchiveBackfill {
    /** True while a run is in progress in this process. */
    private running = false;

    /**
     * @param source - Fetches one window into the archive without touching the saved fetch markers.
     * @param archive - Reports whether ClickHouse is available and what it holds.
     * @param database - Key-value store for the run's progress.
     * @param logger - Module logger, so progress and failures reach the traffic log stream.
     */
    constructor(
        private readonly source: IGscArchiveSource,
        private readonly archive: IGscArchive,
        private readonly database: IDatabaseService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Report the archive's state: whether it is enabled, the latest run, and
     * the days it holds.
     *
     * @returns The overview the admin status endpoint returns.
     */
    async getOverview(): Promise<IGscArchiveOverview> {
        const enabled = this.archive.isEnabled();
        const stored = await this.database.get<IGscArchiveBackfillStatus>(KV_BACKFILL_STATUS);
        let backfill = stored ?? IDLE_STATUS;
        if (backfill.state === 'running' && !this.running) {
            backfill = { ...backfill, state: 'interrupted' };
        }
        const coverage = enabled ? await this.archive.getCoverage() : null;
        return { enabled, backfill, coverage };
    }

    /**
     * Validate a request and start the backfill in the background.
     *
     * Returns as soon as the run is recorded, because a 16-month backfill
     * takes far longer than an HTTP request may stay open. Progress is read
     * back through `getOverview`.
     *
     * @param startDate - First day (YYYY-MM-DD); defaults to 16 months ago.
     * @param endDate - Last day (YYYY-MM-DD); defaults to the daily fetch's
     *   last day, three days ago.
     * @returns The run's initial status.
     * @throws GscArchiveBackfillError when the archive is disabled, credentials
     *   are missing, a run is already in progress, or the range is invalid.
     */
    async start(startDate?: string, endDate?: string): Promise<IGscArchiveBackfillStatus> {
        if (!this.archive.isEnabled()) {
            throw new GscArchiveBackfillError('archive-disabled', 'The GSC archive needs ClickHouse, which is not configured');
        }
        if (this.running) {
            throw new GscArchiveBackfillError('already-running', 'A GSC archive backfill is already running');
        }

        // Claimed before the first await, so two requests arriving together
        // cannot both pass the check above.
        this.running = true;
        let status: IGscArchiveBackfillStatus;
        let windows: Array<{ start: string; end: string }>;
        try {
            const range = this.resolveRange(startDate, endDate, new Date());
            if (!(await this.source.isConfigured())) {
                throw new GscArchiveBackfillError('not-configured', 'Search Console credentials are not configured');
            }
            windows = splitIntoWindows(range.start, range.end);
            status = {
                ...IDLE_STATUS,
                state: 'running',
                startDate: toGscDayKey(range.start),
                endDate: toGscDayKey(range.end),
                startedAt: new Date().toISOString(),
                windowsTotal: windows.length
            };
            await this.saveStatus(status);
        } catch (error) {
            this.running = false;
            throw error;
        }

        this.logger.info({ startDate: status.startDate, endDate: status.endDate, windows: windows.length }, 'GSC archive backfill started');
        void this.run(windows, status);
        return status;
    }

    /**
     * Archive each window in order, saving progress after every one.
     *
     * Never rejects: a failure is recorded in the stored status, with
     * `completedThrough` naming where a new run should resume, because the
     * caller started this without awaiting it.
     *
     * @param windows - The windows to archive, oldest first.
     * @param initial - The status recorded when the run started.
     */
    private async run(windows: Array<{ start: string; end: string }>, initial: IGscArchiveBackfillStatus): Promise<void> {
        let status = initial;
        try {
            for (const window of windows) {
                const { rowsFetched } = await this.source.archiveWindow(window.start, window.end);
                status = {
                    ...status,
                    windowsDone: status.windowsDone + 1,
                    completedThrough: window.end,
                    rowsFetched: status.rowsFetched + rowsFetched
                };
                await this.saveStatus(status);
            }
            status = { ...status, state: 'completed', finishedAt: new Date().toISOString() };
            this.logger.info({ rowsFetched: status.rowsFetched, windows: status.windowsDone }, 'GSC archive backfill completed');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            status = { ...status, state: 'failed', finishedAt: new Date().toISOString(), error: message };
            this.logger.error({ err: error, completedThrough: status.completedThrough }, 'GSC archive backfill failed');
        }

        // Saved before the run is released, so a new run cannot record its
        // start and then have this run's final status overwrite it.
        try {
            await this.saveStatus(status);
        } catch (error) {
            this.logger.error({ err: error, state: status.state }, 'Failed to save the final GSC archive backfill status');
        }
        this.running = false;
    }

    /**
     * Turn the requested dates into a validated inclusive range, applying the
     * defaults for any date left out.
     *
     * @param startDate - Requested first day, or undefined for 16 months ago.
     * @param endDate - Requested last day, or undefined for three days ago.
     * @param now - The current instant, passed in so the defaults are testable.
     * @returns The first and last day, at UTC midnight.
     * @throws GscArchiveBackfillError with `invalid-range` when a date is
     *   malformed, the range is reversed, ends after today, or is too wide.
     */
    private resolveRange(startDate: string | undefined, endDate: string | undefined, now: Date): { start: Date; end: Date } {
        const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        const start = startDate === undefined
            ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - DEFAULT_BACKFILL_MONTHS, now.getUTCDate()))
            : parseGscDay(startDate);
        const end = endDate === undefined
            ? new Date(today - GSC_DATA_DELAY_DAYS * DAY_MS)
            : parseGscDay(endDate);

        if (!start || !end) {
            throw new GscArchiveBackfillError('invalid-range', 'startDate and endDate must be real days in YYYY-MM-DD form');
        }
        if (start.getTime() > end.getTime()) {
            throw new GscArchiveBackfillError('invalid-range', `startDate ${toGscDayKey(start)} is after endDate ${toGscDayKey(end)}`);
        }
        if (end.getTime() > today) {
            throw new GscArchiveBackfillError('invalid-range', `endDate ${toGscDayKey(end)} is in the future`);
        }
        const spanDays = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
        if (spanDays > MAX_BACKFILL_DAYS) {
            throw new GscArchiveBackfillError(
                'invalid-range',
                `The range covers ${spanDays} days; at most ${MAX_BACKFILL_DAYS} are accepted, since Google keeps about 16 months`
            );
        }
        return { start, end };
    }

    /** Persist the run's progress so the status endpoint and a later process can read it. */
    private async saveStatus(status: IGscArchiveBackfillStatus): Promise<void> {
        await this.database.set(KV_BACKFILL_STATUS, status);
    }
}
