/**
 * @fileoverview Public API of the MCP module.
 */

export { McpModule } from './McpModule.js';
export type { IMcpModuleDependencies, IMcpEndpointConfig } from './McpModule.js';
export { MCP_SETTINGS_COLLECTION } from './services/mcp-settings.store.js';
export { MCP_TOOL_APPROVALS_COLLECTION } from './services/mcp-tool-exposure.service.js';
export { MCP_GROUP_POLICIES_COLLECTION } from './services/McpGroupPolicyService.js';
export { MCP_AI_PROVIDER_ID } from './services/mcp-server.factory.js';
