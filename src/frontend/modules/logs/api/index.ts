/**
 * @fileoverview Logs API barrel export.
 * @module modules/logs/api
 */

export { getSystemLogs, getLogStats, deleteAllLogs, getLogMonitorLevels, saveLogMonitorLevels } from './client';
export type { LogsQuery } from './client';
