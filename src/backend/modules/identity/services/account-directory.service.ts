/**
 * @fileoverview Read-only directory over the Better Auth account collection.
 *
 * Sole sanctioned reader of `module_user_auth_users` outside the identity
 * module's own write paths. Modules and plugins that need account data consume
 * this through `services.get<IAccountDirectoryService>('accounts')` rather than
 * touching the collection directly — the single-responsibility guarantee the
 * Better Auth module restructure exists to enforce.
 *
 * **Singleton.** Implements an `IXxxService` interface, so it follows the
 * project's `setDependencies()` / `getInstance()` pattern — shared application
 * state configured once at bootstrap.
 */

import type { Collection, ObjectId } from 'mongodb';
import type {
    AccountSortField,
    IAccountDirectoryService,
    IAccountSummary,
    IListAccountsOptions,
    IListAccountsResult,
    IDatabaseService,
    ISystemLogService
} from '@/types';
import { ACCOUNT_SORT_FIELDS } from '@/types';
import { AUTH_USERS_COLLECTION } from './auth-constants.js';
import { toUserKey, userIdFromKey } from './user-id.js';

/** Default page size for {@link AccountDirectoryService.listAccounts}. */
const DEFAULT_LIMIT = 50;

/** Hard ceiling on page size to bound query cost. */
const MAX_LIMIT = 200;

/**
 * Subset of the Better Auth user row this service reads.
 *
 * BA's adapter stores the user `_id` as a native `ObjectId` and exposes it as
 * the hex `user.id`; reads convert the incoming hex id to an `ObjectId` via
 * {@link toUserKey}, and {@link userIdFromKey} converts it back on the way out
 * so the public summary's `id` stays an opaque string. The `groups` /
 * `primaryWallet` additional fields are declared in `auth.ts`.
 */
interface IAuthUserDocument {
    _id: ObjectId;
    email: string;
    name?: string | null;
    emailVerified?: boolean;
    createdAt: Date;
    groups?: string[];
    primaryWallet?: string | null;
    /** Set by `AccountDeletionService` when an admin deletes the account. */
    deletedAt?: Date | null;
    /** Kept current by `AccountActivityTracker`; absent until the account is first seen. */
    lastSeenAt?: Date | null;
}

/**
 * The value each sortable column is ordered by, as an aggregation expression
 * computed per account. Columns shown as a badge or a tick sort by what the
 * badge means rather than by raw text, and each expression tolerates a
 * missing or malformed field, because Better Auth rows written before a field
 * existed do not have it.
 */
const SORT_KEYS: Record<AccountSortField, unknown> = {
    email: '$email',
    name: { $ifNull: ['$name', ''] },
    // Deleted (0), then unverified (1), then verified (2).
    status: { $cond: [{ $ifNull: ['$deletedAt', false] }, 0, { $cond: [{ $eq: ['$emailVerified', true] }, 2, 1] }] },
    primaryWallet: {
        $cond: [{ $and: [{ $eq: [{ $type: '$primaryWallet' }, 'string'] }, { $ne: ['$primaryWallet', ''] }] }, 1, 0]
    },
    groups: { $cond: [{ $isArray: '$groups' }, { $size: '$groups' }, 0] },
    createdAt: '$createdAt',
    // An account never seen sorts as the oldest.
    lastSeenAt: { $ifNull: ['$lastSeenAt', new Date(0)] }
};

/**
 * Compare strings without regard to case, so `alice@` and `Bob@` sort
 * alphabetically rather than by character code.
 */
const SORT_COLLATION = { locale: 'en', strength: 2 };

/**
 * Read-only directory over `module_user_auth_users`.
 */
export class AccountDirectoryService implements IAccountDirectoryService {
    /** Singleton instance. `null` until {@link setDependencies} runs. */
    private static instance: AccountDirectoryService | null = null;

    /** Better Auth user collection handle. */
    private readonly authUsers: Collection<IAuthUserDocument>;

    /** Logger scoped to this service. */
    private readonly logger: ISystemLogService;

    /** Bind the auth-users collection (Tier-1 access) and an `account-directory-service` child logger. */
    private constructor(database: IDatabaseService, logger: ISystemLogService) {
        this.authUsers = database.getCollection<IAuthUserDocument>(AUTH_USERS_COLLECTION);
        this.logger = logger.child({ component: 'account-directory-service' });
    }

    /**
     * Configure the singleton with its dependencies. Idempotent — a second
     * call keeps the first instance.
     *
     * @param database - Database service injected by the module.
     * @param logger - Identity-module child logger.
     */
    public static setDependencies(database: IDatabaseService, logger: ISystemLogService): void {
        if (!AccountDirectoryService.instance) {
            AccountDirectoryService.instance = new AccountDirectoryService(database, logger);
        }
    }

    /**
     * Retrieve the configured singleton.
     *
     * @returns The shared instance.
     * @throws {Error} When called before {@link setDependencies}.
     */
    public static getInstance(): AccountDirectoryService {
        if (!AccountDirectoryService.instance) {
            throw new Error('AccountDirectoryService.setDependencies() must be called before getInstance()');
        }
        return AccountDirectoryService.instance;
    }

    /**
     * Reset the singleton between tests.
     */
    public static resetForTests(): void {
        AccountDirectoryService.instance = null;
    }

    /**
     * Create the index the sign-up cap counts against. The cap counts recent
     * accounts on every code request for a new address and on every account
     * creation, so the count has to read an index range, not every account.
     */
    public async createIndexes(): Promise<void> {
        await this.authUsers.createIndex({ createdAt: -1 }, { name: 'createdAt_desc' });
        this.logger.info('Account creation-time index ensured on the Better Auth user collection');
    }

    /**
     * Count all Better Auth accounts.
     *
     * @returns The total account count.
     */
    public async countAccounts(): Promise<number> {
        return this.authUsers.countDocuments();
    }

    /**
     * Count accounts created at or after a moment. Deleted accounts are
     * counted too, because the sign-up cap measures how fast accounts are
     * being made, and an admin deleting a farm's accounts does not slow it.
     *
     * @param since - Start of the span to count.
     * @returns How many accounts were created since then.
     */
    public async countCreatedSince(since: Date): Promise<number> {
        return this.authUsers.countDocuments({ createdAt: { $gte: since } });
    }

    /**
     * Count accounts created since a moment, grouped by email domain, busiest
     * domain first. Backs the domain list on the Sign-ups tab, where an admin
     * spots a domain an account farm is using.
     *
     * @param since - Start of the span to count.
     * @param limit - Most domains to return.
     * @returns Each domain with its count of new accounts.
     */
    public async countCreatedByEmailDomainSince(since: Date, limit: number): Promise<Array<{ domain: string; count: number }>> {
        const rows = await this.authUsers.aggregate<{ _id: string | null; count: number }>([
            { $match: { createdAt: { $gte: since } } },
            { $group: { _id: { $toLower: { $arrayElemAt: [{ $split: ['$email', '@'] }, -1] } }, count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: limit }
        ]).toArray();
        return rows
            .filter((row): row is { _id: string; count: number } => typeof row._id === 'string' && row._id.length > 0)
            .map(row => ({ domain: row._id, count: row.count }));
    }

    /**
     * Fetch one account summary by Better Auth user id.
     *
     * @param baUserId - Better Auth user id (`module_user_auth_users._id`).
     * @returns The summary, or null when no such account exists.
     */
    public async getAccount(baUserId: string): Promise<IAccountSummary | null> {
        const key = toUserKey(baUserId);
        let summary: IAccountSummary | null = null;
        if (key) {
            const doc = await this.authUsers.findOne({ _id: key });
            summary = doc ? AccountDirectoryService.toSummary(doc) : null;
        }
        return summary;
    }

    /**
     * Fetch one account by its exact email address.
     *
     * Admin tooling handed an address has to reach that one account directly.
     * Paging {@link listAccounts} cannot do it safely: that search matches the
     * term anywhere in an email or display name, and the page limit keeps the
     * newest matches. Anyone can put an address in their own display name, so
     * enough newer matches push the real account off the page and make it look
     * absent. Matching the whole address in one query cannot be hidden that
     * way. The match is case-insensitive because the caller passes whatever an
     * administrator typed.
     *
     * @param email - The full address to match.
     * @returns The summary, or null when no account has that address.
     */
    public async getAccountByEmail(email: string): Promise<IAccountSummary | null> {
        const pattern = `^${AccountDirectoryService.escapeRegex(email.trim())}$`;
        const doc = await this.authUsers.findOne({ email: { $regex: pattern, $options: 'i' } });
        return doc ? AccountDirectoryService.toSummary(doc) : null;
    }

    /**
     * Fetch several account summaries with one `$in` query, so a caller
     * labelling a page of rows does not pay one round trip per row.
     *
     * @param baUserIds - Better Auth user ids; invalid ids and duplicates are
     *   dropped before the query.
     * @returns Summaries for the accounts that exist, in no particular order.
     */
    public async getAccountsByIds(baUserIds: string[]): Promise<IAccountSummary[]> {
        const keys = [...new Set(baUserIds)]
            .map(id => toUserKey(id))
            .filter((key): key is ObjectId => key !== null);
        let summaries: IAccountSummary[] = [];
        if (keys.length > 0) {
            const docs = await this.authUsers.find({ _id: { $in: keys } }).toArray();
            summaries = docs.map(AccountDirectoryService.toSummary);
        }
        return summaries;
    }

    /**
     * List accounts with optional pagination, case-insensitive search, and a
     * sort on any column of the Users tab.
     *
     * The sort value is computed per account in an aggregation, so no index
     * serves it and every matching account is read to order the page. That is
     * acceptable for an account directory of thousands; a much larger one
     * would need the computed columns stored and indexed instead. The account
     * id breaks ties, so paging through equal values never repeats or skips a row.
     *
     * @param options - Pagination, filter, and sort options. An unknown sort
     *   field falls back to `createdAt`, and the direction to `desc`.
     * @returns The matching page plus the unpaginated total.
     */
    public async listAccounts(options: IListAccountsOptions = {}): Promise<IListAccountsResult> {
        const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
        const skip = Math.max(0, options.skip ?? 0);
        const sortBy: AccountSortField = ACCOUNT_SORT_FIELDS.find(field => field === options.sortBy) ?? 'createdAt';
        const direction = options.sortDirection === 'asc' ? 1 : -1;

        const search = options.search ? AccountDirectoryService.escapeRegex(options.search) : null;
        const filter = search
            ? {
                  $or: [
                      { email: { $regex: search, $options: 'i' } },
                      { name: { $regex: search, $options: 'i' } }
                  ]
              }
            : {};

        const pipeline = [
            { $match: filter },
            { $addFields: { _sortKey: SORT_KEYS[sortBy] } },
            { $sort: { _sortKey: direction, _id: direction } },
            { $skip: skip },
            { $limit: limit },
            { $project: { _sortKey: 0 } }
        ];
        const [docs, total] = await Promise.all([
            this.authUsers.aggregate<IAuthUserDocument>(pipeline, { collation: SORT_COLLATION }).toArray(),
            this.authUsers.countDocuments(filter)
        ]);

        return {
            accounts: docs.map(AccountDirectoryService.toSummary),
            total
        };
    }

    /**
     * Escape user-supplied text for safe literal use inside a MongoDB `$regex`.
     *
     * Account search feeds the raw term straight into a `$regex` filter, so an
     * unescaped term lets a caller inject regex syntax — a crafted pattern can
     * trigger catastrophic backtracking (ReDoS) or silently change which rows
     * match. Backslash-escaping every regex metacharacter forces the term to
     * match literally, which is the only behaviour the search box promises.
     */
    private static escapeRegex(input: string): string {
        return input.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    }

    /**
     * Project a Better Auth user row to the public account summary shape.
     *
     * @param doc - Raw `module_user_auth_users` document.
     * @returns The summary projection.
     */
    private static toSummary(doc: IAuthUserDocument): IAccountSummary {
        return {
            id: userIdFromKey(doc._id),
            email: doc.email,
            name: doc.name ?? null,
            emailVerified: doc.emailVerified ?? false,
            createdAt: doc.createdAt,
            groups: doc.groups ?? [],
            primaryWallet: doc.primaryWallet ?? null,
            deletedAt: doc.deletedAt ?? null,
            lastSeenAt: doc.lastSeenAt ?? null
        };
    }
}
