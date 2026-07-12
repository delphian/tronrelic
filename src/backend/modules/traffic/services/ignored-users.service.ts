/**
 * Ignored-users service — the operator-managed registered-account exclusion list.
 *
 * ## Why This Service Exists
 *
 * Operators, staff, and known internal accounts pollute the public traffic
 * numbers: an admin refreshing `/system/traffic` counts as a live visitor,
 * their sessions inflate engagement, their logins skew the conversion funnel.
 * This service holds a small list of Better Auth account ids to exclude from
 * every analytics read so the dashboard reflects real external audience.
 *
 * ## Design Decisions
 *
 * - **Read-time filter, never collection-time.** The raw `traffic_events` rows
 *   are always written and retained under the table's normal TTL. Ignoring is a
 *   query-side exclusion applied by {@link TrafficService}, so it is fully
 *   reversible: removing an account restores its complete history to every stat.
 * - **Whole-person scope.** A single account id excludes every row for any tid
 *   (browser) that ever logged in as that account — including its anonymous,
 *   pre-login browsing under the same cookie. See the exclusion subquery in
 *   {@link TrafficService.rangeParams}. This service owns only the id set; the
 *   SQL that turns an id into "the whole person" lives in TrafficService.
 * - **Mongo-backed, tiny.** The list is operator-curated and small; it persists
 *   in `module_traffic_ignored_users`. TrafficService caches the id array (set
 *   at bootstrap and after each mutation) so the hot read path stays synchronous.
 * - **Singleton** matching {@link GscService} for consistent DI.
 */

import type { Collection } from 'mongodb';
import type { IDatabaseService, ISystemLogService } from '@/types';

/** Physical collection name for the ignore list. */
const COLLECTION_NAME = 'module_traffic_ignored_users';

/**
 * One ignored registered account. `email`/`name` are denormalized from the
 * identity directory at add time purely so the admin list stays readable
 * without a per-render account lookup; `userId` is the load-bearing key.
 */
export interface IIgnoredUserDocument {
    /** Better Auth user id — the exclusion key matched against `traffic_events.user_id`. */
    userId: string;
    /** Account email at add time, for display. Null when unresolved. */
    email: string | null;
    /** Account display name at add time, for display. Null when unset/unresolved. */
    name: string | null;
    /** When the account was added to the ignore list. */
    addedAt: Date;
}

/**
 * Manages the registered-account ignore list backing the always-on analytics
 * exclusion. Owns persistence only; the query-time filtering is TrafficService's.
 */
export class IgnoredUsersService {
    private static instance: IgnoredUsersService;
    private readonly collection: Collection<IIgnoredUserDocument>;

    /**
     * Private constructor enforces the singleton. Use setDependencies() and
     * getInstance().
     *
     * @param database - Database service for the ignore-list collection.
     * @param logger - System log service for operations tracking.
     */
    private constructor(
        private readonly database: IDatabaseService,
        private readonly logger: ISystemLogService
    ) {
        this.collection = database.getCollection<IIgnoredUserDocument>(COLLECTION_NAME);
    }

    /**
     * Initialize the singleton with dependencies. Must be called before
     * getInstance(); invoked during the traffic module's init() phase.
     *
     * @param database - Database service.
     * @param logger - System log service.
     */
    public static setDependencies(database: IDatabaseService, logger: ISystemLogService): void {
        if (!IgnoredUsersService.instance) {
            IgnoredUsersService.instance = new IgnoredUsersService(database, logger);
        }
    }

    /**
     * @throws Error if setDependencies() has not been called first.
     * @returns The singleton instance.
     */
    public static getInstance(): IgnoredUsersService {
        if (!IgnoredUsersService.instance) {
            throw new Error('IgnoredUsersService.setDependencies() must be called before getInstance()');
        }
        return IgnoredUsersService.instance;
    }

    /**
     * Reset the singleton (test-only).
     */
    public static resetInstance(): void {
        IgnoredUsersService.instance = undefined as unknown as IgnoredUsersService;
    }

    /**
     * Create the unique index on `userId` so a repeated add is idempotent and
     * the list can never hold the same account twice. Called once during init().
     */
    async createIndexes(): Promise<void> {
        await this.collection.createIndex({ userId: 1 }, { unique: true, name: 'ignored_user_unique' });
    }

    /**
     * List the ignore list for the admin surface, newest addition first.
     *
     * @returns All ignored accounts with their denormalized display fields.
     */
    async list(): Promise<IIgnoredUserDocument[]> {
        return this.collection.find({}, { projection: { _id: 0 } }).sort({ addedAt: -1 }).toArray();
    }

    /**
     * The bare id set TrafficService caches for its exclusion subquery. Kept
     * separate from {@link list} so the hot cache-refresh path never carries the
     * display fields it does not need.
     *
     * @returns Every ignored account's Better Auth user id.
     */
    async getIds(): Promise<string[]> {
        const rows = await this.collection.find({}, { projection: { _id: 0, userId: 1 } }).toArray();
        return rows.map(r => r.userId);
    }

    /**
     * Add (or refresh the display fields of) an ignored account. Idempotent via
     * upsert on `userId`, so re-adding an already-ignored account just refreshes
     * its email/name and leaves the original `addedAt` untouched.
     *
     * @param entry - The account id plus its display fields resolved by the caller.
     */
    async add(entry: { userId: string; email: string | null; name: string | null }): Promise<void> {
        await this.collection.updateOne(
            { userId: entry.userId },
            {
                $set: { email: entry.email, name: entry.name },
                $setOnInsert: { userId: entry.userId, addedAt: new Date() }
            },
            { upsert: true }
        );
        this.logger.info({ userId: entry.userId }, 'Added account to traffic ignore list');
    }

    /**
     * Remove an account from the ignore list. A no-op when the id is absent, so
     * the caller need not check membership first.
     *
     * @param userId - The Better Auth user id to stop ignoring.
     */
    async remove(userId: string): Promise<void> {
        await this.collection.deleteOne({ userId });
        this.logger.info({ userId }, 'Removed account from traffic ignore list');
    }
}
