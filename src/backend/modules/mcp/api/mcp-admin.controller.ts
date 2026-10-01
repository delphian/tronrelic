/**
 * @fileoverview Admin API behind `/system/mcp`.
 *
 * Serves the overview (status and kill switch), the user groups with their
 * MCP settings, the tool list with each tool's per-group grants, and the list
 * of connected apps across all users. Changes that widen access — switching
 * the endpoint on, granting a tool, relaxing a group's protections — require a
 * signed-in admin, so every such change has a named person behind it. Changes
 * that narrow access — switching the endpoint off, withdrawing a grant,
 * tightening a group's protections, revoking an app — also accept the
 * `ADMIN_API_TOKEN` service path, so an operator can shut things down from a
 * script during an incident.
 */

import type { Request, Response } from 'express';
import type { IConnectedAppsService, IMcpGroupPolicyPatch, IMcpStatus, ISystemLogService, IUserGroupService } from '@/types';
import { MCP_USERS_GROUP_ID } from '@/types';
import { isAdminUserRequest } from '../../../api/middleware/admin-auth.js';
import type { McpSettingsStore } from '../services/mcp-settings.store.js';
import { McpToolExposureError, type McpToolExposureService } from '../services/mcp-tool-exposure.service.js';
import { McpGroupPolicyError, isWideningPolicyChange, type McpGroupPolicyService } from '../services/McpGroupPolicyService.js';

/** Largest page of connected apps one request may ask for. */
const MAX_APPS_PAGE = 200;

/**
 * Handlers for the MCP admin router. Each handler is an arrow property so the
 * router can mount it without binding.
 */
export class McpAdminController {
    /**
     * @param settings - The kill switch store.
     * @param exposure - The tool exposure service.
     * @param policies - The per-group MCP settings.
     * @param connectedApps - The identity module's grant store, for listing and
     *   revoking connected apps.
     * @param userGroups - Group service, used to count MCP group members.
     * @param endpoint - The public resource URL and token issuer, shown on the overview.
     * @param logger - Module logger.
     */
    constructor(
        private readonly settings: McpSettingsStore,
        private readonly exposure: McpToolExposureService,
        private readonly policies: McpGroupPolicyService,
        private readonly connectedApps: IConnectedAppsService,
        private readonly userGroups: IUserGroupService,
        private readonly endpoint: { resourceUrl: string; issuer: string },
        private readonly logger: ISystemLogService
    ) {}

    /**
     * `GET /status` — the overview card: kill switch state, URLs, member and
     * tool counts.
     *
     * @param _req - Unused.
     * @param res - Answers with an `IMcpStatus`.
     */
    getStatus = async (_req: Request, res: Response): Promise<void> => {
        res.json({ status: await this.buildStatus() });
    };

    /**
     * `PUT /settings` — flip the kill switch. Body: `{ enabled: boolean }`.
     *
     * Switching on is refused on the service-token path because it opens the
     * endpoint to users; switching off is always accepted.
     *
     * @param req - Carries the new state and the admin identity.
     * @param res - Answers with the stored settings, 400 for a bad body, or 403.
     */
    setSettings = async (req: Request, res: Response): Promise<void> => {
        const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
        if (typeof enabled !== 'boolean') {
            res.status(400).json({ success: false, error: 'Body must be { "enabled": true | false }.' });
        } else if (enabled && !isAdminUserRequest(req)) {
            res.status(403).json({ success: false, error: 'Switching the MCP endpoint on requires a signed-in admin account.' });
        } else {
            const settings = await this.settings.setEnabled(enabled, req.userId);
            res.json({ settings });
        }
    };

    /**
     * `GET /tools` — every registered tool with its MCP state.
     *
     * @param _req - Unused.
     * @param res - Answers with `{ tools: IMcpToolExposure[] }`.
     */
    listTools = async (_req: Request, res: Response): Promise<void> => {
        res.json({ tools: await this.exposure.listExposures() });
    };

    /**
     * `PUT /tools/:name` — approve or withdraw one tool for one group.
     * Body: `{ exposed: boolean, groupId?: string }`. `groupId` defaults to
     * `mcp-users`, which is what every approval meant before grants were per group.
     *
     * @param req - Carries the tool name, the group, the new state, and the admin identity.
     * @param res - Answers with the updated row, or 400 / 403 / 404. Withdrawing
     *   a tool that is no longer registered answers `{ tool: null }`, because
     *   its stale approval is removed but it has no row to return.
     */
    setToolExposure = async (req: Request, res: Response): Promise<void> => {
        const body = req.body as { exposed?: unknown; groupId?: unknown } | undefined;
        const exposed = body?.exposed;
        const groupId = body?.groupId === undefined ? MCP_USERS_GROUP_ID : body.groupId;
        if (typeof exposed !== 'boolean' || typeof groupId !== 'string' || groupId.length === 0) {
            res.status(400).json({ success: false, error: 'Body must be { "exposed": true | false, "groupId"?: string }.' });
        } else if (exposed && !isAdminUserRequest(req)) {
            res.status(403).json({ success: false, error: 'Exposing a tool over MCP requires a signed-in admin account.' });
        } else {
            try {
                const tool = await this.exposure.setExposure(req.params.name, groupId, exposed, req.userId);
                res.json({ tool });
            } catch (error: unknown) {
                if (error instanceof McpToolExposureError) {
                    res.status(error.status).json({ success: false, error: error.message });
                } else {
                    throw error;
                }
            }
        }
    };

    /**
     * `GET /groups` — every user group with its MCP settings, `mcp-users` first.
     *
     * @param _req - Unused.
     * @param res - Answers with `{ groups: IMcpGroup[] }`.
     */
    listGroups = async (_req: Request, res: Response): Promise<void> => {
        res.json({ groups: await this.policies.listGroups() });
    };

    /**
     * `PUT /groups/:groupId/policy` — change a group's MCP settings.
     * Body: any of `{ allowRestrictedTools, scrubSecrets, ipAllowlistEnabled,
     * ipAllowlist }`; omitted fields keep their stored value.
     *
     * A change that widens access is refused on the service-token path, the
     * same rule the kill switch and tool grants follow. Switching "allow
     * restricted tools" off also withdraws every restricted tool the group
     * holds, and the response says how many.
     *
     * @param req - Carries the group id, the changes, and the admin identity.
     * @param res - Answers with `{ policy, withdrawnRestrictedGrants }`, or 400 / 403 / 404.
     */
    setGroupPolicy = async (req: Request, res: Response): Promise<void> => {
        const patch = parsePolicyPatch(req.body);
        if (typeof patch === 'string') {
            res.status(400).json({ success: false, error: patch });
        } else {
            try {
                const { previous, next } = await this.policies.preview(req.params.groupId, patch);
                if (isWideningPolicyChange(previous, next) && !isAdminUserRequest(req)) {
                    res.status(403).json({ success: false, error: 'Relaxing a group\'s MCP protections requires a signed-in admin account.' });
                } else {
                    const policy = await this.policies.save(next, req.userId, previous);
                    const withdrawnRestrictedGrants = previous.allowRestrictedTools && !next.allowRestrictedTools
                        ? await this.exposure.withdrawRestrictedGrants(next.groupId, req.userId)
                        : 0;
                    res.json({ policy, withdrawnRestrictedGrants });
                }
            } catch (error: unknown) {
                if (error instanceof McpGroupPolicyError) {
                    res.status(error.status).json({ success: false, error: error.message });
                } else {
                    throw error;
                }
            }
        }
    };

    /**
     * `GET /apps` — connected apps across all users, newest first.
     * Query: `limit` (1–200, default 50), `offset`.
     *
     * @param req - Carries the paging parameters.
     * @param res - Answers with `{ apps, total }`.
     */
    listApps = async (req: Request, res: Response): Promise<void> => {
        const limit = clampInt(req.query.limit, 50, 1, MAX_APPS_PAGE);
        const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
        res.json(await this.connectedApps.listAll({ limit, offset }));
    };

    /**
     * `DELETE /apps/:userId?clientId=...` — revoke one user's grant to one app.
     * The client id travels in the query string because it is often a URL.
     * The app's refresh tokens stop working at once, and the endpoint refuses
     * its access tokens on the next request.
     *
     * @param req - Carries the user id, the client id, and the admin identity.
     * @param res - Answers 204 when revoked, 400 without a client id, or 404.
     */
    revokeApp = async (req: Request, res: Response): Promise<void> => {
        const userId = req.params.userId;
        const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : '';
        if (!clientId) {
            res.status(400).json({ success: false, error: 'clientId is required.' });
        } else if (await this.connectedApps.revoke(userId, clientId)) {
            this.logger.warn({ userId, clientId, actor: req.userId ?? 'service-token' }, 'MCP connected app revoked by admin');
            res.status(204).end();
        } else {
            res.status(404).json({ success: false, error: 'No such connected app for that user.' });
        }
    };

    /**
     * Assemble the overview snapshot.
     *
     * @returns The current status.
     */
    private async buildStatus(): Promise<IMcpStatus> {
        const [settings, tools, members] = await Promise.all([
            this.settings.get(),
            this.exposure.listExposures(),
            this.userGroups.getMembers(MCP_USERS_GROUP_ID, { limit: 1 })
        ]);
        return {
            settings,
            resourceUrl: this.endpoint.resourceUrl,
            issuer: this.endpoint.issuer,
            groupId: MCP_USERS_GROUP_ID,
            memberCount: members.total,
            servedToolCount: tools.filter(tool => tool.served).length,
            staleToolCount: tools.filter(tool => tool.stale).length
        };
    }
}

/**
 * Read a group policy change from a request body, checking each field's type.
 *
 * Only the shape is checked here. Whether the values make sense together, such
 * as an allowlist being switched on while empty, is the policy service's call.
 *
 * @param body - The parsed JSON body.
 * @returns The change, or a sentence naming the first malformed field.
 */
function parsePolicyPatch(body: unknown): IMcpGroupPolicyPatch | string {
    let result: IMcpGroupPolicyPatch | string;
    const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const flags = ['allowRestrictedTools', 'scrubSecrets', 'ipAllowlistEnabled'] as const;
    const badFlag = flags.find(flag => raw[flag] !== undefined && typeof raw[flag] !== 'boolean');
    const list = raw.ipAllowlist;
    if (badFlag) {
        result = `"${badFlag}" must be true or false.`;
    } else if (list !== undefined && !(Array.isArray(list) && list.every(entry => typeof entry === 'string'))) {
        result = '"ipAllowlist" must be an array of strings.';
    } else {
        const patch: IMcpGroupPolicyPatch = {};
        for (const flag of flags) {
            if (typeof raw[flag] === 'boolean') {
                patch[flag] = raw[flag] as boolean;
            }
        }
        if (Array.isArray(list)) {
            patch.ipAllowlist = list as string[];
        }
        result = patch;
    }
    return result;
}

/**
 * Parse an integer query parameter and clamp it into a range.
 *
 * @param raw - The raw query value.
 * @param fallback - Value used when the parameter is missing or not a number.
 * @param min - Smallest allowed value.
 * @param max - Largest allowed value.
 * @returns The clamped integer.
 */
function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
    const value = Number.isFinite(parsed) ? parsed : fallback;
    return Math.min(max, Math.max(min, value));
}
