/**
 * Tests for AccountActivityTracker: it writes `lastSeenAt` with `$max`, writes
 * at most once per account per interval, and retries after a failed write.
 * The throttle is what keeps last-seen tracking from adding a database write
 * to every signed-in request.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ISystemLogService } from '@/types';
import { AccountActivityTracker, LAST_SEEN_WRITE_INTERVAL_MS } from '../services/AccountActivityTracker.js';

/** A valid 24-character hex user id. */
const USER = 'abcabcabcabcabcabcabcabc';

/**
 * Build a logger double whose methods are spies.
 *
 * @returns A logger the tracker can call freely.
 */
function buildLogger(): ISystemLogService {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => logger } as unknown as ISystemLogService;
    return logger;
}

/**
 * Let the tracker's fire-and-forget write settle.
 *
 * @returns Resolves after pending microtasks have run.
 */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('AccountActivityTracker', () => {
    let updateOne: ReturnType<typeof vi.fn>;
    let clock: number;
    let tracker: AccountActivityTracker;

    beforeEach(() => {
        updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
        clock = Date.parse('2026-11-15T00:00:00Z');
        const database = { getCollection: () => ({ updateOne }) } as any;
        tracker = new AccountActivityTracker(database, buildLogger(), () => clock);
    });

    it('writes lastSeenAt with $max so a slower process cannot move it backwards', async () => {
        tracker.recordSeen(USER);
        await flush();

        expect(updateOne).toHaveBeenCalledTimes(1);
        expect(updateOne.mock.calls[0][1]).toEqual({ $max: { lastSeenAt: new Date(clock) } });
    });

    it('writes at most once per account per interval', async () => {
        tracker.recordSeen(USER);
        clock += LAST_SEEN_WRITE_INTERVAL_MS - 1;
        tracker.recordSeen(USER);
        await flush();
        expect(updateOne).toHaveBeenCalledTimes(1);

        clock += 1;
        tracker.recordSeen(USER);
        await flush();
        expect(updateOne).toHaveBeenCalledTimes(2);
    });

    it('retries on the next request after a failed write', async () => {
        updateOne.mockRejectedValueOnce(new Error('mongo down'));
        tracker.recordSeen(USER);
        await flush();
        tracker.recordSeen(USER);
        await flush();

        expect(updateOne).toHaveBeenCalledTimes(2);
    });

    it('ignores an id that is not a user id', async () => {
        tracker.recordSeen('not-a-user-id');
        await flush();

        expect(updateOne).not.toHaveBeenCalled();
    });
});
