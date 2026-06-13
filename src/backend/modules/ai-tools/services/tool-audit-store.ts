/**
 * @file tool-audit-store.ts
 *
 * Durable, queryable record of every governed tool invocation — one row per
 * call capturing who triggered it, by what path, with what (redacted)
 * arguments, the outcome, and the cost. This is the accountability surface the
 * platform lacked: the governor writes here on every call so an operator can
 * reconstruct exactly what an AI run did.
 *
 * Retention is an indexed range delete rather than a Mongo TTL index because
 * `createdAt` is an ISO string, not a `Date`.
 */

import type {
    IDatabaseService,
    ISystemLogService,
    IToolInvocationRecord,
    ToolInvocationStatus,
    ToolTriggerPath
} from '@/types';

/** Physical collection name (modules prefix `module_<id>_` manually). */
const COLLECTION = 'module_ai-tools_invocations';

/** Records older than this are pruned on each retention sweep. */
const RETENTION_DAYS = 90;

/** Filters for the admin activity feed. */
export interface IToolInvocationQuery {
    toolName?: string;
    providerId?: string;
    aiProviderId?: string;
    triggerPath?: ToolTriggerPath;
    status?: ToolInvocationStatus;
    limit?: number;
    offset?: number;
}

/** One page of invocation records plus the unpaginated total. */
export interface IToolInvocationPage {
    records: IToolInvocationRecord[];
    total: number;
}

/**
 * Persists and queries {@link IToolInvocationRecord} documents.
 */
export class ToolAuditStore {
    /**
     * @param logger - Module-scoped logger.
     * @param database - Core database owning the invocations collection.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly database: IDatabaseService
    ) {}

    /**
     * Create the collection's indexes. Called once during module init — the
     * collection is new, so Mongoose-style index creation is correct here
     * rather than a migration.
     *
     * @returns Resolves when all indexes exist.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(COLLECTION, { id: 1 }, { unique: true });
        await this.database.createIndex(COLLECTION, { createdAt: -1 });
        await this.database.createIndex(COLLECTION, { toolName: 1, createdAt: -1 });
        await this.database.createIndex(COLLECTION, { status: 1, createdAt: -1 });
    }

    /**
     * Write one invocation record. Failures are logged and swallowed — the
     * audit trail must never break the tool call it describes.
     *
     * @param record - The fully-built, redaction-applied record.
     * @returns Resolves once the write is attempted.
     */
    async record(record: IToolInvocationRecord): Promise<void> {
        try {
            await this.database.insertOne(COLLECTION, record);
        } catch (error: unknown) {
            this.logger.error(
                { error: error instanceof Error ? error.message : String(error), tool: record.toolName },
                'Failed to write AI tool invocation record'
            );
        }
    }

    /**
     * Page through invocation records, newest first, filtered by the supplied
     * criteria. Backs the admin activity feed and the per-run "tools used" view
     * (filter by `queryId`/`conversationId` upstream when present).
     *
     * @param query - Filters and pagination.
     * @returns A page of records plus the matching total.
     */
    async list(query: IToolInvocationQuery = {}): Promise<IToolInvocationPage> {
        const filter: Record<string, unknown> = {};
        if (query.toolName) {
            filter.toolName = query.toolName;
        }
        if (query.providerId) {
            filter.providerId = query.providerId;
        }
        if (query.aiProviderId) {
            filter.aiProviderId = query.aiProviderId;
        }
        if (query.triggerPath) {
            filter.triggerPath = query.triggerPath;
        }
        if (query.status) {
            filter.status = query.status;
        }

        const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
        const offset = Math.max(0, query.offset ?? 0);

        const collection = this.database.getCollection<IToolInvocationRecord>(COLLECTION);
        const records = await collection
            .find(filter)
            .sort({ createdAt: -1 })
            .skip(offset)
            .limit(limit)
            .toArray();
        const total = await this.database.count(COLLECTION, filter);

        return { records, total };
    }

    /**
     * Fetch a single record by id.
     *
     * @param id - The record id.
     * @returns The record, or null when not found.
     */
    async getById(id: string): Promise<IToolInvocationRecord | null> {
        return this.database.findOne<IToolInvocationRecord>(COLLECTION, { id });
    }

    /**
     * Delete records older than the retention window.
     *
     * @returns The number of records pruned.
     */
    async pruneExpired(): Promise<number> {
        const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const result = await this.database.deleteMany(COLLECTION, { createdAt: { $lt: cutoff } });
        const deleted = (result as { deletedCount?: number })?.deletedCount ?? 0;
        if (deleted > 0) {
            this.logger.info({ deleted, cutoff }, 'Pruned expired AI tool invocation records');
        }
        return deleted;
    }
}
