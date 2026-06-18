/**
 * @file index.ts
 *
 * Public API of the AI tools module. The bootstrap imports the module class;
 * other backend code reaches the registry and governor through the service
 * registry (`'ai-tools'`, `'ai-tool-governor'`) rather than these exports.
 */

export { AiToolsModule, AI_TOOLS_SERVICE, AI_TOOL_GOVERNOR_SERVICE, AI_PROVIDERS_SERVICE, CURATION_SERVICE, AUDIT_PRUNE_JOB } from './AiToolsModule.js';
export { AiProviderRegistry } from './services/ai-provider-registry.js';
export { AiQueryHistoryService } from './services/ai-query-history.service.js';
export type { IAiQueryHistoryQuery, IAiQueryHistoryPage } from './services/ai-query-history.service.js';
export { CurationQueue } from './services/curation-queue.js';
export { CurationService, CURATIONS_CHANGED_EVENT } from './services/curation-service.js';
export type { IAiToolsModuleDependencies } from './AiToolsModule.js';
export { AiToolRegistry } from './services/ai-tool-registry.js';
export { AiToolGovernor } from './services/ai-tool-governor.js';
export { ToolPolicyEngine } from './services/tool-policy-engine.js';
export { ToolAuditStore } from './services/tool-audit-store.js';
export type { IToolInvocationQuery, IToolInvocationPage } from './services/tool-audit-store.js';
export { ToolApprovalQueue } from './services/tool-approval-queue.js';
export type { IToolApprovalRequest, ToolApprovalStatus } from './services/tool-approval-queue.js';
export { detectTrifecta } from './services/trifecta-detector.js';
export { lintToolCapability } from './services/capability-linter.js';
export type { ICapabilityLintFinding, CapabilityLintSeverity } from './services/capability-linter.js';
