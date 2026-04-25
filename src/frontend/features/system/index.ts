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
// BlockchainMonitor folded into app/(core)/system/system/components/BlockchainSection
export { MarketMonitor } from './components/MarketMonitor';
// SchedulerMonitor moved to modules/scheduler
// SystemLogsMonitor and LogSettings moved to modules/logs
export { SystemAuthGate } from './components/SystemNav/SystemAuthGate';
export { LogoutNavItem } from './components/SystemNav/LogoutNavItem';

// Contexts
export { SystemAuthProvider, useSystemAuth } from './contexts/SystemAuthContext';
