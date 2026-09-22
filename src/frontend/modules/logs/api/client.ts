/**
 * @fileoverview Logs API client functions.
 *
 * Provides typed API functions for fetching system logs, statistics,
 * and performing log management operations.
 *
 * @module modules/logs/api/client
 */

import type { LogLevel } from '@/types';
import { LOG_MONITOR_LEVELS_SETTING } from '@/types';
import type { LogsResponse, LogStats } from '../types';

/**
 * One stored value as returned by `GET /api/user/settings`.
 */
interface IUserSettingValue {
    /** Provider namespace the value lives under. */
    namespace: string;
    /** Setting key within the namespace. */
    key: string;
    /** The stored value, or the registered default when the user has none. */
    value: unknown;
}

/**
 * Query parameters for fetching paginated logs.
 */
export interface LogsQuery {
    /** Severity levels to include */
    levels?: LogLevel[];
    /** Exact service name to filter by */
    service?: string;
    /** Page number (1-based) */
    page?: number;
    /** Maximum entries per page */
    limit?: number;
}

/**
 * Fetches paginated system logs with optional filtering.
 *
 * Authorization rides the same-origin Better Auth session cookie;
 * the backend `requireAdmin` middleware resolves it per request.
 *
 * @param query - Filter and pagination parameters
 * @returns Paginated logs response with metadata
 * @throws Error if the API request fails
 */
export async function getSystemLogs(query: LogsQuery = {}): Promise<LogsResponse> {
    const params = new URLSearchParams();

    if (query.levels && query.levels.length > 0) {
        query.levels.forEach(level => params.append('levels', level));
    }

    if (query.service) {
        params.append('service', query.service);
    }

    if (query.page) {
        params.append('page', query.page.toString());
    }

    if (query.limit) {
        params.append('limit', query.limit.toString());
    }

    const response = await fetch(
        `/api/admin/system/logs?${params.toString()}`
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch logs: ${response.status}`);
    }

    return response.json();
}

/**
 * Fetches aggregate log statistics.
 *
 * Returns counts by severity level, service, and resolution status.
 * Used by the dashboard metrics and service filter dropdown.
 *
 * @param service Optional exact service name. When given, every count covers
 * only that service, which is what a log viewer scoped to one plugin shows.
 * @returns Log statistics object
 * @throws Error if the API request fails
 */
export async function getLogStats(service?: string): Promise<LogStats> {
    const query = service ? `?service=${encodeURIComponent(service)}` : '';
    const response = await fetch(
        `/api/admin/system/logs/stats${query}`
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch log stats: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
        throw new Error('Failed to fetch log statistics');
    }

    return data.stats;
}

/**
 * Deletes all system log entries.
 *
 * Destructive operation that removes all logs from the database.
 *
 * @returns Number of deleted log entries
 * @throws Error if the API request fails
 */
export async function deleteAllLogs(): Promise<number> {
    const response = await fetch(
        `/api/admin/system/logs`,
        {
            method: 'DELETE'
        }
    );

    if (!response.ok) {
        throw new Error(`Failed to delete logs: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
        throw new Error('Failed to delete logs');
    }

    return data.deletedCount;
}

/**
 * Reads the signed-in operator's saved log viewer severity levels.
 *
 * The preference lives in the per-user settings store so it follows the
 * operator across browsers. The self-service endpoint returns every
 * registered setting, so this picks out the log viewer's entry. A visitor
 * without a Better Auth session gets a 401; that is reported as `null` rather
 * than an error, because it only means there is no saved preference to apply.
 *
 * @returns The saved levels, the registered default when none are saved, or `null` when there is no session or no entry
 * @throws Error if the request fails for any reason other than a missing session
 */
export async function getLogMonitorLevels(): Promise<LogLevel[] | null> {
    let levels: LogLevel[] | null = null;
    const response = await fetch('/api/user/settings');

    if (response.status !== 401) {
        if (!response.ok) {
            throw new Error(`Failed to fetch user settings: ${response.status}`);
        }

        const data = await response.json();
        const entry = (data.values as IUserSettingValue[] | undefined)?.find(
            value => value.namespace === LOG_MONITOR_LEVELS_SETTING.namespace
                && value.key === LOG_MONITOR_LEVELS_SETTING.key
        );
        if (entry && Array.isArray(entry.value)) {
            levels = entry.value as LogLevel[];
        }
    }

    return levels;
}

/**
 * Saves the signed-in operator's log viewer severity levels.
 *
 * Called each time the operator toggles a level, so the next visit to any
 * Logs tab opens with the same selection. The backend validates the list
 * against the known levels before storing it.
 *
 * @param levels - The levels the operator currently has selected; an empty list means every level
 * @throws Error if the request fails, including when there is no session
 */
export async function saveLogMonitorLevels(levels: LogLevel[]): Promise<void> {
    const response = await fetch('/api/user/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            namespace: LOG_MONITOR_LEVELS_SETTING.namespace,
            key: LOG_MONITOR_LEVELS_SETTING.key,
            value: levels
        })
    });

    if (!response.ok) {
        throw new Error(`Failed to save log viewer levels: ${response.status}`);
    }
}
