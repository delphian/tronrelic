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

import type { AiQueryMode, IAiQueryRecord, IAiQueryResult, IDatabaseService, ISystemLogService } from '@/types';

/** Physical collection name (modules prefix `module_<id>_` manually). */
const COLLECTION = 'module_ai-tools_query_history';

/**
 * Build a query-history record from a settled query, shared by every code path
 * that records one — the interactive controller (stream / programmatic) and the
 * scheduled-prompts runner (scheduled). Centralised so the record shape stays
 * identical across paths: drift between them would make the same query render
 * differently depending on how it was launched. On success `result` carries the
 * model, usage, and cost; on failure `errorMessage` is set and the caller's
 * requested `fallbackModel` (if any) stands in for the unknown model.
 *
 * @param mode - Execution mode the record is tagged with (`stream` for the
 *        admin stream path, `programmatic` for a non-streaming admin call,
 *        `scheduled` for an autonomous cron run).
 * @param prompt - The prompt for this turn, recorded verbatim.
 * @param conversationId - Grouping id for the history view. The Query tab only
 *        surfaces records that carry one, so a path that wants its run visible
 *        (including a one-shot scheduled run) must pass a non-empty id.
 * @param createdAt - ISO timestamp captured when the query started, so the row
 *        dates from the run's start rather than its completion.
 * @param id - Unique record id (the streaming `queryId`, or a fresh uuid).
 * @param result - The successful result, or null when the query failed.
 * @param errorMessage - The failure reason, or null on success.
 * @param fallbackModel - Model to record when there is no result to read it from.
 * @returns A fully-built {@link IAiQueryRecord} ready to hand to {@link AiQueryHistoryService.append}.
 */
export function buildAiQueryRecord(
    mode: AiQueryMode,
    prompt: string,
    conversationId: string | undefined,
    createdAt: string,
    id: string,
    result: IAiQueryResult | null,
    errorMessage: string | null,
    fallbackModel?: string
): IAiQueryRecord {
    return {
        id,
        mode,
        prompt,
        responseText: result?.responseText ?? null,
        model: result?.model ?? fallbackModel ?? 'unknown',
        usage: result?.usage ?? { inputTokens: 0, outputTokens: 0 },
        // Provider-computed estimated cost, persisted so a reopened
        // conversation shows the same figure the live run did.
        costUsd: result?.costUsd ?? null,
        errorMessage,
        status: result ? 'completed' : 'failed',
        createdAt,
        completedAt: new Date().toISOString(),
        ...(conversationId ? { conversationId } : {})
    };
}

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
