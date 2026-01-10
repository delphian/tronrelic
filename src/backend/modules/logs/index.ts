/**
 * Logs module exports.
 *
 * Provides:
 * - LogsModule: Core module implementation with IModule interface
 * - SystemLogService: Singleton logging service with MongoDB persistence
 * - createSystemLogRouter: Express router factory for log management endpoints
 * - Database models and types: SystemLog, ISystemLogDocument
 * - Controller: SystemLogController
 */

// Primary module export (implements IModule)
export { LogsModule } from './LogsModule.js';
export type { ILogsModuleDependencies } from './LogsModule.js';

// Services (for external consumers if needed)
export { SystemLogService } from './services/system-log.service.js';

// HTTP layer (for system router integration)
export { createSystemLogRouter } from './api/system-log.router.js';
export { SystemLogController } from './api/system-log.controller.js';

// Database types (for external consumers)
export type { ISystemLogDocument } from './database/index.js';
export { SystemLog } from './database/index.js';
