/**
 * @fileoverview Logs module barrel export.
 *
 * Provides log monitoring components, settings panel, API client functions,
 * and types for the admin logs dashboard.
 *
 * @module modules/logs
 */

// Components
export { SystemLogsMonitor } from './components/SystemLogsMonitor';
export { LogSettings } from './components/LogSettings';

// API client
export { getSystemLogs, getLogStats, deleteAllLogs } from './api';

// Types
export type { SystemLog, LogsResponse, LogStats } from './types';
export type { LogsQuery } from './api';
