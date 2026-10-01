/**
 * @file index.ts
 *
 * Barrel for the MCP endpoint's shared types: its admin view models, the
 * token-verification contract the identity module fulfils, and the connected
 * app records shown to users and admins.
 */

export type { IMcpSettings } from './IMcpSettings.js';
export type { IMcpStatus } from './IMcpStatus.js';
export type { IMcpToolExposure } from './IMcpToolExposure.js';
export type { IMcpToolGrant } from './IMcpToolGrant.js';
export type { IMcpGroup } from './IMcpGroup.js';
export type { IMcpGroupPolicy } from './IMcpGroupPolicy.js';
export type { IMcpGroupPolicyPatch } from './IMcpGroupPolicyPatch.js';
export type { IMcpAccessTokenClaims } from './IMcpAccessTokenClaims.js';
export type { IMcpAccessTokenVerifier } from './IMcpAccessTokenVerifier.js';
export { MCP_TOOLS_SCOPE } from './MCP_TOOLS_SCOPE.js';
export { MCP_OAUTH_SCOPES } from './MCP_OAUTH_SCOPES.js';
export { MCP_USERS_GROUP_ID } from './MCP_USERS_GROUP_ID.js';
export { mcpGroupMayHoldTool } from './mcpGroupMayHoldTool.js';
export { normaliseIpAllowlistEntries } from './normaliseIpAllowlistEntries.js';
