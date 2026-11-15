/**
 * @fileoverview Keeps `lastSeenAt` on each Better Auth user record current, so
 * the `/system/users` table can show and sort by when an account was last used.
 *
 * Every signed-in request resolves its session through the auth facade, and
 * every MCP call records its use through the connected-apps service; both
 * report here. Writing on every request would add a database write to each
 * one, so writes are throttled per account.
 *
 * - At most one write per account every five minutes per backend process, so
 *   `lastSeenAt` can trail the real last request by that much.
 * - `$max` keeps the newest time when two processes write close together.
 * - The field is written straight onto the user record, like `deletedAt`. It
 *   is not a Better Auth additional field, so it never rides on a session.
 */

import type { Collection, ObjectId } from 'mongodb';
import type { IDatabaseService, ISystemLogService } from '@/types';
import { AUTH_USERS_COLLECTION } from './auth-constants.js';
import type { IAccountActivityRecorder } from './IAccountActivityRecorder.js';
import { toUserKey } from './user-id.js';

/** Shortest gap between two `lastSeenAt` writes for one account. */
export const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

/** Upper bound on remembered write times, so many distinct accounts cannot grow memory without limit. */
const THROTTLE_MAX = 10_000;

/** The one field this tracker writes on the Better Auth user record. */
interface IUserActivityFields {
    _id: ObjectId;
    lastSeenAt?: Date;
}

/**
 * Throttled writer of `lastSeenAt`. One instance is built by the identity
 * module and handed to the auth facade and the connected-apps service.
 */
export class AccountActivityTracker implements IAccountActivityRecorder {
    /** When this process last wrote each account's `lastSeenAt`. */
    private readonly writtenAt = new Map<string, number>();

    /** `module_user_auth_users` collection handle. */
    private readonly users: Collection<IUserActivityFields>;

    /** Logger scoped to this tracker. */
    private readonly logger: ISystemLogService;

    /**
     * @param database - Database service the user collection is reached through.
     * @param logger - The identity module's logger.
     * @param now - Clock, injected so tests can move time.
     */
    constructor(database: IDatabaseService, logger: ISystemLogService, private readonly now: () => number = Date.now) {
        this.users = database.getCollection<IUserActivityFields>(AUTH_USERS_COLLECTION);
        this.logger = logger.child({ component: 'account-activity-tracker' });
    }

    /** @inheritdoc */
    recordSeen(userId: string): void {
        const key = toUserKey(userId);
        const time = this.now();
        const lastWrite = this.writtenAt.get(userId);
        if (key && (lastWrite === undefined || time - lastWrite >= LAST_SEEN_WRITE_INTERVAL_MS)) {
            // Claim the slot before writing, so concurrent requests from the
            // same account do not all write.
            if (this.writtenAt.size >= THROTTLE_MAX) {
                this.writtenAt.clear();
            }
            this.writtenAt.set(userId, time);
            void this.write(key, userId, time);
        }
    }

    /**
     * Write one account's `lastSeenAt`, releasing the throttle slot on failure
     * so the next request retries.
     *
     * @param key - The account's `_id`.
     * @param userId - The account's hex id, for the throttle map and the log.
     * @param time - When the account was seen.
     */
    private async write(key: ObjectId, userId: string, time: number): Promise<void> {
        try {
            await this.users.updateOne({ _id: key }, { $max: { lastSeenAt: new Date(time) } });
        } catch (error: unknown) {
            this.writtenAt.delete(userId);
            this.logger.warn({ err: error, userId }, 'Failed to record when an account was last seen');
        }
    }
}
