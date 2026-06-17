/**
 * @file ai-query-history.service.ts
 *
 * Core-owned persistence for AI query records, independent of any provider
 * plugin. The provider transports a query; core records what happened so the
 * `/system/ai-tools` Query tab keeps its own history that survives swapping the
 * provider. One row per streaming or programmatic query turn; turns sharing a
 * `conversationId` form one multi-turn chat.
 *
 * Mirrors the {@link ToolAuditStore} pattern: a module-owned collection named
 * with the manual `module_<id>_` prefix, indexes created once in module init
 * (the collection is new, so this is correct rather than a migration), and all
 * I/O through the injected {@link IDatabaseService} — never a direct Mongoose
 * import.
 */

import type { IAiQueryRecord, IDatabaseService, ISystemLogService } from '@/types';

/** Physical collection name (modules prefix `module_<id>_` manually). */
const COLLECTION = 'module_ai-tools_query_history';

/** Pagination input for the history listing. */
export interface IAiQueryHistoryQuery {
    /** Page size. Clamped to 1..200; defaults to 50. */
    limit?: number;
    /** Records to skip from the newest. Defaults to 0. */
    offset?: number;
}

/** One page of query records plus the unpaginated total. */
export interface IAiQueryHistoryPage {
    records: IAiQueryRecord[];
    total: number;
}

/**
 * Persists and queries {@link IAiQueryRecord} documents for the core AI query
 * backend.
 */
export class AiQueryHistoryService {
    /**
     * @param logger - Module-scoped logger.
     * @param database - Core database owning the query-history collection.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly database: IDatabaseService
    ) {}

    /**
     * Create the collection's indexes. Called once during module init — the
     * collection is new, so index creation here is correct rather than a
     * migration. The descending `createdAt` index backs the newest-first
     * listing; the compound conversation index backs the oldest-first thread
     * read.
     *
     * @returns Resolves when all indexes exist.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(COLLECTION, { id: 1 }, { unique: true });
        await this.database.createIndex(COLLECTION, { createdAt: -1 });
        await this.database.createIndex(COLLECTION, { conversationId: 1, createdAt: 1 }, { sparse: true });
    }

    /**
     * Append one query record. Failures are logged and swallowed — recording
     * history must never break the query it describes.
     *
     * @param record - The fully-built query record.
     * @returns Resolves once the write is attempted.
     */
    async append(record: IAiQueryRecord): Promise<void> {
        try {
            await this.database.insertOne(COLLECTION, record);
        } catch (error: unknown) {
            this.logger.error(
                { error: error instanceof Error ? error.message : String(error), queryId: record.id },
                'Failed to write AI query history record'
            );
        }
    }

    /**
     * Page through query records, newest first.
     *
     * @param query - Pagination.
     * @returns A page of records plus the matching total.
     */
    async list(query: IAiQueryHistoryQuery = {}): Promise<IAiQueryHistoryPage> {
        const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
        const offset = Math.max(0, query.offset ?? 0);

        const collection = this.database.getCollection<IAiQueryRecord>(COLLECTION);
        const records = await collection
            .find({})
            .sort({ createdAt: -1 })
            .skip(offset)
            .limit(limit)
            .toArray();
        const total = await this.database.count(COLLECTION, {});

        return { records, total };
    }

    /**
     * Fetch every record of one conversation, oldest first, so the Query tab can
     * reopen a multi-turn chat in the order it was spoken.
     *
     * @param conversationId - The id grouping the conversation's turns.
     * @returns The conversation's records in chronological order.
     */
    async getConversation(conversationId: string): Promise<IAiQueryRecord[]> {
        const collection = this.database.getCollection<IAiQueryRecord>(COLLECTION);
        return collection
            .find({ conversationId })
            .sort({ createdAt: 1 })
            .toArray();
    }
}
