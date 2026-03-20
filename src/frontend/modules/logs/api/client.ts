/**
 * @fileoverview Logs API client functions.
 *
 * Provides typed API functions for fetching system logs, statistics,
 * and performing log management operations.
 *
 * @module modules/logs/api/client
 */

import { config as runtimeConfig } from '../../../lib/config';
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
 * @param token - Admin authentication token
 * @param query - Filter and pagination parameters
 * @returns Paginated logs response with metadata
 * @throws Error if the API request fails
 */
export async function getSystemLogs(token: string, query: LogsQuery = {}): Promise<LogsResponse> {
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
        `${runtimeConfig.apiBaseUrl}/admin/system/logs?${params.toString()}`,
        {
            headers: { 'X-Admin-Token': token }
        }
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
 * @param token - Admin authentication token
 * @returns Log statistics object
 * @throws Error if the API request fails
 */
export async function getLogStats(token: string): Promise<LogStats> {
    const response = await fetch(
        `${runtimeConfig.apiBaseUrl}/admin/system/logs/stats`,
        {
            headers: { 'X-Admin-Token': token }
        }
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
 * @param token - Admin authentication token
 * @returns Number of deleted log entries
 * @throws Error if the API request fails
 */
export async function deleteAllLogs(token: string): Promise<number> {
    const response = await fetch(
        `${runtimeConfig.apiBaseUrl}/admin/system/logs`,
        {
            method: 'DELETE',
            headers: { 'X-Admin-Token': token }
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
