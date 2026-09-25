/**
 * @fileoverview Builds the SQL statements that create and update a managed
 * ClickHouse account's user, settings profile, quota, and grants.
 *
 * The statements are built here as plain strings, separate from the code that
 * runs them, so the exact SQL each account produces can be tested without a
 * ClickHouse server. ClickHouse does not accept query parameters in access
 * statements such as `CREATE USER`, so every name and number is validated
 * before it is written into the text.
 */

import type { IClickHouseAccountDefinition, IClickHouseAccountLimits, IClickHouseAccountPolicy } from '@/types';

/** A ClickHouse user, profile, or quota name this module will write into SQL. */
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/** A grant target: `database.*` or `database.table`. */
const GRANT_PATTERN = /^([a-z_][a-z0-9_]*)\.(\*|[a-z_][a-z0-9_]*)$/;

/** A SHA-256 digest in lowercase hex. */
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

/**
 * The ClickHouse object names one managed account owns.
 */
export interface IAccountObjectNames {
    /** The ClickHouse user. */
    user: string;
    /** The settings profile holding the per-query limits. */
    profile: string;
    /** The quota holding the hourly limits. */
    quota: string;
}

/**
 * Work out and validate the names of an account's user, profile, and quota.
 *
 * The profile and quota are named after the user, so an admin looking at
 * ClickHouse directly can see which account each belongs to.
 *
 * @param definition - The account whose object names to derive.
 * @returns The validated names.
 * @throws Error when the user name is not a safe identifier.
 */
export function accountObjectNames(definition: IClickHouseAccountDefinition): IAccountObjectNames {
    const user = assertIdentifier(definition.clickhouseUser);
    const names: IAccountObjectNames = {
        user,
        profile: assertIdentifier(`${user}_profile`),
        quota: assertIdentifier(`${user}_quota`)
    };

    return names;
}

/**
 * Build the `SETTINGS` clause of the account's settings profile.
 *
 * Every numeric limit is written with `MIN 1 MAX <value>`. The `MAX` stops a
 * caller raising the limit for one query. The `MIN 1` matters as much: for
 * each of these settings ClickHouse treats 0 as "no limit" (or, for
 * `max_threads`, "use every core"), so without it a caller could lift the
 * limit by setting it to 0. The overflow modes are fixed at `throw` so a query
 * that hits a limit fails visibly instead of returning a partial result that
 * looks complete.
 *
 * @param limits - The limits to write.
 * @returns The clause body, without the leading `SETTINGS` keyword.
 */
export function buildProfileSettings(limits: IClickHouseAccountLimits): string {
    /**
     * Write one numeric limit as a setting a caller may lower but not raise
     * or switch off, so every limit carries the same constraint.
     *
     * @param name - ClickHouse setting name.
     * @param value - The limit, validated as a positive whole number.
     * @returns `name = value MIN 1 MAX value`.
     */
    const bounded = (name: string, value: number): string => {
        const checked = assertPositiveInteger(value, name);
        return `${name} = ${checked} MIN 1 MAX ${checked}`;
    };

    const clauses = [
        'readonly = 2 CONST',
        bounded('max_execution_time', limits.maxExecutionSeconds),
        "timeout_overflow_mode = 'throw' CONST",
        bounded('max_rows_to_read', limits.maxRowsToRead),
        bounded('max_bytes_to_read', limits.maxBytesToRead),
        "read_overflow_mode = 'throw' CONST",
        bounded('max_memory_usage', limits.maxMemoryBytes),
        bounded('max_threads', limits.maxThreads),
        bounded('max_result_rows', limits.maxResultRows),
        "result_overflow_mode = 'throw' CONST",
        `max_concurrent_queries_for_user = ${assertPositiveInteger(limits.maxConcurrentQueries, 'max_concurrent_queries_for_user')} CONST`,
        'cancel_http_readonly_queries_on_client_close = 1 CONST'
    ];

    return clauses.join(', ');
}

/**
 * Build the interval clause of the account's quota.
 *
 * The quota is keyed by `client_key, user_name`: a caller that passes a quota
 * key, such as an agent run id, gets a budget for that key, and a caller that
 * passes none is counted against the account's user name.
 *
 * @param limits - The hourly limits to write.
 * @returns The `KEYED BY ... FOR INTERVAL ...` clause.
 */
export function buildQuotaClause(limits: IClickHouseAccountLimits): string {
    const queries = assertPositiveInteger(limits.hourlyQueries, 'hourlyQueries');
    const readRows = assertPositiveInteger(limits.hourlyReadRows, 'hourlyReadRows');
    const executionTime = assertPositiveInteger(limits.hourlyExecutionSeconds, 'hourlyExecutionSeconds');

    return `KEYED BY client_key, user_name FOR INTERVAL 1 hour MAX queries = ${queries}, read_rows = ${readRows}, execution_time = ${executionTime}`;
}

/**
 * Build the statements that update only an account's limits: its profile and
 * its quota. Used when an admin changes limits, where the user and grants are
 * already in place and re-issuing them would briefly revoke access.
 *
 * @param definition - The managed account.
 * @param limits - The limits to apply.
 * @returns Statements to run in order.
 */
export function buildLimitStatements(definition: IClickHouseAccountDefinition, limits: IClickHouseAccountLimits): string[] {
    const names = accountObjectNames(definition);
    const statements = [
        `ALTER SETTINGS PROFILE \`${names.profile}\` SETTINGS ${buildProfileSettings(limits)}`,
        `ALTER QUOTA \`${names.quota}\` ${buildQuotaClause(limits)} TO \`${names.user}\``
    ];

    return statements;
}

/**
 * Build every statement that brings an account's user, profile, grants, and
 * quota in line with its declaration and limits.
 *
 * Each object is created with `IF NOT EXISTS` and then altered to match,
 * rather than replaced, because replacing a quota would reset its usage
 * counters. The order matters: the user names its profile, so the profile
 * comes first, and the quota is assigned to the user, so the user comes before
 * the quota. All privileges are revoked before the declared grants are given,
 * so a privilege someone added by hand does not survive.
 *
 * The password appears only as a SHA-256 hash (`sha256_hash`), so the SQL
 * text, any error log that quotes it, and ClickHouse's query log never contain
 * the password itself.
 *
 * @param definition - The managed account.
 * @param limits - The limits to apply.
 * @param passwordHash - Hex SHA-256 of the account's derived password.
 * @returns Statements to run in order.
 * @throws Error when the account has no policy or a value fails validation.
 */
export function buildApplyStatements(
    definition: IClickHouseAccountDefinition,
    limits: IClickHouseAccountLimits,
    passwordHash: string
): string[] {
    const policy = requirePolicy(definition);
    const names = accountObjectNames(definition);
    if (!SHA256_HEX_PATTERN.test(passwordHash)) {
        throw new Error('Account password hash must be a lowercase hex SHA-256 digest');
    }

    const identified = `IDENTIFIED WITH sha256_hash BY '${passwordHash}'`;
    const statements = [
        `CREATE SETTINGS PROFILE IF NOT EXISTS \`${names.profile}\``,
        `ALTER SETTINGS PROFILE \`${names.profile}\` SETTINGS ${buildProfileSettings(limits)}`,
        `CREATE USER IF NOT EXISTS \`${names.user}\` ${identified} SETTINGS PROFILE '${names.profile}'`,
        `ALTER USER \`${names.user}\` ${identified} SETTINGS PROFILE '${names.profile}'`,
        `REVOKE ALL ON *.* FROM \`${names.user}\``,
        ...policy.grants.map(grant => `GRANT SELECT ON ${formatGrantTarget(grant)} TO \`${names.user}\``),
        `CREATE QUOTA IF NOT EXISTS \`${names.quota}\` ${buildQuotaClause(limits)} TO \`${names.user}\``,
        `ALTER QUOTA \`${names.quota}\` ${buildQuotaClause(limits)} TO \`${names.user}\``
    ];

    return statements;
}

/**
 * Return an account's policy, refusing an observed account.
 *
 * @param definition - The account.
 * @returns Its policy.
 * @throws Error when the account is observed.
 */
function requirePolicy(definition: IClickHouseAccountDefinition): IClickHouseAccountPolicy {
    if (!definition.policy) {
        throw new Error(`Account ${definition.id} is observed, not managed, and has nothing to apply`);
    }

    return definition.policy;
}

/**
 * Validate a grant target and quote its parts for SQL.
 *
 * @param grant - `database.*` or `database.table`.
 * @returns The target with the database, and the table when named, backtick-quoted.
 * @throws Error when the target is not in that form.
 */
function formatGrantTarget(grant: string): string {
    const match = GRANT_PATTERN.exec(grant);
    if (!match) {
        throw new Error(`Grant target "${grant}" must be database.* or database.table`);
    }
    const [, database, table] = match;

    return table === '*' ? `\`${database}\`.*` : `\`${database}\`.\`${table}\``;
}

/**
 * Check a name is safe to write into SQL as an identifier.
 *
 * @param name - Candidate user, profile, or quota name.
 * @returns The name unchanged.
 * @throws Error when it is not lowercase letters, digits, and underscores
 *   starting with a letter.
 */
function assertIdentifier(name: string): string {
    if (!IDENTIFIER_PATTERN.test(name)) {
        throw new Error(`"${name}" is not a valid ClickHouse account object name`);
    }

    return name;
}

/**
 * Check a limit is a positive whole number that can be written into SQL as-is.
 *
 * @param value - The limit.
 * @param label - Setting or field name, used in the error message.
 * @returns The value unchanged.
 * @throws Error when the value is not a positive safe integer.
 */
function assertPositiveInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${label} must be a positive whole number, got ${String(value)}`);
    }

    return value;
}
