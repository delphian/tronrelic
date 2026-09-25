/**
 * @fileoverview How each ClickHouse account limit is named, grouped, and
 * formatted on the admin page, and how to tell when ClickHouse disagrees with
 * the stored value.
 *
 * The backend names limits after what they control (`maxRowsToRead`). An
 * admin reads them better as plain phrases ("Rows a query may scan") grouped
 * by what they apply to: one query, the whole account at once, or one quota
 * key per hour. Keeping those descriptions in one list means the gauges, the
 * editor, and the change history all use the same wording.
 */

import type { IClickHouseAccountLimits, IClickHouseAccountSetting } from '@/types';
import { formatBytes } from '../../../lib/format';
import { formatCount, formatSeconds } from './formatQuantity';

/** What a group of limits applies to. */
export type LimitGroup = 'query' | 'account' | 'hourly';

/**
 * Display description of one limit.
 */
export interface ILimitField {
    /** Field name on {@link IClickHouseAccountLimits}. */
    key: keyof IClickHouseAccountLimits;
    /** Plain-language name. */
    label: string;
    /** What the limit applies to. */
    group: LimitGroup;
    /**
     * The ClickHouse profile setting this limit becomes, used to compare the
     * stored value with what the server reports. Null for quota limits, which
     * live in the quota rather than the profile.
     */
    setting: string | null;
    /**
     * Short form of a value, such as "50M" or "5 GB".
     *
     * @param value - The limit value.
     * @returns The value in the limit's own unit.
     */
    format: (value: number) => string;
}

/** Every limit, in the order the page shows them. */
export const LIMIT_FIELDS: readonly ILimitField[] = [
    { key: 'maxExecutionSeconds', label: 'Longest a query may run', group: 'query', setting: 'max_execution_time', format: formatSeconds },
    { key: 'maxRowsToRead', label: 'Rows a query may scan', group: 'query', setting: 'max_rows_to_read', format: formatCount },
    { key: 'maxBytesToRead', label: 'Data a query may scan', group: 'query', setting: 'max_bytes_to_read', format: formatBytes },
    { key: 'maxMemoryBytes', label: 'Memory a query may use', group: 'query', setting: 'max_memory_usage', format: formatBytes },
    { key: 'maxThreads', label: 'Threads a query may use', group: 'query', setting: 'max_threads', format: formatCount },
    { key: 'maxResultRows', label: 'Rows a query may return', group: 'query', setting: 'max_result_rows', format: formatCount },
    { key: 'maxConcurrentQueries', label: 'Queries running at once', group: 'account', setting: 'max_concurrent_queries_for_user', format: formatCount },
    { key: 'hourlyQueries', label: 'Queries', group: 'hourly', setting: null, format: formatCount },
    { key: 'hourlyReadRows', label: 'Rows scanned', group: 'hourly', setting: null, format: formatCount },
    { key: 'hourlyExecutionSeconds', label: 'Query time', group: 'hourly', setting: null, format: formatSeconds }
];

/** Headings and explanations for each group, in display order. */
export const LIMIT_GROUPS: ReadonlyArray<{ group: LimitGroup; title: string; note: string }> = [
    { group: 'query', title: 'Each query', note: 'A query that goes past one of these fails with an error naming the limit.' },
    { group: 'account', title: 'The whole account', note: 'This caps the total load, however many quota keys callers use.' },
    { group: 'hourly', title: 'Each hour, per quota key', note: 'Callers pass a quota key, such as an agent run. Calls without one share the account’s budget.' }
];

/**
 * Find the value ClickHouse reports for a limit's profile setting, when it
 * differs from the stored value.
 *
 * @param field - The limit.
 * @param stored - The value the platform stored and applied.
 * @param settings - Profile rows read back from ClickHouse.
 * @returns The server's value when it differs, or null when it matches, the
 *   limit is a quota limit, or the server did not report the setting.
 */
export function serverDrift(field: ILimitField, stored: number, settings: IClickHouseAccountSetting[]): number | null {
    let drift: number | null = null;
    if (field.setting) {
        const row = settings.find(setting => setting.name === field.setting);
        const reported = row?.value === null || row?.value === undefined ? NaN : Number(row.value);
        if (Number.isFinite(reported) && reported !== stored) {
            drift = reported;
        }
    }

    return drift;
}

/**
 * Look up a limit's description by field name.
 *
 * @param key - Field name on {@link IClickHouseAccountLimits}.
 * @returns The description.
 */
export function limitField(key: keyof IClickHouseAccountLimits): ILimitField {
    return LIMIT_FIELDS.find(field => field.key === key) as ILimitField;
}
