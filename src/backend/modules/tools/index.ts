/**
 * @fileoverview Tools module entry point.
 *
 * Exports the ToolsModule class implementing IModule for two-phase initialization
 * with dependency injection. Also exports services and controller for external
 * consumers and testing.
 */

// Primary module export
export { ToolsModule } from './ToolsModule.js';
export type { IToolsModuleDependencies } from './ToolsModule.js';

// Services (for external consumers or testing)
export { AddressService } from './services/address.service.js';
export { CalculatorService } from './services/calculator.service.js';
export { ApprovalService } from './services/approval.service.js';
export { TimestampService } from './services/timestamp.service.js';
export type { IAddressConversionResult } from './services/address.service.js';
export type { IEnergyEstimate, IStakeEstimate, IEnergyEstimateInput } from './services/calculator.service.js';
export type { IApprovalEntry, IApprovalCheckResult } from './services/approval.service.js';
export type { ITimestampConversionResult, ITimestampConvertInput } from './services/timestamp.service.js';

// HTTP layer (for testing or custom router configurations)
export { ToolsController } from './api/tools.controller.js';
export { createToolsRouter } from './api/tools.router.js';
