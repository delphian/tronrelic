/**
 * System Feature Module
 *
 * The admin authentication shell every /system route renders inside: the
 * provider holding the session's admin state and the gate that shows either
 * the not-admin screen or the page.
 */

// Components
// BlockchainMonitor replaced by the Pipeline tab in app/[lang]/(site)/(core)/system/system/components/pipeline
// SchedulerMonitor moved to modules/scheduler
// SystemLogsMonitor and LogSettings moved to modules/logs
export { SystemAuthGate } from './components/SystemNav/SystemAuthGate';

// Contexts
export { SystemAuthProvider, useSystemAuth } from './contexts/SystemAuthContext';
