/// <reference types="vitest" />

/**
 * GscArchiveBackfill unit tests.
 *
 * Covers the refusals the admin route turns into 400, 409, and 503, the split
 * into 7-day windows (each small enough that Google's daily row cap cannot
 * push it past the fetcher's pagination limit), the progress record an
 * operator resumes from after a failure, and the `interrupted` state reported
 * when a restart cut a run short.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IDatabaseService, ISystemLogService } from '@/types';

vi.mock('googleapis', () => ({ google: {} }));

import { GscArchiveBackfill, type IGscArchiveBackfillStatus } from '../services/GscArchiveBackfill.js';
import type { IGscArchive } from '../services/IGscArchive.js';
import type { IGscArchiveSource } from '../services/IGscArchiveSource.js';

/** Logger double so failure paths can run without pino. */
function createMockLogger(): ISystemLogService {
    const fns = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(() => fns)
    } as unknown as ISystemLogService;
    return fns;
}

/**
 * Build a backfill wired to doubles: a Map-backed key-value store, an archive
 * whose enabled flag is chosen per test, and a source whose `archiveWindow`
 * each test can replace.
 *
 * @param options - Whether the archive is enabled and credentials stored, plus
 *   key-value entries to seed.
 * @returns The backfill, the source's spies, and the key-value map.
 */
function setup(options: { enabled?: boolean; configured?: boolean; kv?: Record<string, unknown> } = {}): {
    backfill: GscArchiveBackfill;
    archiveWindow: ReturnType<typeof vi.fn>;
    isConfigured: ReturnType<typeof vi.fn>;
    kv: Map<string, unknown>;
} {
    const kv = new Map<string, unknown>(Object.entries(options.kv ?? {}));
    const database = {
        get: vi.fn(async (key: string) => kv.get(key) ?? null),
        set: vi.fn(async (key: string, value: unknown) => {
            kv.set(key, value);
        })
    } as unknown as IDatabaseService;
    const archive = {
        isEnabled: () => options.enabled ?? true,
        getCoverage: vi.fn(async () => ({ firstDate: null, lastDate: null, days: 0 }))
    } as unknown as IGscArchive;
    const archiveWindow = vi.fn(async () => ({ rowsFetched: 10 }));
    const isConfigured = vi.fn(async () => options.configured ?? true);
    const source: IGscArchiveSource = { archiveWindow, isConfigured };
    return { backfill: new GscArchiveBackfill(source, archive, database, createMockLogger()), archiveWindow, isConfigured, kv };
}

/**
 * Wait until the background run has stopped and return its final status.
 *
 * @param backfill - The backfill under test.
 * @returns The stored status once it is no longer `running`.
 */
async function waitForFinish(backfill: GscArchiveBackfill): Promise<IGscArchiveBackfillStatus> {
    let status: IGscArchiveBackfillStatus | undefined;
    await vi.waitFor(async () => {
        status = (await backfill.getOverview()).backfill;
        expect(status.state).not.toBe('running');
    });
    return status as IGscArchiveBackfillStatus;
}

/** Render a UTC day offset from today as YYYY-MM-DD, for the default range. */
function dayKeyFromToday(offsetDays: number, offsetMonths = 0): string {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, now.getUTCDate() + offsetDays))
        .toISOString().split('T')[0];
}

describe('GscArchiveBackfill', () => {
    it('archives 7-day windows oldest first and records completion', async () => {
        const { backfill, archiveWindow } = setup();

        const initial = await backfill.start('2026-10-01', '2026-10-16');
        const final = await waitForFinish(backfill);

        expect(initial).toMatchObject({ state: 'running', windowsTotal: 3, windowsDone: 0 });
        expect(archiveWindow.mock.calls).toEqual([
            ['2026-10-01', '2026-10-07'],
            ['2026-10-08', '2026-10-14'],
            ['2026-10-15', '2026-10-16']
        ]);
        expect(final).toMatchObject({
            state: 'completed',
            windowsDone: 3,
            completedThrough: '2026-10-16',
            rowsFetched: 30,
            error: null
        });
    });

    it('records where a failed run stopped so a new run can resume from there', async () => {
        const { backfill, archiveWindow } = setup();
        archiveWindow
            .mockResolvedValueOnce({ rowsFetched: 4 })
            .mockRejectedValueOnce(new Error('Quota exceeded'));

        await backfill.start('2026-10-01', '2026-10-21');
        const final = await waitForFinish(backfill);

        expect(final).toMatchObject({
            state: 'failed',
            windowsDone: 1,
            completedThrough: '2026-10-07',
            rowsFetched: 4,
            error: 'Quota exceeded'
        });
        // The failed run released its claim, so a resume can start.
        await expect(backfill.start('2026-10-08', '2026-10-21')).resolves.toMatchObject({ state: 'running' });
        await waitForFinish(backfill);
    });

    it('refuses a second run while one is in progress', async () => {
        const { backfill, archiveWindow } = setup();
        let release: () => void = () => undefined;
        archiveWindow.mockImplementationOnce(() => new Promise((resolve) => {
            release = () => resolve({ rowsFetched: 1 });
        }));

        await backfill.start('2026-10-01', '2026-10-03');

        await expect(backfill.start('2026-10-01', '2026-10-03')).rejects.toMatchObject({ code: 'already-running' });
        release();
        await waitForFinish(backfill);
    });

    it('refuses when the archive is disabled', async () => {
        const { backfill } = setup({ enabled: false });

        await expect(backfill.start()).rejects.toMatchObject({ code: 'archive-disabled' });
    });

    it('refuses without credentials and releases its claim', async () => {
        const { backfill, isConfigured } = setup({ configured: false });

        await expect(backfill.start('2026-10-01', '2026-10-03')).rejects.toMatchObject({ code: 'not-configured' });

        isConfigured.mockResolvedValue(true);
        await expect(backfill.start('2026-10-01', '2026-10-03')).resolves.toMatchObject({ state: 'running' });
        await waitForFinish(backfill);
    });

    it.each([
        ['a malformed day', '2026-1-01', '2026-10-03'],
        ['a day that does not exist', '2026-02-30', '2026-03-03'],
        ['a reversed range', '2026-10-05', '2026-10-01'],
        ['an end in the future', '2026-10-01', dayKeyFromToday(2)],
        ['a range wider than Google keeps', '2024-01-01', '2026-01-01']
    ])('refuses %s', async (_label, startDate, endDate) => {
        const { backfill, archiveWindow } = setup();

        await expect(backfill.start(startDate, endDate)).rejects.toMatchObject({ code: 'invalid-range' });
        expect(archiveWindow).not.toHaveBeenCalled();
    });

    it('defaults to the 16 months Google keeps, ending on the daily fetch\'s last day', async () => {
        const { backfill } = setup();

        const initial = await backfill.start();
        await waitForFinish(backfill);

        expect(initial.startDate).toBe(dayKeyFromToday(0, -16));
        expect(initial.endDate).toBe(dayKeyFromToday(-3));
    });

    it('reports a stored running state as interrupted when no run is active here', async () => {
        // A restart mid-run leaves "running" in the store with nothing behind it.
        const stored: IGscArchiveBackfillStatus = {
            state: 'running',
            startDate: '2025-07-13',
            endDate: '2026-11-10',
            startedAt: '2026-11-11T00:00:00.000Z',
            finishedAt: null,
            completedThrough: '2025-09-30',
            windowsDone: 12,
            windowsTotal: 70,
            rowsFetched: 1200,
            error: null
        };
        const { backfill } = setup({ kv: { 'gsc:archiveBackfill': stored } });

        const overview = await backfill.getOverview();

        expect(overview.backfill).toEqual({ ...stored, state: 'interrupted' });
        expect(overview.enabled).toBe(true);
    });
});
