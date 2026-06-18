/**
 * @file index.ts
 *
 * Barrel for AI tool interfaces shared across the TronRelic platform.
 *
 * These types describe the contract between an AI Assistant plugin and any
 * plugin that wants to expose tools to the model. They are platform-owned
 * so that tool-providing plugins do not have to depend on the AI Assistant
 * plugin's own types package to publish a tool.
 */

export type { IAiTool, IAiToolInputSchema } from './IAiTool.js';
export { AI_TOOL_NAME_PATTERN } from './IAiTool.js';
export type { IUntrustedToolResult } from './untrusted-content.js';
export { UNTRUSTED_CONTENT_NOTICE, UNTRUSTED_CONTENT_SYSTEM_CLAUSE, wrapUntrustedToolResult } from './untrusted-content.js';
export type { IAiToolCapability, AiToolSideEffect, AiToolSensitivity } from './IAiToolCapability.js';
export type { IToolPolicy, IToolPolicyDecision, ToolPolicyVerdict } from './IToolPolicy.js';
export type { IToolInvocationContext, IToolInvocationActor, IToolEndUserPrincipal, ToolTriggerPath } from './IToolInvocationContext.js';
export type { IToolInvocationResult, ToolInvocationStatus } from './IToolInvocationResult.js';
export type { IToolInvocationRecord } from './IToolInvocationRecord.js';
export type { IServerToolInvocation } from './IServerToolInvocation.js';
export type { IAiToolGovernor } from './IAiToolGovernor.js';
export type { IAiToolRegistry, IAiToolDeclaration, IAiToolInfo } from './IAiToolRegistry.js';
export type { ITrifectaStatus, TrifectaSeverity } from './ITrifectaStatus.js';
export type { IAiProviderInfo, IAiProviderRegistry } from './IAiProviderRegistry.js';
export type { IAiToolInvokeContext } from './IAiToolHookContext.js';
export type { IAiConversationMessage } from './IAiConversationMessage.js';
export type { IAiProvider } from './IAiProvider.js';
export type { IAiStreamChunk } from './IAiStreamChunk.js';
export type { IAiQueryRecord, AiQueryMode } from './IAiQueryRecord.js';
export type { IAiQueryOptions } from './IAiQueryOptions.js';
export type { IAiQueryResult } from './IAiQueryResult.js';
export type { IModelInfo } from './IModelInfo.js';
export type { ISavedPrompt } from './ISavedPrompt.js';
