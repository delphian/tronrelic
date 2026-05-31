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
    IAccountDirectoryService,
    IAccountSummary,
    IListAccountsOptions,
    IListAccountsResult,
    IDatabaseService,
    ISystemLogService
} from '@/types';
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
}

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

    /**
     * @param database - Database abstraction (Tier-1 collection access).
     * @param logger - Derives an `account-directory-service` child logger.
     */
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
     * Count all Better Auth accounts.
     *
     * @returns The total account count.
     */
    public async countAccounts(): Promise<number> {
        return this.authUsers.countDocuments();
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
     * List accounts with optional pagination and case-insensitive search.
     *
     * @param options - Pagination and filter options.
     * @returns The matching page plus the unpaginated total.
     */
    public async listAccounts(options: IListAccountsOptions = {}): Promise<IListAccountsResult> {
        const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
        const skip = Math.max(0, options.skip ?? 0);

        const search = options.search ? AccountDirectoryService.escapeRegex(options.search) : null;
        const filter = search
            ? {
                  $or: [
                      { email: { $regex: search, $options: 'i' } },
                      { name: { $regex: search, $options: 'i' } }
                  ]
              }
            : {};

        const [docs, total] = await Promise.all([
            this.authUsers.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
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
     *
     * @param input - Raw search string from the caller.
     * @returns The input with all regex special characters escaped.
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
            primaryWallet: doc.primaryWallet ?? null
        };
    }
}
