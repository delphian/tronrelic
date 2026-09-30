/**
 * @file IMcpStatus.ts
 *
 * The summary the `/system/mcp` overview renders beside the kill switch.
 */

import type { IMcpSettings } from './IMcpSettings.js';

/**
 * A snapshot of the MCP endpoint's configuration, so an operator can see at a
 * glance whether it is live and what it exposes.
 */
export interface IMcpStatus {
    /** Current runtime settings, including the kill switch. */
    settings: IMcpSettings;

    /** The public URL clients connect to, and the audience every access token must carry. */
    resourceUrl: string;

    /** The OAuth issuer that signs access tokens for this endpoint. */
    issuer: string;

    /** Id of the user group whose members may connect. */
    groupId: string;

    /** Number of accounts in that group. */
    memberCount: number;

    /** Number of tools members can currently call. */
    servedToolCount: number;

    /** Number of approved tools whose capability changed since approval. */
    staleToolCount: number;
}
