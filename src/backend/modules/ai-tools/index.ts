/**
 * @file index.ts
 *
 * Public API of the AI tools module. The bootstrap imports the module class;
 * other backend code reaches the registry and governor through the service
 * registry (`'ai-tools'`, `'ai-tool-governor'`) rather than these exports.
 */

export { AiToolsModule, AI_TOOLS_SERVICE, AI_TOOL_GOVERNOR_SERVICE, AI_PROVIDERS_SERVICE } from './AiToolsModule.js';
export { AiProviderRegistry } from './services/ai-provider-registry.js';
export type { IAiToolsModuleDependencies } from './AiToolsModule.js';
export { AiToolRegistry } from './services/ai-tool-registry.js';
export { AiToolGovernor } from './services/ai-tool-governor.js';
export { ToolPolicyEngine } from './services/tool-policy-engine.js';
export { ToolAuditStore } from './services/tool-audit-store.js';
export type { IToolInvocationQuery, IToolInvocationPage } from './services/tool-audit-store.js';
export { ToolApprovalQueue } from './services/tool-approval-queue.js';
export type { IToolApprovalRequest, ToolApprovalStatus } from './services/tool-approval-queue.js';
export { detectTrifecta } from './services/trifecta-detector.js';
