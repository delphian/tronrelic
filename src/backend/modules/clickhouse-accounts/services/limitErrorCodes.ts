/**
 * @fileoverview ClickHouse error codes that mean a query was stopped by an
 * account's limits or permissions rather than by a mistake in the query.
 *
 * The admin page counts these separately from other failures. A rising count
 * of limit hits tells an admin the limits may be too tight for the work, and a
 * rising count of denials tells them a caller is trying to reach something the
 * account was never granted. Both questions are different from "is the SQL
 * wrong", so they need their own numbers.
 */

/**
 * Codes for a query stopped by a resource limit, the quota, the concurrency
 * limit, or an attempt to raise a constrained setting.
 *
 * 158 TOO_MANY_ROWS, 159 TIMEOUT_EXCEEDED, 160 TOO_SLOW, 201 QUOTA_EXCEEDED,
 * 202 TOO_MANY_SIMULTANEOUS_QUERIES, 241 MEMORY_LIMIT_EXCEEDED,
 * 307 TOO_MANY_BYTES, 396 TOO_MANY_ROWS_OR_BYTES,
 * 452 SETTING_CONSTRAINT_VIOLATION.
 */
export const LIMIT_ERROR_CODES: readonly number[] = [158, 159, 160, 201, 202, 241, 307, 396, 452];

/**
 * Codes for a query refused because the account may not do it:
 * 164 READONLY and 497 ACCESS_DENIED.
 */
export const DENIED_ERROR_CODES: readonly number[] = [164, 497];
