/**
 * @file user-settings.ts
 *
 * Registers the log viewer's severity-filter preference on the identity
 * module's `'user-settings'` store, so the `SystemLogsMonitor` can remember
 * which levels an operator chose instead of resetting to errors on every
 * page load.
 *
 * The setting must be registered as a definition because the self-service
 * `/api/user/settings` endpoint the browser writes through only accepts
 * settings a provider has declared, and only after the declared validator
 * accepts the value. The identity module publishes `'user-settings'` after
 * this module initializes, so the registration uses the service-registry
 * watch pattern rather than a one-time lookup.
 */

import type {
    IServiceRegistry,
    ISystemLogService,
    IUserSettingsService,
    LogLevel,
    ServiceWatchDisposer
} from '@/types';
import { LOG_MONITOR_LEVELS_SETTING } from '@/types';

/** Severity levels the log viewer can filter on, and so the only values the setting may hold. */
const VALID_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

/**
 * Accept a candidate value for the preference only when it is a list of
 * distinct, known severity levels.
 *
 * The value arrives from an untrusted request body, so this guard is what
 * stops a signed-in user from storing arbitrary data under the logs
 * namespace. An empty list is allowed because the viewer treats no selected
 * levels as "show every level".
 *
 * @param value - The untrusted candidate from the self-service request.
 * @returns True when the value is safe to store.
 */
export function isValidMonitorLevels(value: unknown): boolean {
    let valid = false;
    if (Array.isArray(value) && value.length <= VALID_LEVELS.length) {
        const allKnown = value.every(level => VALID_LEVELS.includes(level as LogLevel));
        valid = allKnown && new Set(value).size === value.length;
    }
    return valid;
}

/**
 * Watch the service registry for `'user-settings'` and register the log
 * viewer's severity preference whenever the store becomes available.
 *
 * Registration is idempotent on the store's side, so re-registering after the
 * store reappears is safe. A failure is logged and swallowed, because a
 * missing display preference must never take the logs module down; the viewer
 * falls back to its default levels.
 *
 * @param serviceRegistry - Shared service registry to watch for the settings store.
 * @param logger - Module-scoped logger for registration telemetry.
 * @returns Disposer that removes the watch subscription.
 */
export function registerLogMonitorLevelsSetting(
    serviceRegistry: IServiceRegistry,
    logger: ISystemLogService
): ServiceWatchDisposer {
    return serviceRegistry.watch<IUserSettingsService>('user-settings', {
        onAvailable: (settings) => {
            try {
                settings.registerDefinition({
                    namespace: LOG_MONITOR_LEVELS_SETTING.namespace,
                    key: LOG_MONITOR_LEVELS_SETTING.key,
                    label: 'Log viewer severity levels',
                    description: 'Which severity levels the system log viewer shows, shared by /system/logs and every Logs tab.',
                    userWritable: true,
                    validate: isValidMonitorLevels,
                    defaultValue: [...LOG_MONITOR_LEVELS_SETTING.defaultValue]
                });
                logger.info(
                    { namespace: LOG_MONITOR_LEVELS_SETTING.namespace, key: LOG_MONITOR_LEVELS_SETTING.key },
                    'Registered log viewer severity preference with the user-settings store'
                );
            } catch (error) {
                logger.error({ error }, 'Failed to register log viewer severity preference with the user-settings store');
            }
        }
    });
}
