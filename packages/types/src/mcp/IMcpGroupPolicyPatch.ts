/**
 * @file IMcpGroupPolicyPatch.ts
 *
 * The change an admin asks for when editing one user group's MCP settings on
 * `/system/mcp`.
 */

import type { IMcpGroupPolicy } from './IMcpGroupPolicy.js';

/**
 * The group settings an admin may change in one `PUT /groups/:groupId/policy`
 * request. Every field is optional, and an omitted field keeps its stored
 * value. The admin page sends it and the backend reads it, so both sides share
 * this one shape rather than each declaring its own copy.
 */
export type IMcpGroupPolicyPatch = Partial<Pick<IMcpGroupPolicy, 'allowRestrictedTools' | 'scrubSecrets' | 'ipAllowlistEnabled' | 'ipAllowlist'>>;
