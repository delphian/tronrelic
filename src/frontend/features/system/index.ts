/**
 * System Feature Module
 *
 * This module handles system monitoring and administration including:
 * - Blockchain sync monitoring
 * - Market health monitoring
 * - Scheduler status
 * - Configuration management
 */

// Components
// BlockchainMonitor replaced by the Pipeline tab in app/(core)/system/system/components/pipeline
export { MarketMonitor } from './components/MarketMonitor';
// SchedulerMonitor moved to modules/scheduler
// SystemLogsMonitor and LogSettings moved to modules/logs
export { SystemAuthGate } from './components/SystemNav/SystemAuthGate';

// Contexts
export { SystemAuthProvider, useSystemAuth } from './contexts/SystemAuthContext';
