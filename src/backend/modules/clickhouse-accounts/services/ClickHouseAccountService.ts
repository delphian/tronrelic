/**
 * @fileoverview The single authority for ClickHouse accounts: applying them to
 * the server, changing their limits, recording who changed what, reporting
 * their activity, and handing out account-bound connections.
 *
 * Accounts let different kinds of caller reach ClickHouse under different
 * limits that the server itself enforces, so a bug or a runaway AI agent
 * cannot overload the database the chain writer depends on. Everything that
 * changes an account goes through this service, which is what makes the audit
 * trail complete.
 */

import type {
    IClickHouseAccountAuditEntry,
    IClickHouseAccountConnector,
    IClickHouseAccountDefinition,
    IClickHouseAccountLimits,
    IClickHouseAccountPolicy,
    IClickHouseAccountQuery,
    IClickHouseAccountQuotaUsage,
    IClickHouseAccountService,
    IClickHouseAccountSummary,
    IClickHouseAccountUsageDay,
    IClickHouseReader,
    IClickHouseService,
    ISystemLogService,
    ClickHouseAccountAuditAction,
    ClickHouseAccountState
} from '@/types';
import { accountObjectNames, buildApplyStatements, buildLimitStatements } from './buildAccountSql.js';
import { ClickHouseAccountError } from './ClickHouseAccountError.js';
import type { ClickHouseAccountInspector } from './ClickHouseAccountInspector.js';
import type { ClickHouseAccountStore } from './ClickHouseAccountStore.js';
import type { ClickHouseAccountUsageRollup } from './ClickHouseAccountUsageRollup.js';
import { LIMIT_FIELDS, mergeLimitPatch } from './mergeLimitPatch.js';

/** Most audit entries one request may read. */
const MAX_AUDIT_ENTRIES = 200;

/** Most recent queries one request may read. */
const MAX_RECENT_QUERIES = 200;

/** Most days of usage history one request may read. */
const MAX_HISTORY_DAYS = 365;

/**
 * Everything the service is built from. Passed in rather than constructed so
 * tests can supply fakes for ClickHouse, MongoDB, and the connector.
 */
export interface IClickHouseAccountServiceDependencies {
    /** Declared accounts, from `buildAccountDefinitions`. */
    definitions: IClickHouseAccountDefinition[];
    /** Derives account passwords and opens account-bound connections. */
    connector: IClickHouseAccountConnector;
    /** The shared connection, used to apply accounts. Needs access management rights. */
    clickhouse: IClickHouseService;
    /** Stored limits and the audit trail. */
    store: ClickHouseAccountStore;
    /** Server-reported settings, grants, quota usage, and queries. */
    inspector: ClickHouseAccountInspector;
    /** Daily usage history. */
    rollup: ClickHouseAccountUsageRollup;
    /** Logger scoped to the clickhouse-accounts module. */
    logger: ISystemLogService;
}

/**
 * What the service knows about one managed account in this process.
 */
interface IManagedAccountRuntime {
    state: ClickHouseAccountState;
    error: string | null;
    appliedAt: string | null;
    limits: IClickHouseAccountLimits;
}

/**
 * Singleton implementation of {@link IClickHouseAccountService}.
 */
export class ClickHouseAccountService implements IClickHouseAccountService {
    private static instance: ClickHouseAccountService | null = null;

    private readonly runtime = new Map<string, IManagedAccountRuntime>();
    private readonly readers = new Map<string, IClickHouseReader>();

    /**
     * Tail of the chain every limit change and re-apply waits on. Changes run
     * one at a time, so a second change starts from the limits the first one
     * left rather than from a stale copy, which would silently undo it.
     */
    private mutationTail: Promise<unknown> = Promise.resolve();

    /**
     * Private: use {@link ClickHouseAccountService.setDependencies} and
     * {@link ClickHouseAccountService.getInstance}.
     *
     * Every managed account starts `pending` with its code defaults, so a
     * request that arrives before the startup apply finishes sees an honest
     * state instead of a missing account.
     *
     * @param deps - Collaborators the service is built from.
     */
    private constructor(private readonly deps: IClickHouseAccountServiceDependencies) {
        for (const definition of deps.definitions) {
            if (definition.policy) {
                this.runtime.set(definition.id, {
                    state: 'pending',
                    error: null,
                    appliedAt: null,
                    limits: { ...definition.policy.defaultLimits }
                });
            }
        }
    }

    /**
     * Create the singleton. Later calls are ignored, so the first
     * configuration wins, as for every other `IXxxService` in the platform.
     *
     * @param deps - Collaborators the service is built from.
     */
    static setDependencies(deps: IClickHouseAccountServiceDependencies): void {
        if (!ClickHouseAccountService.instance) {
            ClickHouseAccountService.instance = new ClickHouseAccountService(deps);
        }
    }

    /**
     * Return the singleton.
     *
     * @returns The configured service.
     * @throws Error when `setDependencies()` has not been called.
     */
    static getInstance(): ClickHouseAccountService {
        if (!ClickHouseAccountService.instance) {
            throw new Error('ClickHouseAccountService.setDependencies() must be called before getInstance()');
        }

        return ClickHouseAccountService.instance;
    }

    /**
     * Drop the singleton so each test starts from a fresh instance.
     */
    static resetForTests(): void {
        ClickHouseAccountService.instance = null;
    }

    /**
     * Apply every managed account to ClickHouse, using stored limits where an
     * admin has set them and code defaults otherwise.
     *
     * A failure marks that account `error` and is logged, but does not stop
     * startup. ClickHouse is optional for this platform, and an account that
     * could not be applied is shown on the admin page with its error, where an
     * admin can fix the cause and apply it again. Code asking for the account's
     * reader is refused until then, so nothing runs without its limits.
     */
    async applyAll(): Promise<void> {
        if (!this.deps.connector.hasRootPassword()) {
            this.deps.logger.warn(
                'CLICKHOUSE_PASSWORD is empty, so derived ClickHouse account passwords are predictable. Set it outside local development.'
            );
        }
        for (const definition of this.deps.definitions) {
            if (definition.policy) {
                const stored = await this.deps.store.getLimits(definition.id);
                const limits = stored ? this.clampToCeilings(definition, stored) : { ...definition.policy.defaultLimits };
                await this.applyDefinition(definition, limits);
            }
        }
    }

    /**
     * Summarize every declared account for the admin page, reading each
     * managed account's settings and grants back from ClickHouse.
     *
     * @returns One summary per declared account, in declaration order.
     */
    async listAccounts(): Promise<IClickHouseAccountSummary[]> {
        const summaries: IClickHouseAccountSummary[] = [];
        for (const definition of this.deps.definitions) {
            summaries.push(await this.summarize(definition));
        }

        return summaries;
    }

    /**
     * Summarize one account, so the admin page can refresh a single card
     * after an action without reloading every account.
     *
     * @param accountId - Account to describe.
     * @returns The summary, or null when no account has that id.
     */
    async getAccount(accountId: string): Promise<IClickHouseAccountSummary | null> {
        const definition = this.deps.definitions.find(candidate => candidate.id === accountId);

        return definition ? this.summarize(definition) : null;
    }

    /**
     * Validate an admin's limit change against the ceilings, apply it to
     * ClickHouse, and only then store it, so the stored limits never describe
     * something the server is not enforcing. Success and failure are both
     * audited.
     *
     * @param accountId - Managed account to change.
     * @param patch - The limits to change; omitted fields keep their value.
     * @param actorId - Better Auth user id of the admin making the change.
     * @param reason - The admin's stated reason, recorded in the audit.
     * @returns The account's updated summary.
     * @throws ClickHouseAccountError (400) for an invalid patch, (409) for an
     *   observed account, (502) when ClickHouse refuses the change, or (500)
     *   when ClickHouse accepted it but the limits could not be stored.
     */
    async updateLimits(
        accountId: string,
        patch: Partial<IClickHouseAccountLimits>,
        actorId: string,
        reason: string | null
    ): Promise<IClickHouseAccountSummary> {
        return this.serialize(() => this.updateLimitsNow(accountId, patch, actorId, reason));
    }

    /**
     * Body of {@link updateLimits}, run only from inside {@link serialize} so
     * the `before` snapshot is the limits the previous change left in force.
     *
     * @param accountId - Managed account to change.
     * @param patch - The limits to change; omitted fields keep their value.
     * @param actorId - Better Auth user id of the admin making the change.
     * @param reason - The admin's stated reason, recorded in the audit.
     * @returns The account's updated summary.
     */
    private async updateLimitsNow(
        accountId: string,
        patch: Partial<IClickHouseAccountLimits>,
        actorId: string,
        reason: string | null
    ): Promise<IClickHouseAccountSummary> {
        const { definition, policy, runtime } = this.requireManaged(accountId);
        const before = { ...runtime.limits };
        const after = mergeLimitPatch(before, policy.ceilings, patch as Record<string, unknown>);

        // An active account only needs its profile and quota changed. One that
        // never applied cleanly gets the full apply, since its user or grants
        // may be missing too.
        const wasActive = runtime.state === 'active';
        const applyError = wasActive
            ? await this.runStatements(buildLimitStatements(definition, after))
            : await this.applyDefinition(definition, after);
        if (applyError !== null && wasActive) {
            // The profile may have changed before the quota statement failed.
            // Put the previous limits back so the server enforces what the
            // stored limits and the audit entry say is in force.
            const rollbackError = await this.runStatements(buildLimitStatements(definition, before));
            if (rollbackError !== null) {
                this.deps.logger.error(
                    { accountId, error: rollbackError },
                    'Could not restore previous ClickHouse account limits after a refused change; apply the account again'
                );
            }
        }
        // Once the apply succeeds, ClickHouse is already enforcing the new
        // limits, so a failure to store them must not skip the audit entry.
        // The failure goes into the entry's detail and back to the admin,
        // because the stored limits, which the next startup applies, still
        // hold the old values.
        let storeError: string | null = null;
        if (applyError === null) {
            runtime.limits = after;
            runtime.appliedAt = new Date().toISOString();
            try {
                await this.deps.store.saveLimits(accountId, after, actorId);
            } catch (error) {
                storeError = error instanceof Error ? error.message : String(error);
                this.deps.logger.error(
                    { accountId, error: storeError },
                    'ClickHouse accepted new account limits but they could not be stored; a restart would revert them'
                );
            }
        }
        await this.recordAudit(accountId, 'update-limits', actorId, {
            reason,
            before,
            after,
            detail: applyError ?? (storeError !== null ? `Applied, but not stored: ${storeError}` : null),
            succeeded: applyError === null
        });
        if (applyError !== null) {
            throw new ClickHouseAccountError(`ClickHouse refused the new limits: ${applyError}`, 502);
        }
        if (storeError !== null) {
            throw new ClickHouseAccountError(
                `ClickHouse is enforcing the new limits, but they could not be saved (${storeError}). ` +
                'Save them again, or the next restart will restore the previous limits.',
                500
            );
        }

        return this.summarize(definition);
    }

    /**
     * Re-apply a managed account with its current limits, for when the server
     * was rebuilt or someone changed the account by hand. The attempt is
     * audited whether or not it succeeds, and the summary carries any error.
     *
     * @param accountId - Managed account to apply.
     * @param actorId - Better Auth user id of the admin.
     * @returns The account's summary after the attempt.
     */
    async applyAccount(accountId: string, actorId: string): Promise<IClickHouseAccountSummary> {
        return this.serialize(async () => {
            const { definition, runtime } = this.requireManaged(accountId);
            const applyError = await this.applyDefinition(definition, runtime.limits);
            await this.recordAudit(accountId, 'apply', actorId, {
                reason: null,
                before: null,
                after: null,
                detail: applyError,
                succeeded: applyError === null
            });

            return this.summarize(definition);
        });
    }

    /**
     * Run a change after every change already queued, so two admins saving
     * at once cannot both start from the same limits and lose one edit.
     *
     * A failed change does not block the queue: the next one waits only for
     * the previous one to settle.
     *
     * @param work - The change to run.
     * @returns Whatever the change returns, or its error.
     */
    private serialize<T>(work: () => Promise<T>): Promise<T> {
        const result = this.mutationTail.then(work, work);
        this.mutationTail = result.catch(() => undefined);

        return result;
    }

    /**
     * List an account's running or recent queries, so an admin can see what
     * the account is doing and find a query to stop.
     *
     * @param accountId - Account whose queries to list.
     * @param scope - `running` for live queries, `recent` for the query log.
     * @param limit - Most recent rows to return, capped at 200.
     * @returns Newest first.
     */
    async listQueries(accountId: string, scope: 'running' | 'recent', limit: number): Promise<IClickHouseAccountQuery[]> {
        const definition = this.requireDefinition(accountId);
        const bounded = Math.min(Math.max(1, Math.floor(limit)), MAX_RECENT_QUERIES);

        return scope === 'running'
            ? this.deps.inspector.runningQueries(definition.clickhouseUser)
            : this.deps.inspector.recentQueries(definition.clickhouseUser, bounded);
    }

    /**
     * Stop a running query owned by a managed account.
     *
     * Only managed accounts' queries can be stopped from here. The `default`
     * account runs the chain writer's inserts, and stopping one of those would
     * leave a gap in the chain data. The attempt is audited either way.
     *
     * @param accountId - Managed account the query must belong to.
     * @param queryId - The running query's id.
     * @param actorId - Better Auth user id of the admin.
     * @returns True when the query was running and the kill was sent.
     * @throws ClickHouseAccountError (400) for an unsafe query id, (409) for an
     *   observed account, or (502) when ClickHouse fails the kill.
     */
    async killQuery(accountId: string, queryId: string, actorId: string): Promise<boolean> {
        const { definition } = this.requireManaged(accountId);
        const names = accountObjectNames(definition);
        let found = false;
        let failure: ClickHouseAccountError | null = null;
        try {
            found = await this.deps.inspector.killQuery(names.user, queryId);
        } catch (error) {
            // A refused query id is the admin's mistake (400); anything else is
            // ClickHouse failing the lookup or the kill (502).
            failure = error instanceof ClickHouseAccountError
                ? error
                : new ClickHouseAccountError(error instanceof Error ? error.message : String(error), 502);
        }
        await this.recordAudit(accountId, 'kill-query', actorId, {
            reason: null,
            before: null,
            after: null,
            detail: failure ? `${queryId}: ${failure.message}` : (found ? queryId : `${queryId}: not running`),
            succeeded: failure === null && found
        });
        if (failure !== null) {
            throw failure;
        }

        return found;
    }

    /**
     * Report hourly quota usage per quota key, so an admin can see which run
     * or user is close to its budget. An observed account has no quota.
     *
     * @param accountId - Account whose quota to read.
     * @returns One row per key with usage this interval; empty when observed.
     */
    async getQuotaUsage(accountId: string): Promise<IClickHouseAccountQuotaUsage[]> {
        const definition = this.requireDefinition(accountId);

        return definition.policy ? this.deps.inspector.quotaUsage(accountObjectNames(definition).quota) : [];
    }

    /**
     * Read an account's daily totals from the rollup table, which outlives
     * ClickHouse's own three-day query log.
     *
     * @param accountId - Account whose history to read.
     * @param days - Days back to include, today included, capped at 365.
     * @returns Oldest day first.
     */
    async getUsageHistory(accountId: string, days: number): Promise<IClickHouseAccountUsageDay[]> {
        const definition = this.requireDefinition(accountId);
        const bounded = Math.min(Math.max(1, Math.floor(days)), MAX_HISTORY_DAYS);

        return this.deps.rollup.history(definition.clickhouseUser, bounded);
    }

    /**
     * Read the admin actions recorded against an account, so every change can
     * be traced to who made it and why.
     *
     * @param accountId - Account whose audit trail to read.
     * @param limit - Most entries to return, capped at 200.
     * @returns Newest first.
     */
    async listAudit(accountId: string, limit: number): Promise<IClickHouseAccountAuditEntry[]> {
        this.requireDefinition(accountId);

        return this.deps.store.listAudit(accountId, Math.min(Math.max(1, Math.floor(limit)), MAX_AUDIT_ENTRIES));
    }

    /**
     * Hand out a connection bound to a managed account, refusing one that is
     * not active, so no caller ever reads without the account's limits in
     * force. One reader is shared per account, so its pool size is the whole
     * account's connection budget.
     *
     * @param accountId - Managed account to connect as.
     * @returns The account's shared reader.
     * @throws ClickHouseAccountError (404) when unknown, or (409) when observed
     *   or not active.
     */
    reader(accountId: string): IClickHouseReader {
        const { definition, policy, runtime } = this.requireManaged(accountId);
        if (runtime.state !== 'active') {
            throw new ClickHouseAccountError(
                `ClickHouse account ${accountId} is ${runtime.state}${runtime.error ? `: ${runtime.error}` : ''}. ` +
                'Apply it from the ClickHouse tab of /system/system before using it.',
                409
            );
        }
        let reader = this.readers.get(accountId);
        if (!reader) {
            reader = this.deps.connector.openReader(accountId, definition.clickhouseUser, policy.defaultDatabase, policy.poolSize);
            this.readers.set(accountId, reader);
        }

        return reader;
    }

    /**
     * Run the full apply for one account and record the outcome in memory.
     *
     * @param definition - Managed account to apply.
     * @param limits - Limits to apply with it.
     * @returns Null on success, or ClickHouse's error message.
     */
    private async applyDefinition(definition: IClickHouseAccountDefinition, limits: IClickHouseAccountLimits): Promise<string | null> {
        const runtime = this.runtime.get(definition.id);
        let applyError: string | null;
        try {
            const statements = buildApplyStatements(definition, limits, this.deps.connector.accountPasswordHash(definition.id));
            applyError = await this.runStatements(statements);
        } catch (error) {
            applyError = error instanceof Error ? error.message : String(error);
        }
        if (runtime) {
            runtime.state = applyError === null ? 'active' : 'error';
            runtime.error = applyError;
            if (applyError === null) {
                runtime.limits = limits;
                runtime.appliedAt = new Date().toISOString();
            }
        }
        if (applyError === null) {
            this.deps.logger.info({ accountId: definition.id, user: definition.clickhouseUser }, 'Applied ClickHouse account');
        } else {
            this.deps.logger.error({ accountId: definition.id, error: applyError }, 'Failed to apply ClickHouse account');
        }

        return applyError;
    }

    /**
     * Run statements in order, stopping at the first failure.
     *
     * @param statements - Statements from the SQL builders.
     * @returns Null when all succeeded, or the first failure's message.
     */
    private async runStatements(statements: string[]): Promise<string | null> {
        let failure: string | null = null;
        for (const statement of statements) {
            if (failure === null) {
                try {
                    await this.deps.clickhouse.exec(statement);
                } catch (error) {
                    failure = error instanceof Error ? error.message : String(error);
                }
            }
        }

        return failure;
    }

    /**
     * Lower any stored limit that is above its ceiling.
     *
     * A ceiling can be lowered in code after an admin stored a higher value.
     * The ceiling wins, because it is the reviewed bound, and the lowering is
     * logged so the admin page's stored value and the applied value are not
     * silently different.
     *
     * @param definition - Managed account the limits belong to.
     * @param stored - Limits as stored.
     * @returns Limits with every field at or below its ceiling.
     */
    private clampToCeilings(definition: IClickHouseAccountDefinition, stored: IClickHouseAccountLimits): IClickHouseAccountLimits {
        const policy = definition.policy as IClickHouseAccountPolicy;
        const clamped: IClickHouseAccountLimits = { ...policy.defaultLimits, ...stored };
        for (const field of LIMIT_FIELDS) {
            if (clamped[field] > policy.ceilings[field]) {
                this.deps.logger.warn(
                    { accountId: definition.id, field, stored: clamped[field], ceiling: policy.ceilings[field] },
                    'Stored ClickHouse account limit is above its ceiling; applying the ceiling'
                );
                clamped[field] = policy.ceilings[field];
            }
        }

        return clamped;
    }

    /**
     * Build an account's summary, reading its settings and grants back from
     * ClickHouse.
     *
     * A failed read-back leaves those lists empty and is logged rather than
     * failing the whole summary, so the admin page still shows the account's
     * state and error when ClickHouse is misbehaving, which is exactly when an
     * admin needs it.
     *
     * @param definition - The account.
     * @returns Its summary.
     */
    private async summarize(definition: IClickHouseAccountDefinition): Promise<IClickHouseAccountSummary> {
        const runtime = this.runtime.get(definition.id);
        const summary: IClickHouseAccountSummary = {
            id: definition.id,
            label: definition.label,
            description: definition.description,
            clickhouseUser: definition.clickhouseUser,
            managed: Boolean(definition.policy),
            state: runtime?.state ?? 'observed',
            error: runtime?.error ?? null,
            appliedAt: runtime?.appliedAt ?? null,
            declaredGrants: definition.policy?.grants ?? [],
            limits: runtime ? { ...runtime.limits } : null,
            ceilings: definition.policy ? { ...definition.policy.ceilings } : null,
            defaultLimits: definition.policy ? { ...definition.policy.defaultLimits } : null,
            effectiveSettings: [],
            effectiveGrants: []
        };
        if (definition.policy) {
            try {
                const names = accountObjectNames(definition);
                summary.effectiveSettings = await this.deps.inspector.effectiveSettings(names.profile);
                summary.effectiveGrants = await this.deps.inspector.effectiveGrants(names.user);
            } catch (error) {
                this.deps.logger.warn({ accountId: definition.id, error }, 'Could not read ClickHouse account state back from the server');
            }
        }

        return summary;
    }

    /**
     * Write one audit entry, stamped with the current time.
     *
     * @param accountId - Account acted on.
     * @param action - What was done.
     * @param actorId - Admin who did it.
     * @param fields - The rest of the entry.
     */
    private async recordAudit(
        accountId: string,
        action: ClickHouseAccountAuditAction,
        actorId: string,
        fields: Pick<IClickHouseAccountAuditEntry, 'reason' | 'before' | 'after' | 'detail' | 'succeeded'>
    ): Promise<void> {
        await this.deps.store.appendAudit({ accountId, action, actorId, at: new Date().toISOString(), ...fields });
    }

    /**
     * Find a declared account.
     *
     * @param accountId - Account id from the request.
     * @returns Its definition.
     * @throws ClickHouseAccountError (404) when no account has that id.
     */
    private requireDefinition(accountId: string): IClickHouseAccountDefinition {
        const definition = this.deps.definitions.find(candidate => candidate.id === accountId);
        if (!definition) {
            throw new ClickHouseAccountError(`No ClickHouse account "${accountId}"`, 404);
        }

        return definition;
    }

    /**
     * Find a managed account with its policy and runtime state.
     *
     * @param accountId - Account id from the request.
     * @returns The definition, its policy, and its runtime state.
     * @throws ClickHouseAccountError (404) when unknown, or (409) when observed.
     */
    private requireManaged(accountId: string): {
        definition: IClickHouseAccountDefinition;
        policy: IClickHouseAccountPolicy;
        runtime: IManagedAccountRuntime;
    } {
        const definition = this.requireDefinition(accountId);
        const runtime = this.runtime.get(accountId);
        if (!definition.policy || !runtime) {
            throw new ClickHouseAccountError(
                `ClickHouse account "${accountId}" is observed, not managed, so it has no limits or connection to hand out`,
                409
            );
        }

        return { definition, policy: definition.policy, runtime };
    }
}
