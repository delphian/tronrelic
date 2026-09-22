/**
 * @fileoverview Address and default of the operator's log-viewer severity preference.
 *
 * The backend logs module registers this setting on the `'user-settings'`
 * store, and the frontend `SystemLogsMonitor` reads and writes it through
 * `/api/user/settings`. Both sides import the address from here so the
 * namespace and key cannot drift apart between the two.
 */

import type { LogLevel } from './ISystemLogService.js';

/**
 * The per-user setting that remembers which severity levels the log viewer
 * shows.
 *
 * One value is shared by `/system/logs` and every module or plugin Logs tab,
 * so an operator who widens the filter once sees the same levels everywhere.
 * `defaultValue` is what an operator who has never changed the filter sees.
 */
export const LOG_MONITOR_LEVELS_SETTING: {
    readonly namespace: string;
    readonly key: string;
    readonly defaultValue: readonly LogLevel[];
} = {
    namespace: 'logs',
    key: 'monitorLevels',
    defaultValue: ['error']
};
