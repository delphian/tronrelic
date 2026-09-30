/**
 * @fileoverview Which AI tools members of the MCP group may see and call.
 *
 * Every registered tool starts hidden from MCP. An admin approves each tool by
 * hand on `/system/mcp`, and the approval is stored with a fingerprint of the
 * tool's capability at that moment. A tool is served only while all of these
 * hold:
 *
 * - it is switched on in the AI tool registry,
 * - it passes the MCP eligibility floor (`getMcpToolIneligibility`),
 * - an admin approved it,
 * - its capability still matches the fingerprint recorded at approval.
 *
 * The governor re-applies the eligibility floor and the allowlist on every
 * call, so this service decides what is offered while the governor decides
 * what may run.
 */

import type { IAiTool, IAiToolRegistry, IDatabaseService, IMcpToolExposure, ISystemLogService } from '@/types';
import { getMcpToolIneligibility } from '@/types';
import { capabilityFingerprint } from './capabilityFingerprint.js';

/** Collection holding one approval document per approved tool. */
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
    fingerprint: string;
    approvedAt: Date;
    approvedBy?: string;
}

/** Error thrown when an admin asks to expose a tool that cannot be exposed. */
export class McpToolExposureError extends Error {
    /**
     * @param message - Sentence explaining the refusal, returned to the admin.
     * @param status - HTTP status the controller should answer with.
     */
    constructor(message: string, readonly status: 400 | 404) {
        super(message);
        this.name = 'McpToolExposureError';
    }
}

/**
 * Tracks admin approvals and computes the set of tools served over MCP.
 */
export class McpToolExposureService {
    /** The approvals last read from the database, and when they were read. */
    private approvalsCache: { approvals: Map<string, IMcpToolApprovalDocument>; readAt: number } | null = null;

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
     * @param logger - Module logger, used to record approvals and withdrawals.
     */
    constructor(
        private readonly database: IDatabaseService,
        private readonly toolRegistry: IAiToolRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Create the unique index on tool name. Called once from module init.
     *
     * @returns Resolves when the index exists.
     */
    async createIndexes(): Promise<void> {
        await this.database.createIndex(MCP_TOOL_APPROVALS_COLLECTION, { toolName: 1 }, { unique: true });
    }

    /**
     * List every registered tool with its MCP state, for the admin page.
     *
     * @returns One row per registered tool, sorted by name.
     */
    async listExposures(): Promise<IMcpToolExposure[]> {
        // The admin page always reads fresh, so it never shows another
        // instance's change late.
        const approvals = await this.loadApprovals(0);
        const rows = this.toolRegistry.listToolInfo().map(info => {
            const approval = approvals.get(info.name);
            const ineligibleReason = getMcpToolIneligibility(info.capability);
            const stale = approval !== undefined && approval.fingerprint !== this.fingerprintOf(info.capability);
            const row: IMcpToolExposure = {
                name: info.name,
                description: info.description,
                provider: info.provider,
                enabledInRegistry: info.enabled,
                capability: info.capability,
                ineligibleReason,
                approved: approval !== undefined,
                stale,
                served: approval !== undefined && !stale && ineligibleReason === null && info.enabled
            };
            if (approval) {
                row.approvedAt = new Date(approval.approvedAt).toISOString();
                if (approval.approvedBy) {
                    row.approvedBy = approval.approvedBy;
                }
            }
            return row;
        });
        return rows.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Return the tools members of the MCP group can use right now, in a stable
     * order so clients can cache the list.
     *
     * @returns The served tools, sorted by name.
     */
    async getServedTools(): Promise<IAiTool[]> {
        const approvals = await this.loadApprovals(APPROVALS_CACHE_TTL_MS);
        return this.toolRegistry.getEnabledTools()
            .filter(tool => {
                const approval = approvals.get(tool.name);
                return approval !== undefined
                    && approval.fingerprint === this.fingerprintOf(tool.capability)
                    && getMcpToolIneligibility(tool.capability) === null;
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Approve a tool for MCP, or withdraw an approval.
     *
     * Approving records the tool's current capability fingerprint, so approving
     * a stale tool again is how an admin accepts its changed declaration.
     *
     * Withdrawing does not require the tool to be registered. An approval left
     * behind by an uninstalled plugin would otherwise be impossible to remove,
     * and it would start serving again the moment a tool with that name and
     * capability registered.
     *
     * @param toolName - Registered tool name.
     * @param expose - True to approve, false to withdraw.
     * @param actor - Better Auth user id of the admin, for the record and the log.
     * @returns The tool's updated row, or null when a withdrawn tool is not
     *   registered and so has no row.
     * @throws {McpToolExposureError} 404 when approving a tool that is not
     *   registered, 400 when approving a tool that fails the eligibility floor.
     */
    async setExposure(toolName: string, expose: boolean, actor: string | undefined): Promise<IMcpToolExposure | null> {
        const tool = this.toolRegistry.getTool(toolName);
        if (!tool && expose) {
            throw new McpToolExposureError(`Tool "${toolName}" is not registered.`, 404);
        }
        const collection = this.database.getCollection<IMcpToolApprovalDocument>(MCP_TOOL_APPROVALS_COLLECTION);
        if (expose && tool) {
            const ineligible = getMcpToolIneligibility(tool.capability);
            if (ineligible !== null) {
                throw new McpToolExposureError(`Tool "${toolName}" cannot be exposed over MCP. ${ineligible}`, 400);
            }
            await collection.updateOne(
                { toolName },
                { $set: { toolName, fingerprint: capabilityFingerprint(tool.capability), approvedAt: new Date(), ...(actor ? { approvedBy: actor } : {}) } },
                { upsert: true }
            );
        } else {
            await collection.deleteOne({ toolName });
        }
        // The next request must see this change, not the cached approvals, and
        // a read already in flight must not put the old approvals back.
        this.approvalsGeneration++;
        this.approvalsCache = null;
        this.logger.warn(
            { tool: toolName, exposed: expose, actor: actor ?? 'unattributed' },
            `MCP tool ${expose ? 'exposed' : 'withdrawn'}: ${toolName}`
        );
        const rows = await this.listExposures();
        return rows.find(row => row.name === toolName) ?? null;
    }

    /**
     * Load every approval keyed by tool name, reusing the last read when it is
     * young enough for the caller.
     *
     * @param maxAgeMs - How old a cached read the caller accepts. The endpoint
     *   passes the cache window to avoid a read per request; the admin page
     *   passes 0 to always read fresh.
     * @returns A map from tool name to its approval document.
     */
    private async loadApprovals(maxAgeMs: number): Promise<Map<string, IMcpToolApprovalDocument>> {
        const now = Date.now();
        let approvals: Map<string, IMcpToolApprovalDocument>;
        if (this.approvalsCache && now - this.approvalsCache.readAt < maxAgeMs) {
            approvals = this.approvalsCache.approvals;
        } else {
            const generation = this.approvalsGeneration;
            const docs = await this.database.getCollection<IMcpToolApprovalDocument>(MCP_TOOL_APPROVALS_COLLECTION).find({}).toArray();
            approvals = new Map(docs.map(doc => [doc.toolName, doc]));
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
