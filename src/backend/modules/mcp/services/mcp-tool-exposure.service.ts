/**
 * @fileoverview Which AI tools each user group's MCP members may see and call.
 *
 * Every registered tool starts hidden from MCP. An admin approves a tool for
 * one user group at a time on `/system/mcp`, and each approval (a grant) is
 * stored with a fingerprint of the tool's capability at that moment. A member
 * of `mcp-users` is served a tool when at least one of their groups holds a
 * grant for it that passes every check:
 *
 * - the tool is switched on in the AI tool registry,
 * - its capability still matches the fingerprint recorded at approval,
 * - it passes the MCP safety floor (`getMcpToolIneligibility`), or the group's
 *   policy allows restricted tools and the group is not `mcp-users`,
 * - the request comes from an address the group's IP allowlist admits, when
 *   the group has one switched on.
 *
 * The governor re-applies the floor and the allowlist on every call, so this
 * service decides what is offered while the governor decides what may run.
 */

import type { IAiTool, IAiToolRegistry, IDatabaseService, IMcpToolExposure, IMcpToolGrant, ISystemLogService, IUserGroupService } from '@/types';
import { MCP_USERS_GROUP_ID, getMcpToolIneligibility, mcpGroupMayHoldTool } from '@/types';
import { capabilityFingerprint } from './capabilityFingerprint.js';
import type { McpGroupPolicyService } from './McpGroupPolicyService.js';

/** Collection holding one approval document per approved tool and group. */
export const MCP_TOOL_APPROVALS_COLLECTION = 'module_mcp_tool_approvals';

/**
 * How long the served tool list may reuse the approvals it last read. The
 * endpoint computes that list on every request, including `initialize` and
 * `tools/list`, so without a cache each request is a database read. A change
 * made through this instance clears the copy at once; a change made on another
 * instance reaches this one within the window, the same as the kill switch.
 */
const APPROVALS_CACHE_TTL_MS = 5_000;

/** Stored shape of an approval. */
interface IMcpToolApprovalDocument {
    toolName: string;
    groupId: string;
    fingerprint: string;
    /**
     * Whether the tool failed the MCP safety floor when it was granted. Kept on
     * the grant so a restricted grant can still be withdrawn after its tool is
     * unregistered, when the registry can no longer say what it declared.
     * Absent on grants written before this field existed, which were all
     * eligible, because restricted grants did not exist yet.
     */
    restricted?: boolean;
    approvedAt: Date;
    approvedBy?: string;
}

/**
 * Who is asking for the served tool list: the caller's groups and address.
 */
export interface IMcpToolAudience {
    /** Every group the verified caller belongs to. */
    groups: readonly string[];

    /** The request address, checked against each group's IP allowlist. */
    ip?: string;
}

/**
 * One tool served to one caller, with what the endpoint must do when it runs.
 */
export interface IMcpServedTool {
    /** The tool itself. */
    tool: IAiTool;

    /**
     * True when the tool fails the MCP safety floor and is served only because
     * a group the caller belongs to allows restricted tools. The endpoint
     * passes these names to the governor, which otherwise refuses them.
     */
    restricted: boolean;

    /** True when a group that serves this tool to the caller asks for its results to be scrubbed. */
    scrubSecrets: boolean;
}

/** Error thrown when an admin asks for a grant that cannot be made. */
export class McpToolExposureError extends Error {
    /**
     * @param message - Sentence explaining the refusal, returned to the admin.
     * @param status - HTTP status the controller should answer with.
     */
    constructor(message: string, readonly status: 400 | 404 | 409) {
        super(message);
        this.name = 'McpToolExposureError';
    }
}

/**
 * Decide whether a write failed because a unique index refused it.
 *
 * Until the module's migration `001_tool_approvals_group_id` runs, the old
 * unique index on `toolName` alone is still in place, and it refuses a second
 * group's grant for any tool as well as a fresh grant for a tool approved
 * before grants were per group. Recognising that case lets the admin see what
 * to do instead of a generic server error.
 *
 * @param error - What the database write threw.
 * @returns True when the error is MongoDB's duplicate-key error (code 11000).
 */
function isDuplicateKeyError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

/**
 * Tracks admin approvals per group and computes the tools served to a caller.
 */
export class McpToolExposureService {
    /** The approvals last read from the database, grouped by tool name, and when they were read. */
    private approvalsCache: { approvals: Map<string, IMcpToolApprovalDocument[]>; readAt: number } | null = null;

    /**
     * Counts approval changes made through this instance. A read that was
     * already in flight when an admin withdrew a tool may return the old
     * approvals, and caching that result would keep serving the withdrawn tool
     * for another cache window. `loadApprovals` compares this counter before
     * and after its read and skips the cache write when it moved.
     */
    private approvalsGeneration = 0;

    /**
     * Capability fingerprints keyed by the capability object. A tool's
     * capability object does not change while it stays registered, and the
     * served list is computed on every MCP request, so this keeps the SHA-256
     * work to once per registration. A WeakMap lets an unregistered tool's
     * entry be collected.
     */
    private readonly fingerprints = new WeakMap<object, string>();

    /**
     * @param database - Core database service, used for the approvals collection.
     * @param toolRegistry - The AI tool registry, the source of truth for which
     *   tools exist, whether they are enabled, and what they declare.
     * @param policies - Per-group settings: restricted tools, scrubbing, IP allowlist.
     * @param userGroups - Group service, used to refuse a grant to a group that
     *   does not exist and to tell which grants belong to deleted groups.
     * @param logger - Module logger, used to record approvals and withdrawals.
     */
    constructor(
        private readonly database: IDatabaseService,
        private readonly toolRegistry: IAiToolRegistry,
        private readonly policies: McpGroupPolicyService,
        private readonly userGroups: Pick<IUserGroupService, 'getGroup' | 'listGroups'>,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Create the unique index on tool name and group. Called once from module init.
     *
     * @returns Resolves when the index exists.
     */
    async createIndexes(): Promise<void> {
        await this.database.createIndex(MCP_TOOL_APPROVALS_COLLECTION, { toolName: 1, groupId: 1 }, { unique: true });
    }

    /**
     * List every registered tool with its grants, for the admin page.
     *
     * Rows are grouped by the module or plugin that registered them, so an
     * admin reviewing one owner's tools finds them together rather than
     * scattered through an alphabetical list.
     *
     * @returns One row per registered tool, sorted by owner and then by name.
     */
    async listExposures(): Promise<IMcpToolExposure[]> {
        // The admin page always reads fresh, so it never shows another
        // instance's change late.
        const [approvals, policies, groups] = await Promise.all([
            this.loadApprovals(0),
            this.policies.getPolicies(0),
            this.userGroups.listGroups()
        ]);
        // A grant left on a deleted group reaches no one, so it must not count
        // as served on this page or in the overview's "Tools served" figure.
        const groupIds = new Set(groups.map(group => group.id));
        const rows = this.toolRegistry.listToolInfo().map(info => {
            const restrictedReason = getMcpToolIneligibility(info.capability);
            const fingerprint = this.fingerprintOf(info.capability);
            const grants: IMcpToolGrant[] = (approvals.get(info.name) ?? [])
                .map(doc => {
                    const stale = doc.fingerprint !== fingerprint;
                    const usable = groupIds.has(doc.groupId)
                        && mcpGroupMayHoldTool(restrictedReason !== null, this.policies.policyFor(policies, doc.groupId));
                    const grant: IMcpToolGrant = {
                        groupId: doc.groupId,
                        approvedAt: new Date(doc.approvedAt).toISOString(),
                        stale,
                        served: !stale && usable && info.enabled
                    };
                    if (doc.approvedBy) {
                        grant.approvedBy = doc.approvedBy;
                    }
                    return grant;
                })
                .sort((a, b) => a.groupId.localeCompare(b.groupId));
            const row: IMcpToolExposure = {
                name: info.name,
                description: info.description,
                provider: info.provider,
                enabledInRegistry: info.enabled,
                capability: info.capability,
                restrictedReason,
                grants,
                served: grants.some(grant => grant.served),
                stale: grants.some(grant => grant.stale)
            };
            return row;
        });
        return rows.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
    }

    /**
     * Return the tools one caller can use right now, in a stable order so
     * clients can cache the list.
     *
     * A tool is served when any of the caller's groups holds a grant that
     * passes every check. Scrubbing applies when any of those passing grants
     * comes from a group that asks for it, so adding a group never loosens
     * what another group required.
     *
     * @param audience - The caller's groups and request address.
     * @returns The served tools, sorted by name.
     */
    async getServedTools(audience: IMcpToolAudience): Promise<IMcpServedTool[]> {
        const [approvals, policies] = await Promise.all([this.loadApprovals(APPROVALS_CACHE_TTL_MS), this.policies.getPolicies()]);
        const served: IMcpServedTool[] = [];
        for (const tool of this.toolRegistry.getEnabledTools()) {
            // Most registered tools have no grant at all. Checking for one
            // first skips the floor check and the fingerprint lookup for them
            // on every MCP request.
            const docs = (approvals.get(tool.name) ?? []).filter(doc => audience.groups.includes(doc.groupId));
            if (docs.length > 0) {
                const restricted = getMcpToolIneligibility(tool.capability) !== null;
                const fingerprint = this.fingerprintOf(tool.capability);
                const routes = docs
                    .filter(doc => doc.fingerprint === fingerprint)
                    .map(doc => this.policies.policyFor(policies, doc.groupId))
                    .filter(policy => mcpGroupMayHoldTool(restricted, policy) && this.policies.allowsAddress(policy, audience.ip));
                if (routes.length > 0) {
                    served.push({ tool, restricted, scrubSecrets: routes.some(policy => policy.scrubSecrets) });
                }
            }
        }
        return served.sort((a, b) => a.tool.name.localeCompare(b.tool.name));
    }

    /**
     * Approve a tool for one group, or withdraw that approval.
     *
     * Approving records the tool's current capability fingerprint, so
     * approving a stale grant again is how an admin accepts its changed
     * declaration. A restricted tool can be approved only for a group whose
     * policy allows restricted tools, and never for `mcp-users`.
     *
     * Withdrawing does not require the tool or the group to exist. A grant
     * left behind by an uninstalled plugin or a deleted group would otherwise
     * be impossible to remove, and it would start serving again the moment a
     * matching tool or group reappeared.
     *
     * @param toolName - Registered tool name.
     * @param groupId - The group the approval is for.
     * @param expose - True to approve, false to withdraw.
     * @param actor - Better Auth user id of the admin, for the record and the log.
     * @returns The tool's updated row, or null when a withdrawn tool is not
     *   registered and so has no row.
     * @throws {McpToolExposureError} 404 when approving for a tool or group
     *   that does not exist, 400 when the tool is restricted and the group may
     *   not hold restricted tools, 409 when the old one-grant-per-tool index
     *   refuses the grant because the module's migration has not run yet, or
     *   when "allow restricted tools" was switched off while a restricted
     *   grant was being written.
     */
    async setExposure(toolName: string, groupId: string, expose: boolean, actor: string | undefined): Promise<IMcpToolExposure | null> {
        const collection = this.database.getCollection<IMcpToolApprovalDocument>(MCP_TOOL_APPROVALS_COLLECTION);
        if (expose) {
            const tool = this.toolRegistry.getTool(toolName);
            if (!tool) {
                throw new McpToolExposureError(`Tool "${toolName}" is not registered.`, 404);
            }
            if (!(await this.userGroups.getGroup(groupId))) {
                throw new McpToolExposureError(`User group "${groupId}" does not exist.`, 404);
            }
            const restrictedReason = getMcpToolIneligibility(tool.capability);
            if (restrictedReason !== null) {
                if (groupId === MCP_USERS_GROUP_ID) {
                    throw new McpToolExposureError(`Tool "${toolName}" is restricted and can never be granted to every MCP user. ${restrictedReason}`, 400);
                } else if (!(await this.groupAllowsRestrictedNow(groupId))) {
                    throw new McpToolExposureError(`Tool "${toolName}" is restricted. Turn on "Allow restricted tools" for the ${groupId} group first. ${restrictedReason}`, 400);
                }
            }
            try {
                await collection.updateOne(
                    { toolName, groupId },
                    { $set: { toolName, groupId, fingerprint: capabilityFingerprint(tool.capability), restricted: restrictedReason !== null, approvedAt: new Date(), ...(actor ? { approvedBy: actor } : {}) } },
                    { upsert: true }
                );
            } catch (error: unknown) {
                if (isDuplicateKeyError(error)) {
                    throw new McpToolExposureError(
                        `Tool "${toolName}" cannot be granted until the migration module:mcp:001_tool_approvals_group_id has run. Run it from /system/database, then grant the tool again.`,
                        409
                    );
                }
                throw error;
            }
            // Check again after the write. Another admin may have switched off
            // "allow restricted tools" for the group between the check above
            // and the write, and that change's withdrawal may already have
            // run. Without this, the grant would stay behind unseen and start
            // serving again the next time the setting was switched on.
            if (restrictedReason !== null && !(await this.groupAllowsRestrictedNow(groupId))) {
                await collection.deleteOne({ toolName, groupId });
                this.invalidateApprovals();
                throw new McpToolExposureError(`"Allow restricted tools" was switched off for the ${groupId} group while "${toolName}" was being granted, so the grant was withdrawn.`, 409);
            }
        } else {
            await collection.deleteOne({ toolName, groupId });
        }
        this.invalidateApprovals();
        this.logger.warn(
            { tool: toolName, groupId, exposed: expose, actor: actor ?? 'unattributed' },
            `MCP tool ${expose ? 'exposed' : 'withdrawn'}: ${toolName} for ${groupId}`
        );
        const rows = await this.listExposures();
        return rows.find(row => row.name === toolName) ?? null;
    }

    /**
     * Withdraw every restricted tool granted to a group. Called when an admin
     * switches off "allow restricted tools" for the group, so switching it back
     * on later does not quietly restore grants nobody re-approved.
     *
     * The served list already ignores these grants once the setting is off;
     * removing them keeps the stored state matching what the page shows.
     *
     * A grant counts as restricted when it was restricted at the time it was
     * made, or when its tool is registered and restricted now. The first test
     * catches a grant whose tool is unregistered at the moment (a disabled
     * plugin), which would otherwise survive and serve again when the plugin
     * came back and the setting was switched on. The second catches a tool that
     * was eligible when granted and has since become restricted.
     *
     * @param groupId - The group whose restricted grants are withdrawn.
     * @param actor - Better Auth user id of the admin, for the log.
     * @returns How many grants were withdrawn.
     */
    async withdrawRestrictedGrants(groupId: string, actor: string | undefined): Promise<number> {
        const restrictedNames = this.toolRegistry.listToolInfo()
            .filter(info => getMcpToolIneligibility(info.capability) !== null)
            .map(info => info.name);
        const withdrawn = await this.database.deleteMany(MCP_TOOL_APPROVALS_COLLECTION, {
            groupId,
            $or: [{ restricted: true }, { toolName: { $in: restrictedNames } }]
        });
        if (withdrawn > 0) {
            this.invalidateApprovals();
        }
        this.logger.warn({ groupId, withdrawn, actor: actor ?? 'unattributed' }, `MCP restricted tools withdrawn from ${groupId}`);
        return withdrawn;
    }

    /**
     * Read a group's stored policy fresh and decide whether it may hold a
     * restricted grant right now. Granting reads it fresh rather than from the
     * cache, because another instance may have just switched the setting off.
     *
     * @param groupId - The group being granted a restricted tool.
     * @returns True when the group may hold restricted tools.
     */
    private async groupAllowsRestrictedNow(groupId: string): Promise<boolean> {
        return mcpGroupMayHoldTool(true, this.policies.policyFor(await this.policies.getPolicies(0), groupId));
    }

    /**
     * Drop the cached approvals so the next request reads the change, and stop
     * a read already in flight from putting the old approvals back.
     */
    private invalidateApprovals(): void {
        this.approvalsGeneration++;
        this.approvalsCache = null;
    }

    /**
     * Load every approval grouped by tool name, reusing the last read when it
     * is young enough for the caller.
     *
     * Documents without a group id were written before grants were per group.
     * They are skipped rather than guessed at; the module's migration
     * `001_tool_approvals_group_id` assigns them to `mcp-users`.
     *
     * @param maxAgeMs - How old a cached read the caller accepts. The endpoint
     *   passes the cache window to avoid a read per request; the admin page
     *   passes 0 to always read fresh.
     * @returns A map from tool name to its approval documents.
     */
    private async loadApprovals(maxAgeMs: number): Promise<Map<string, IMcpToolApprovalDocument[]>> {
        const now = Date.now();
        let approvals: Map<string, IMcpToolApprovalDocument[]>;
        if (this.approvalsCache && now - this.approvalsCache.readAt < maxAgeMs) {
            approvals = this.approvalsCache.approvals;
        } else {
            const generation = this.approvalsGeneration;
            const docs = await this.database.getCollection<IMcpToolApprovalDocument>(MCP_TOOL_APPROVALS_COLLECTION).find({}).toArray();
            approvals = new Map();
            for (const doc of docs) {
                if (typeof doc.groupId === 'string' && doc.groupId.length > 0) {
                    const list = approvals.get(doc.toolName) ?? [];
                    list.push(doc);
                    approvals.set(doc.toolName, list);
                }
            }
            if (generation === this.approvalsGeneration) {
                this.approvalsCache = { approvals, readAt: now };
            }
        }
        return approvals;
    }

    /**
     * Return a tool's capability fingerprint, computing it once per capability
     * object.
     *
     * @param capability - The tool's declared capability, or undefined when it
     *   declares none (computed each time, since there is no object to key on).
     * @returns The fingerprint to compare against a stored approval.
     */
    private fingerprintOf(capability: IAiTool['capability']): string {
        let fingerprint = capability ? this.fingerprints.get(capability) : undefined;
        if (fingerprint === undefined) {
            fingerprint = capabilityFingerprint(capability);
            if (capability) {
                this.fingerprints.set(capability, fingerprint);
            }
        }
        return fingerprint;
    }
}
