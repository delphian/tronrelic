/**
 * @fileoverview Logs API client functions.
 *
 * Provides typed API functions for fetching system logs, statistics,
 * and performing log management operations.
 *
 * @module modules/logs/api/client
 */

import type { LogLevel } from '@/types';
import type { LogsResponse, LogStats } from '../types';

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
 * @returns Log statistics object
 * @throws Error if the API request fails
 */
export async function getLogStats(): Promise<LogStats> {
    const response = await fetch(
        `/api/admin/system/logs/stats`
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
