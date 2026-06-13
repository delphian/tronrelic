/**
 * @file tool-approval-queue.ts
 *
 * Holds invocations of external/irreversible tools for human approval, so an
 * autonomous or interactive AI run cannot execute a consequential, public, or
 * money-spending action without an operator releasing it. Generalizes the
 * per-plugin approval pattern (trp-x-poster's pending-post queue) into a
 * core-owned, provider-neutral store the governor enqueues into and the admin
 * surface resolves.
 *
 * The store is intentionally execution-free: it records the parked request and
 * its decision. The governor re-executes an approved request through its normal
 * path; the queue only tracks state.
 */

import type {
    IAiToolCapability,
    IDatabaseService,
    ISystemLogService,
    IToolInvocationContext
} from '@/types';

/** Physical collection name (modules prefix `module_<id>_` manually). */
const COLLECTION = 'module_ai-tools_approvals';

/** Lifecycle state of a parked request. */
export type ToolApprovalStatus = 'pending' | 'approved' | 'rejected';

/** A tool invocation held for human approval. */
export interface IToolApprovalRequest {
    /** Unique request id. */
    id: string;
    /** Name of the tool whose execution is held. */
    toolName: string;
    /** Plugin/module id that owns the tool. */
    providerId: string;
    /** Arguments the model supplied, to replay on approval. */
    input: Record<string, unknown>;
    /** Caller and trigger context captured at park time. */
    context: IToolInvocationContext;
    /** Capability snapshot, for the admin review surface. */
    capability?: IAiToolCapability;
    /** Current lifecycle state. */
    status: ToolApprovalStatus;
    /** ISO timestamp the request was parked. */
    createdAt: string;
    /** ISO timestamp the request was approved or rejected. */
    resolvedAt?: string;
    /** Actor id that resolved the request. */
    resolvedBy?: string;
}

/**
 * Persistent store of tool invocations awaiting human approval.
 */
export class ToolApprovalQueue {
    /**
     * @param logger - Module-scoped logger.
     * @param database - Core database owning the approvals collection.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly database: IDatabaseService
    ) {}

    /**
     * Create the collection's indexes. Called once during module init.
     *
     * @returns Resolves when all indexes exist.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(COLLECTION, { id: 1 }, { unique: true });
        await this.database.createIndex(COLLECTION, { status: 1, createdAt: -1 });
    }

    /**
     * Park a request in the `pending` state.
     *
     * @param request - The parked request, sans lifecycle fields.
     * @returns The stored request.
     */
    async enqueue(
        request: Omit<IToolApprovalRequest, 'status' | 'createdAt' | 'resolvedAt' | 'resolvedBy'>
    ): Promise<IToolApprovalRequest> {
        const stored: IToolApprovalRequest = {
            ...request,
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        await this.database.insertOne(COLLECTION, stored);
        this.logger.info({ id: stored.id, tool: stored.toolName }, 'AI tool invocation held for approval');
        return stored;
    }

    /**
     * Fetch one request by id.
     *
     * @param id - The request id.
     * @returns The request, or null when not found.
     */
    async get(id: string): Promise<IToolApprovalRequest | null> {
        return this.database.findOne<IToolApprovalRequest>(COLLECTION, { id });
    }

    /**
     * List pending requests, newest first.
     *
     * @param limit - Maximum requests to return (default 100, capped at 500).
     * @returns The pending requests.
     */
    async listPending(limit = 100): Promise<IToolApprovalRequest[]> {
        const capped = Math.min(Math.max(1, limit), 500);
        const collection = this.database.getCollection<IToolApprovalRequest>(COLLECTION);
        return collection
            .find({ status: 'pending' })
            .sort({ createdAt: -1 })
            .limit(capped)
            .toArray();
    }

    /**
     * Count requests still awaiting a decision, for the nav pending-count badge.
     *
     * @returns The number of `pending` requests.
     */
    async countPending(): Promise<number> {
        return this.database.count(COLLECTION, { status: 'pending' });
    }

    /**
     * Transition a pending request to `approved` or `rejected`.
     *
     * @param id - The request id.
     * @param status - The terminal state.
     * @param resolvedBy - Actor id resolving the request.
     * @returns The updated request, or null when no pending request matched.
     */
    async resolve(
        id: string,
        status: Exclude<ToolApprovalStatus, 'pending'>,
        resolvedBy?: string
    ): Promise<IToolApprovalRequest | null> {
        const existing = await this.database.findOne<IToolApprovalRequest>(COLLECTION, { id, status: 'pending' });
        let resolved: IToolApprovalRequest | null = null;
        if (existing) {
            const resolvedAt = new Date().toISOString();
            const setFields: Partial<IToolApprovalRequest> = { status, resolvedAt };
            if (resolvedBy !== undefined) {
                setFields.resolvedBy = resolvedBy;
            }
            await this.database.updateMany(COLLECTION, { id, status: 'pending' }, { $set: setFields });
            resolved = { ...existing, status, resolvedAt, resolvedBy };
            this.logger.info({ id, status, resolvedBy }, `AI tool approval ${status}: ${existing.toolName}`);
        }
        return resolved;
    }
}
