/**
 * @fileoverview Logs module type definitions.
 *
 * Defines interfaces for system log entries, statistics, and API responses
 * returned by the admin log management endpoints.
 *
 * @module modules/logs/types
 */

import type { LogLevel } from '@/types';

/**
 * System log entry from the backend.
 *
 * Represents a single persisted log record with severity, service context,
 * structured metadata, and resolution tracking.
 */
export interface SystemLog {
    /** MongoDB document ID */
    _id: string;
    /** ISO 8601 timestamp when the log was created */
    timestamp: string;
    /** Log severity level */
    level: LogLevel;
    /** Human-readable log message */
    message: string;
    /** Service or plugin that generated the log (e.g., 'tronrelic', 'plugin:whale-alerts') */
    service: string;
    /** Structured metadata associated with the log entry */
    context: Record<string, any>;
    /** Whether the log has been acknowledged by an admin */
    resolved: boolean;
    /** ISO 8601 timestamp when resolved, undefined if unresolved */
    resolvedAt?: string;
    /** Identifier of the admin who resolved the log */
    resolvedBy?: string;
}

/**
 * Paginated logs API response.
 *
 * Returned by GET /api/admin/system/logs with pagination metadata
 * for navigating large log collections.
 */
export interface LogsResponse {
    /** Whether the API request succeeded */
    success: boolean;
    /** Array of log entries for the current page */
    logs: SystemLog[];
    /** Total number of logs matching the current filters */
    total: number;
    /** Current page number (1-based) */
    page: number;
    /** Maximum entries per page */
    limit: number;
    /** Total number of pages available */
    totalPages: number;
    /** Whether there are more pages after the current page */
    hasNextPage: boolean;
    /** Whether there are pages before the current page */
    hasPrevPage: boolean;
}

/**
 * Log statistics returned by the stats endpoint.
 *
 * Provides aggregate counts by severity level and service for
 * dashboard metrics and the service filter dropdown.
 */
export interface LogStats {
    /** Total number of log entries in the database */
    total: number;
    /** Count of log entries per severity level */
    byLevel: Record<LogLevel, number>;
    /** Count of log entries per service identifier */
    byService: Record<string, number>;
    /** Number of unresolved log entries */
    unresolved: number;
}
