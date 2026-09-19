/**
 * Published props for the system log viewer exposed to plugins on
 * `context.system`.
 *
 * The viewer began as the `/system/logs` console page, showing every service's
 * logs. Publishing it lets a plugin embed a Logs tab scoped to its own entries,
 * so an operator diagnosing the plugin reads its errors in place instead of
 * leaving for `/system/logs` and filtering the whole deployment's log stream.
 *
 * The implementation extends this interface, so the published subset stays a
 * real subset of what the component accepts rather than a copy that drifts.
 */

/**
 * Props accepted by the system log viewer.
 */
export interface ISystemLogsMonitorProps {
    /**
     * Restricts the viewer to log entries whose `service` equals this value,
     * for example `plugin:my-plugin`. A plugin's injected logger records its
     * entries under `plugin:<manifest id>`, so that is the value a plugin
     * passes. Filtering and the level counts both happen server-side, so a
     * scoped viewer never receives another service's entries.
     *
     * When set, the service selector is hidden and the "Clear All Logs"
     * action is removed, because that action deletes every service's logs
     * rather than only the scoped ones. Omit for the whole-deployment view
     * the system console uses.
     */
    service?: string;

    /**
     * Heading shown above the viewer. Omitted by default, because the
     * embedding page usually supplies its own.
     */
    title?: string;
}
