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
export type { IAiAssistantService } from './IAiAssistantService.js';
export type { IAiQueryOptions } from './IAiQueryOptions.js';
export type { IAiQueryResult } from './IAiQueryResult.js';
export type { IModelInfo } from './IModelInfo.js';
