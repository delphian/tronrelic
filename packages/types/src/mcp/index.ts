/**
 * @file index.ts
 *
 * Barrel for the MCP endpoint's shared types: its admin view models, the
 * token-verification contract the identity module fulfils, the app admission
 * contract the MCP module fulfils for the identity module's OAuth server, and
 * the connected app records shown to users and admins.
 */

export type { IMcpSettings } from './IMcpSettings.js';
export type { IMcpStatus } from './IMcpStatus.js';
export type { IMcpToolExposure } from './IMcpToolExposure.js';
export type { IMcpToolGrant } from './IMcpToolGrant.js';
export type { IMcpGroup } from './IMcpGroup.js';
export type { IMcpGroupPolicy } from './IMcpGroupPolicy.js';
export type { IMcpGroupPolicyPatch } from './IMcpGroupPolicyPatch.js';
export type { IMcpGroupLimits } from './IMcpGroupLimits.js';
export type { McpPrincipalKind } from './McpPrincipalKind.js';
export type { McpEndpointKind } from './McpEndpointKind.js';
export type { McpUsageWindow } from './McpUsageWindow.js';
export type { IMcpUsageFigures } from './IMcpUsageFigures.js';
export type { IMcpUsageGroupRow } from './IMcpUsageGroupRow.js';
export type { IMcpUsageToolRow } from './IMcpUsageToolRow.js';
export type { IMcpUsageCallerRow } from './IMcpUsageCallerRow.js';
export type { IMcpUsageReport } from './IMcpUsageReport.js';
export type { IMcpUsageGroupDetail } from './IMcpUsageGroupDetail.js';
export type { IMcpAccessTokenClaims } from './IMcpAccessTokenClaims.js';
export type { IMcpAccessTokenVerifier } from './IMcpAccessTokenVerifier.js';
export type { IMcpClientDetails } from './IMcpClientDetails.js';
export type { IMcpClientAdmissionPolicy } from './IMcpClientAdmissionPolicy.js';
export { MCP_TOOLS_SCOPE } from './MCP_TOOLS_SCOPE.js';
export { MCP_OAUTH_SCOPES } from './MCP_OAUTH_SCOPES.js';
export { MCP_USERS_GROUP_ID } from './MCP_USERS_GROUP_ID.js';
export { MCP_ANONYMOUS_GROUP_ID } from './MCP_ANONYMOUS_GROUP_ID.js';
export { mcpGroupMayHoldTool } from './mcpGroupMayHoldTool.js';
export { normaliseIpAllowlistEntries } from './normaliseIpAllowlistEntries.js';
