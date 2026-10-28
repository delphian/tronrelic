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

import type { AiQueryMode, AiQueryOutcome, IAiQueryRecord, IAiQueryResult, IDatabaseService, ISystemLogService } from '@/types';
import { classifyAiQueryOutcome } from './classify-query-outcome.js';

/** Physical collection name (modules prefix `module_<id>_` manually). */
const COLLECTION = 'module_ai-tools_query_history';

/**
 * What a caller knows about how a run was set up, as opposed to what came back
 * from it. Both fields describe the request, and neither can be recovered from
 * the result object, so a path that does not supply them simply records less.
 */
export interface IAiQueryRecordContext {
    /**
     * The prompt after core resolved its `{%name%}` variables. Stored beside the
     * raw template because the template alone does not say what the run was
     * actually asked, and a variable reads live data that has moved on by the
     * time anyone reads the record back. Pass the raw prompt, or omit this, when
     * nothing was expanded — an identical string is dropped rather than stored
     * twice.
     */
    expandedPrompt?: string;

    /**
     * The tools the run was permitted to call, in the same three states the run
     * used: `null` for unrestricted, `[]` for none, a list for that subset.
     * Recorded so reopening the conversation can put the composer back the way
     * the run had it; a transcript only shows the tools the model chose to call,
     * which is a subset of the grant. Omit it when the path genuinely does not
     * know, so the record stays silent rather than claiming `null`.
     */
    toolAllowlist?: string[] | null;

    /**
     * The saved prompt that produced the run, when one did. Recorded so a
     * prompt's runs can be found again: nothing in the result names the
     * prompt, and each autonomous run gets a fresh conversation id. Omit it
     * on an interactive run.
     */
    savedPromptId?: string;

    /**
     * The saved-prompt trigger that fired the run. Omit it on a manual
     * run-now, which no trigger fired.
     */
    triggerId?: string;
}

/**
 * Build a query-history record from a settled query, shared by every code path
 * that records one — the interactive controller (stream / programmatic) and the
 * scheduled-prompts runner (scheduled). Centralised so the record shape stays
 * identical across paths: drift between them would make the same query render
 * differently depending on how it was launched. On success `result` carries the
 * model, usage, and cost; on failure `errorMessage` is set and the caller's
 * requested `fallbackModel` (if any) stands in for the unknown model. When the
 * provider reports a structured transcript on `result`, it is persisted so a
 * reopened conversation replays the whole turn (thinking, tool calls, tool
 * results) rather than only `responseText`.
 *
 * A returned result is **not** by itself a successful run. The status, outcome,
 * and stop reason are set from `classifyAiQueryOutcome`, so a run that was
 * truncated, ran out of tool rounds, paused, was refused, or produced no text at
 * all is stored as `incomplete` with a stated reason rather than as `completed`.
 * That classification happens here, in the one builder every path goes through,
 * so no caller can record a run it judged for itself.
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
 * @param context - What the caller knows about how the run was set up, which
 *        the result object does not carry. Grouped into one object rather than
 *        added as further positional parameters, because these describe the
 *        request while everything above describes the outcome, and a call site
 *        passing a bare eighth and ninth value says nothing about which is
 *        which.
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
    fallbackModel?: string,
    context: IAiQueryRecordContext = {}
): IAiQueryRecord {
    const { expandedPrompt, toolAllowlist, savedPromptId, triggerId } = context;
    const assessment = classifyAiQueryOutcome(result, errorMessage);

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
        // The caller's error when there was one, and otherwise the classifier's
        // reason for an incomplete run. Both answer the same operator question —
        // why is there no usable answer here — so they share one field rather
        // than leaving a truncated or refused run with a blank explanation.
        errorMessage: errorMessage ?? assessment.detail,
        status: assessment.status,
        outcome: assessment.outcome,
        createdAt,
        completedAt: new Date().toISOString(),
        // Only stored when expansion actually changed the text. A prompt with
        // no variables would otherwise duplicate itself in every record, and a
        // reader that sees the field present would wrongly conclude a variable
        // was involved.
        //
        // The test is `!== undefined` rather than a truthiness check because a
        // resolver may legitimately return an empty string. A prompt consisting
        // only of such a variable expands to `''`, which is what the run was
        // asked; dropping it would leave a reader falling back to `prompt` and
        // seeing the raw `{%name%}` token as though that had been sent. Absent
        // still means "this path did not expand", which is how the skipped-run
        // and failed-run call sites report themselves.
        ...(expandedPrompt !== undefined && expandedPrompt !== prompt ? { expandedPrompt } : {}),
        // Stored whenever the caller stated one, `null` included — `null` means
        // "ran unrestricted", which is a real answer and different from the
        // field being absent because the path never knew.
        ...(toolAllowlist !== undefined ? { toolAllowlist } : {}),
        // Absent when the query threw: there was no turn, so there is no stop
        // reason, and storing a default would invent a signal that never arrived.
        ...(result ? { stopReason: result.stopReason } : {}),
        ...(conversationId ? { conversationId } : {}),
        // Left out rather than stored empty when the run did not come from a
        // saved prompt, so a filter on either field only ever matches runs
        // that really have one.
        ...(savedPromptId ? { savedPromptId } : {}),
        ...(triggerId ? { triggerId } : {}),
        // Persist the structured transcript when the provider reported one, so a
        // reopened conversation replays the turn's thinking, tool calls, and tool
        // results — not just `responseText`. Absent when the query failed or the
        // provider reports no transcript; the Query tab falls back to
        // `responseText` then.
        ...(result?.transcript && result.transcript.length > 0 ? { transcript: result.transcript } : {})
    };
}

/**
 * Which runs a history read covers. Every field is optional and narrows the
 * set; an empty filter covers every run. Shared by the paged listing and the
 * summary so the two always agree on what a filter selects.
 */
export interface IAiQueryHistoryFilter {
    /** Only runs produced by this saved prompt. */
    savedPromptId?: string;
    /** Only runs recorded with this execution mode. */
    mode?: AiQueryMode;
    /** Only runs that ended with this status. */
    status?: IAiQueryRecord['status'];
    /** Only runs classified with this outcome. Runs recorded before outcomes existed never match. */
    outcome?: AiQueryOutcome;
    /**
     * Earliest `createdAt` to include, as an ISO 8601 UTC string in
     * `toISOString()` shape. `createdAt` is stored as that string, so a plain
     * string comparison orders records by time.
     */
    since?: string;
    /** Latest `createdAt` to include, in the same shape as `since`. */
    until?: string;
}

/** Filter and pagination input for the history listing. */
export interface IAiQueryHistoryQuery extends IAiQueryHistoryFilter {
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
 * Totals over every run a filter selects, so a caller can judge how a saved
 * prompt has been doing without paging through its runs and adding them up.
 */
export interface IAiQueryRunSummary {
    /** Runs the filter selects. */
    runs: number;
    /** Run count per `status`. */
    byStatus: Record<string, number>;
    /** Run count per `outcome`, with runs recorded before outcomes existed counted under `unrecorded`. */
    byOutcome: Record<string, number>;
    /** Sum of `costUsd` over the runs that carry one. */
    costUsd: number;
    /** Runs that carry a `costUsd`. A run the provider could not price is not counted as free. */
    pricedRuns: number;
    /** Sum of input tokens. */
    inputTokens: number;
    /** Sum of output tokens. */
    outputTokens: number;
    /** `createdAt` of the oldest selected run, or null when none matched. */
    firstRunAt: string | null;
    /** `createdAt` of the newest selected run, or null when none matched. */
    lastRunAt: string | null;
    /** `createdAt` of the newest selected run whose outcome is `answered`, or null. */
    lastAnsweredAt: string | null;
    /** Id of that run, or null. */
    lastAnsweredRunId: string | null;
}

/** The shape the summary aggregation returns, before it is turned into an {@link IAiQueryRunSummary}. */
interface ISummaryFacets {
    totals: Array<{ runs: number; costUsd: number; pricedRuns: number; inputTokens: number; outputTokens: number; firstRunAt: string; lastRunAt: string }>;
    byStatus: Array<{ _id: string | null; count: number }>;
    byOutcome: Array<{ _id: string | null; count: number }>;
    lastAnswered: Array<{ id: string; createdAt: string }>;
}

/**
 * Turn a history filter into a database filter.
 *
 * Every value is coerced to a primitive string, so a filter can never carry a
 * database operator object even if a caller passes model-supplied input
 * straight through.
 *
 * @param filter - The fields to narrow by.
 * @returns The database filter, empty when nothing narrows.
 */
function toDatabaseFilter(filter: IAiQueryHistoryFilter): Record<string, unknown> {
    const query: Record<string, unknown> = {};
    if (filter.savedPromptId) {
        query.savedPromptId = String(filter.savedPromptId);
    }
    if (filter.mode) {
        query.mode = String(filter.mode);
    }
    if (filter.status) {
        query.status = String(filter.status);
    }
    if (filter.outcome) {
        query.outcome = String(filter.outcome);
    }
    if (filter.since || filter.until) {
        const range: Record<string, string> = {};
        if (filter.since) {
            range.$gte = String(filter.since);
        }
        if (filter.until) {
            range.$lte = String(filter.until);
        }
        query.createdAt = range;
    }
    return query;
}

/**
 * Turn a grouped count list into an object keyed by the grouped value.
 *
 * @param rows - One row per distinct value, with its count.
 * @param missingKey - The key a row with no value is counted under.
 * @returns Count per value.
 */
function toCounts(rows: Array<{ _id: string | null; count: number }>, missingKey: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const row of rows) {
        const key = row._id ?? missingKey;
        counts[key] = (counts[key] ?? 0) + row.count;
    }
    return counts;
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
        // Backs one saved prompt's runs read newest first, by the listing and
        // the summary. Sparse because interactive runs carry no savedPromptId.
        await this.database.createIndex(COLLECTION, { savedPromptId: 1, createdAt: -1 }, { sparse: true });
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
     * Page through query records, newest first, narrowed by the filter.
     *
     * @param query - Filters and pagination. With no filters every run is listed.
     * @returns A page of records plus the total matching the filters.
     */
    async list(query: IAiQueryHistoryQuery = {}): Promise<IAiQueryHistoryPage> {
        const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
        const offset = Math.max(0, query.offset ?? 0);
        const filter = toDatabaseFilter(query);

        const collection = this.database.getCollection<IAiQueryRecord>(COLLECTION);
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
     * Add up every run a filter selects, in one database round-trip.
     *
     * Paging through a prompt's runs and adding them up in the caller would
     * cost one call per page and miss runs past the last page read. This runs
     * a single aggregation with one branch per figure. Cost is summed only
     * over runs that carry a number, and `pricedRuns` says how many did, so a
     * run the provider could not price is reported as unknown rather than
     * counted as free.
     *
     * @param filter - Which runs to add up. With no filters every run is covered.
     * @returns The totals, with zero counts and null timestamps when nothing matched.
     */
    async summarize(filter: IAiQueryHistoryFilter = {}): Promise<IAiQueryRunSummary> {
        const collection = this.database.getCollection<IAiQueryRecord>(COLLECTION);
        const rows = await collection
            .aggregate<ISummaryFacets>([
                { $match: toDatabaseFilter(filter) },
                {
                    $facet: {
                        totals: [
                            {
                                $group: {
                                    _id: null,
                                    runs: { $sum: 1 },
                                    costUsd: { $sum: { $cond: [{ $isNumber: '$costUsd' }, '$costUsd', 0] } },
                                    pricedRuns: { $sum: { $cond: [{ $isNumber: '$costUsd' }, 1, 0] } },
                                    inputTokens: { $sum: { $ifNull: ['$usage.inputTokens', 0] } },
                                    outputTokens: { $sum: { $ifNull: ['$usage.outputTokens', 0] } },
                                    firstRunAt: { $min: '$createdAt' },
                                    lastRunAt: { $max: '$createdAt' }
                                }
                            }
                        ],
                        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
                        byOutcome: [{ $group: { _id: '$outcome', count: { $sum: 1 } } }],
                        lastAnswered: [
                            { $match: { outcome: 'answered' } },
                            { $sort: { createdAt: -1 } },
                            { $limit: 1 },
                            { $project: { _id: 0, id: 1, createdAt: 1 } }
                        ]
                    }
                }
            ])
            .toArray();

        const facets = rows[0];
        const totals = facets?.totals[0];
        const lastAnswered = facets?.lastAnswered[0];
        return {
            runs: totals?.runs ?? 0,
            byStatus: toCounts(facets?.byStatus ?? [], 'unrecorded'),
            byOutcome: toCounts(facets?.byOutcome ?? [], 'unrecorded'),
            costUsd: totals?.costUsd ?? 0,
            pricedRuns: totals?.pricedRuns ?? 0,
            inputTokens: totals?.inputTokens ?? 0,
            outputTokens: totals?.outputTokens ?? 0,
            firstRunAt: totals?.firstRunAt ?? null,
            lastRunAt: totals?.lastRunAt ?? null,
            lastAnsweredAt: lastAnswered?.createdAt ?? null,
            lastAnsweredRunId: lastAnswered?.id ?? null
        };
    }

    /**
     * Fetch one query record by its own id, so a caller holding the id of a
     * single turn can read it without loading the whole conversation.
     *
     * @param id - The record id.
     * @returns The record, or `null` when none has that id.
     */
    async get(id: string): Promise<IAiQueryRecord | null> {
        const collection = this.database.getCollection<IAiQueryRecord>(COLLECTION);
        // Coerce to a primitive string so the filter can never carry a Mongo
        // operator object, even if a caller passes model-supplied input through.
        return collection.findOne({ id: String(id) });
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
