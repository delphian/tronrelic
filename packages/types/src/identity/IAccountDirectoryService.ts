/**
 * @fileoverview Published contract for read access to Better Auth accounts.
 *
 * The identity module registers its `AccountDirectoryService` on the service
 * registry as `'accounts'`; consumers read account data through
 * `services.get<IAccountDirectoryService>('accounts')`.
 *
 * This is the *only* sanctioned path to the `module_user_auth_users`
 * collection outside the identity module. No code elsewhere touches that
 * collection directly — not even through `IDatabaseService`. Routing every
 * account read through this service is the single-responsibility guarantee the
 * module restructure exists to enforce.
 */

/**
 * Public summary of a Better Auth account.
 *
 * Projects the Better Auth user row down to the fields admin tooling and
 * analytics need, omitting auth-internal columns.
 */
export interface IAccountSummary {
    /** Better Auth user id (`module_user_auth_users._id`, also `session.user.id`). */
    id: string;

    /** Account email. */
    email: string;

    /** Display name, or null when unset. */
    name: string | null;

    /** Whether the email has been verified. */
    emailVerified: boolean;

    /** When the account was created. */
    createdAt: Date;

    /** Group memberships (group ids), denormalized onto the BA user record. */
    groups: string[];

    /** Denormalized primary wallet address, or null when no wallet is linked. */
    primaryWallet: string | null;
}

/**
 * Options for paginated/filtered account listing.
 */
export interface IListAccountsOptions {
    /** Page size. Service applies a sane default and ceiling. */
    limit?: number;

    /** Pagination offset. */
    skip?: number;

    /** Case-insensitive substring match against email/name. */
    search?: string;
}

/**
 * Result of a {@link IAccountDirectoryService.listAccounts} call.
 */
export interface IListAccountsResult {
    /** The page of account summaries. */
    accounts: IAccountSummary[];

    /** Total matching the filter, ignoring pagination. */
    total: number;
}

/**
 * Read-only directory over the Better Auth account collection.
 *
 * Sole legitimate reader of `module_user_auth_users` outside the identity
 * module's own write paths.
 */
export interface IAccountDirectoryService {
    /** Total number of Better Auth accounts. */
    countAccounts(): Promise<number>;

    /**
     * Fetch a single account summary by Better Auth user id.
     *
     * @param baUserId - Better Auth user id.
     * @returns The summary, or null when no such account exists.
     */
    getAccount(baUserId: string): Promise<IAccountSummary | null>;

    /**
     * List accounts with optional pagination and search.
     *
     * @param options - Pagination and filter options.
     * @returns The matching page plus the unpaginated total.
     */
    listAccounts(options?: IListAccountsOptions): Promise<IListAccountsResult>;
}
