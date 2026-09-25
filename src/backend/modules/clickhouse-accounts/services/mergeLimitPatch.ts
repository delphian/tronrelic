/**
 * @fileoverview Checks an admin's limit change against the account's ceilings
 * and merges it into the current limits.
 *
 * The admin page is the only place limits change at runtime, and a mistyped
 * value there could remove the protection the account exists for. Every value
 * is checked here, before anything is sent to ClickHouse, so a bad request is
 * refused with a message the admin can act on.
 */

import type { IClickHouseAccountLimits } from '@/types';
import { ClickHouseAccountError } from './ClickHouseAccountError.js';

/** The limit field names, in the order the admin page shows them. */
export const LIMIT_FIELDS: ReadonlyArray<keyof IClickHouseAccountLimits> = [
    'maxExecutionSeconds',
    'maxRowsToRead',
    'maxBytesToRead',
    'maxMemoryBytes',
    'maxThreads',
    'maxResultRows',
    'maxConcurrentQueries',
    'hourlyQueries',
    'hourlyReadRows',
    'hourlyExecutionSeconds'
];

/**
 * Validate a partial set of limits and merge it into the current ones.
 *
 * Unknown fields are refused rather than ignored, so a typo in a field name
 * does not look like a change that took effect. Each value must be a positive
 * whole number no higher than the account's ceiling for that field.
 *
 * @param current - Limits in force now.
 * @param ceilings - Highest value allowed for each field.
 * @param patch - The fields to change, as received from the request body.
 * @returns The merged limits.
 * @throws ClickHouseAccountError (400) naming the first field that fails, or
 *   when the patch changes nothing.
 */
export function mergeLimitPatch(
    current: IClickHouseAccountLimits,
    ceilings: IClickHouseAccountLimits,
    patch: Record<string, unknown>
): IClickHouseAccountLimits {
    const merged: IClickHouseAccountLimits = { ...current };
    const keys = Object.keys(patch);
    if (keys.length === 0) {
        throw new ClickHouseAccountError('No limits were given to change', 400);
    }

    for (const key of keys) {
        if (!(LIMIT_FIELDS as ReadonlyArray<string>).includes(key)) {
            throw new ClickHouseAccountError(`Unknown limit "${key}"`, 400);
        }
        const field = key as keyof IClickHouseAccountLimits;
        const value = patch[key];
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
            throw new ClickHouseAccountError(`${field} must be a positive whole number`, 400);
        }
        if (value > ceilings[field]) {
            throw new ClickHouseAccountError(
                `${field} cannot exceed its ceiling of ${ceilings[field]}. The ceiling is set in code, in buildAccountDefinitions.ts`,
                400
            );
        }
        merged[field] = value;
    }

    return merged;
}
