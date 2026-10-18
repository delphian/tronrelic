/**
 * @fileoverview Read-only AI tools over the AI query history.
 *
 * Every AI query core runs — typed on the Query tab, fired by a saved prompt's
 * cron or hook trigger, or started with run-now — is stored as a record in
 * `module_ai-tools_query_history`. An agent reviewing how scheduled prompts are
 * doing, or debugging why a run produced nothing, needs to page through those
 * runs and read what actually happened in one.
 *
 * Two tools:
 *
 * - `ai-list-prompt-runs`: one page of runs, newest first, with status,
 *   outcome, model, cost, and a short preview of the prompt. No answers, no
 *   transcripts, no error text.
 * - `ai-get-prompt-run`: the full transcript of one run, by record id (one
 *   turn) or conversation id (every turn, oldest first), returned in pages so
 *   a long agentic run stays readable to the end.
 *
 * The two are classified differently on purpose. The listing returns only what
 * an admin typed and figures the service computed, so it is `internal`. The
 * transcript returns the model's answers and every tool result the model was
 * handed, which can hold a secret: a model asked to repeat a secret variable
 * does so, and a `secret`-classified tool's result is stored verbatim. That is
 * why the admin history routes refuse the shared service token, and why this
 * tool is `secret` — it fails the MCP safety floor, counts as the trifecta's
 * private-data leg while enabled, and has its arguments redacted in the audit
 * record.
 *
 * @module backend/modules/ai-tools/buildPromptRunAiTools
 */

import type {
    IAiQueryRecord,
    IAiTool,
    IAiToolCapability,
    IAiTranscriptSegment,
    ISystemLogService
} from '@/types';
import type { AiQueryHistoryService } from './services/ai-query-history.service.js';
import { AiToolInputError, runAiToolCall } from './runAiToolCall.js';

/**
 * Every tool's name, led by `ai`, the first word of the module id. Renaming one
 * drops its stored enabled state and policy overrides, and breaks any saved
 * prompt whose tool allowlist names it.
 */
export const AI_TOOL_NAMES = {
    listRuns: 'ai-list-prompt-runs',
    getRun: 'ai-get-prompt-run'
} as const;

/**
 * Classification of `ai-list-prompt-runs`.
 *
 * Read-only and free. `internal` because it returns run metadata and a preview
 * of the prompt template an admin typed, never an answer, a tool result, or an
 * error message. For the same reason it does not surface untrusted content.
 */
const LIST_CAPABILITY: IAiToolCapability = {
    sideEffect: 'read',
    reversible: true,
    sensitivity: 'internal'
};

/**
 * Classification of `ai-get-prompt-run`.
 *
 * Read-only and free. `secret` because a stored answer or tool result can hold
 * a secret value (see the file header). `surfacesUntrustedContent` because tool
 * results carry outside text such as TRON memos and fetched web pages, so the
 * governor wraps every result as data.
 */
const GET_CAPABILITY: IAiToolCapability = {
    sideEffect: 'read',
    reversible: true,
    sensitivity: 'secret',
    surfacesUntrustedContent: true
};

/** Runs per page when the caller does not say, and the most one page may hold. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Largest listing offset or transcript page position accepted, so a nonsense
 * argument is refused rather than sent to the database or walked.
 */
const MAX_OFFSET = 1_000_000;

/** Characters of the prompt template shown in each listing row. */
const PROMPT_PREVIEW_CHARS = 200;

/** Most turns one conversation returns; a longer chat is cut and marked `turnsTruncated`. */
const MAX_TURNS = 50;

/**
 * Most characters any one text field returns: a prompt, an answer, a thinking
 * block, a tool's arguments, or a tool's result.
 */
const MAX_FIELD_CHARS = 20_000;

/**
 * Most characters of text one `ai-get-prompt-run` page returns across every
 * field, so a long agentic run cannot fill the caller's context window. When
 * the next item would not fit, the page ends and `next` tells the caller where
 * to resume, so no item is cut by this limit — only by {@link MAX_FIELD_CHARS}.
 */
const MAX_TOTAL_CHARS = 120_000;

/**
 * Longest id `ai-get-prompt-run` accepts. There is no character rule, because
 * there is none on the write side: `POST /query` stores the streaming `queryId`
 * and whatever `conversationId` the caller sent verbatim, so a character rule
 * applied only here would let the listing show a run this tool then refuses to
 * open. The cap keeps the argument bounded.
 */
const MAX_ID_CHARS = 256;

/** The sentence both descriptions end with, stating what the two tools share. */
const SHARED_DESCRIPTION =
    'A prompt run is one AI query TronRelic executed: typed by an admin (mode stream or programmatic) or fired by a saved prompt\'s trigger or run-now (mode scheduled). ' +
    'Turns sharing a conversationId form one multi-turn chat. status is completed, incomplete (the run stopped without a usable answer; outcome says why), or failed. ' +
    'Read-only; never runs, edits, or deletes anything.';

/** What the model is told when a call fails for a reason that is not its input. */
const FAILURE_MESSAGE = 'The prompt run lookup failed.';

/**
 * Cuts text fields against a per-field limit and a shared total, and counts
 * how many it had to cut. One cutter serves one page, so every field in the
 * response draws from the same total.
 *
 * The page builder asks {@link fits} before taking an item and ends the page
 * when the answer is no, so in practice only the per-field limit ever cuts
 * text. The total still caps {@link take} as a backstop.
 */
class TextBudget {
    private remaining: number;

    /** Number of fields cut so far, reported to the model as `truncatedFields`. */
    truncatedFields = 0;

    /**
     * @param total - Characters the whole page may spend on text.
     * @param perField - Characters any single field may use.
     */
    constructor(total: number, private readonly perField: number) {
        this.remaining = total;
    }

    /**
     * Work out what a field would spend once the per-field limit is applied,
     * so the page builder can decide whether it fits before taking it.
     *
     * @param text - The full field.
     * @returns The number of characters taking it would use.
     */
    cost(text: string): number {
        return Math.min(this.perField, text.length);
    }

    /**
     * Say whether a given number of characters still fits in this page, so an
     * item that does not fit is left for the next page instead of being cut.
     *
     * @param chars - Characters the next item would spend, from {@link cost}.
     * @returns True when the page has room for them.
     */
    fits(chars: number): boolean {
        return chars <= this.remaining;
    }

    /**
     * Take as much of a text field as the limits allow.
     *
     * @param text - The full field.
     * @returns The kept text and whether it was cut.
     */
    take(text: string): { text: string; truncated: boolean } {
        const allowed = Math.min(this.perField, this.remaining);
        const truncated = text.length > allowed;
        const kept = truncated ? text.slice(0, allowed) : text;
        this.remaining -= kept.length;
        if (truncated) {
            this.truncatedFields += 1;
        }
        return { text: kept, truncated };
    }
}

/**
 * Read an optional whole-number argument within a range.
 *
 * @param value - The raw argument, possibly absent.
 * @param field - The parameter name, for the message.
 * @param fallback - The value used when the argument is absent.
 * @param min - The smallest accepted value.
 * @param max - The largest accepted value.
 * @returns An integer from `min` to `max`.
 */
function readInteger(value: unknown, field: string, fallback: number, min: number, max: number): number {
    let result = fallback;
    if (value !== undefined && value !== null) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
            throw new AiToolInputError(`${field} must be a whole number from ${min} to ${max}.`);
        }
        result = value;
    }
    return result;
}

/**
 * Read the `id` argument, refusing anything that cannot be a run or
 * conversation id.
 *
 * @param value - The raw `id` argument.
 * @returns The trimmed id.
 */
function readId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim() : '';
    if (id.length === 0 || id.length > MAX_ID_CHARS) {
        throw new AiToolInputError(`id must be a run id or conversation id from ${AI_TOOL_NAMES.listRuns}: 1 to ${MAX_ID_CHARS} characters.`);
    }
    return id;
}

/**
 * Describe the metadata both tools return for every turn.
 *
 * @param record - The stored turn.
 * @returns The shared metadata fields.
 */
function toRunMetadata(record: IAiQueryRecord): Record<string, unknown> {
    return {
        id: record.id,
        conversationId: record.conversationId ?? null,
        mode: record.mode,
        model: record.model,
        status: record.status,
        outcome: record.outcome ?? null,
        stopReason: record.stopReason ?? null,
        createdAt: record.createdAt,
        completedAt: record.completedAt,
        costUsd: record.costUsd ?? null,
        usage: record.usage
    };
}

/**
 * Turn one listing row into what `ai-list-prompt-runs` returns: metadata, a
 * short preview of the prompt template, and counts that hint at the run's size.
 *
 * @param record - The stored turn.
 * @returns The listing entry.
 */
function toListEntry(record: IAiQueryRecord): Record<string, unknown> {
    const transcript = record.transcript ?? [];
    return {
        ...toRunMetadata(record),
        promptPreview: record.prompt.slice(0, PROMPT_PREVIEW_CHARS),
        promptChars: record.prompt.length,
        toolCalls: transcript.filter(segment => segment.type === 'tool_use').length,
        hasTranscript: transcript.length > 0
    };
}

/**
 * Give the text a segment charges against the page budget, so the fit check
 * and the segment view measure the same string.
 *
 * @param segment - The stored segment.
 * @returns A tool call's arguments as JSON, a tool result's content, or the
 *          text of a thinking or answer segment.
 */
function segmentText(segment: IAiTranscriptSegment): string {
    let text: string;
    if (segment.type === 'tool_use') {
        text = JSON.stringify(segment.input ?? null);
    } else if (segment.type === 'tool_result') {
        text = segment.content;
    } else {
        text = segment.text;
    }
    return text;
}

/**
 * Turn one transcript segment into what the transcript tool returns, cutting
 * its text against the page's budget.
 *
 * A tool call's arguments are returned as the original object when they fit,
 * and as a cut JSON string when they do not, so the model can always tell
 * which it has.
 *
 * @param segment - The stored segment.
 * @param budget - The page's shared text budget.
 * @returns The segment as the tool returns it.
 */
function toSegmentView(segment: IAiTranscriptSegment, budget: TextBudget): Record<string, unknown> {
    let view: Record<string, unknown>;
    if (segment.type === 'tool_use') {
        const cut = budget.take(segmentText(segment));
        view = {
            type: 'tool_use',
            id: segment.id,
            name: segment.name,
            input: cut.truncated ? cut.text : segment.input ?? null,
            server: segment.server ?? false,
            ...(cut.truncated ? { truncated: true } : {})
        };
    } else if (segment.type === 'tool_result') {
        const cut = budget.take(segment.content);
        view = {
            type: 'tool_result',
            toolUseId: segment.toolUseId,
            content: cut.text,
            isError: segment.isError ?? false,
            server: segment.server ?? false,
            ...(cut.truncated ? { truncated: true } : {})
        };
    } else {
        const cut = budget.take(segment.text);
        view = { type: segment.type, text: cut.text, ...(cut.truncated ? { truncated: true } : {}) };
    }
    return view;
}

/** What one turn contributes to a page, and where the page stopped if it filled up there. */
interface ITurnPage {
    /** The turn as this page returns it, or null when nothing of it fit. */
    view: Record<string, unknown> | null;
    /** Position to resume from when the page filled up at this turn; null when the turn finished. */
    next: number | null;
}

/**
 * Give the turn's text fields in the order the response lists them.
 *
 * `responseText` is included only when the turn has no transcript. The answer
 * text is already in the transcript's text segments, and returning it twice
 * would spend the page's text budget on a copy. The Query tab makes the same
 * choice when it replays a turn.
 *
 * @param record - The stored turn.
 * @returns Each field's response name and its full text, or null when absent.
 */
function turnTextFields(record: IAiQueryRecord): Array<[string, string | null | undefined]> {
    const hasTranscript = (record.transcript ?? []).length > 0;
    return [
        ['prompt', record.prompt],
        ['expandedPrompt', record.expandedPrompt],
        ['responseText', hasTranscript ? null : record.responseText],
        ['errorMessage', record.errorMessage]
    ];
}

/**
 * Build the part of one stored turn that belongs on the current page.
 *
 * A transcript can be far larger than one response may carry, so the tool
 * reads it in pages. Every turn takes one position for its text fields and one
 * per transcript segment, numbered across the whole response, and `start`
 * says which position this page begins at. The text fields come first, so the
 * prompt and its expansion always arrive before the transcript spends the
 * budget. A turn whose text fields were returned on an earlier page is marked
 * `continued` and leaves them out.
 *
 * Before taking each item the builder checks it fits in what is left of the
 * page. When it does not, the page ends there and `next` is that item's
 * position, so an item is never cut by the page total and the next call
 * returns it whole. The first item on a page is always taken, which keeps a
 * caller from looping on a page that can never fill.
 *
 * `toolAllowlist` keeps the record's three states (`null` unrestricted, `[]`
 * none, a list) and reports an absent field as `toolAllowlistKnown: false`,
 * because an old record without it does not mean unrestricted.
 *
 * @param record - The stored turn.
 * @param firstPosition - Position of this turn's text fields across the response.
 * @param start - Position the page begins at, from the caller's `start`.
 * @param budget - The page's shared text budget.
 * @param pageEmpty - True when nothing is on the page yet, so the first item is taken regardless of size.
 * @returns The turn's view for this page, and where to resume if the page filled up here.
 */
function toTurnPage(
    record: IAiQueryRecord,
    firstPosition: number,
    start: number,
    budget: TextBudget,
    pageEmpty: boolean
): ITurnPage {
    const transcript = record.transcript ?? [];
    let mustTake = pageEmpty;
    let next: number | null = null;
    let textView: Record<string, unknown> | null = null;

    if (start <= firstPosition) {
        const fields = turnTextFields(record);
        const cost = fields.reduce((sum, [, text]) => sum + (typeof text === 'string' ? budget.cost(text) : 0), 0);
        if (mustTake || budget.fits(cost)) {
            const cutFields: string[] = [];
            textView = {};
            for (const [name, text] of fields) {
                let kept: string | null = null;
                if (typeof text === 'string') {
                    const cut = budget.take(text);
                    if (cut.truncated) {
                        cutFields.push(name);
                    }
                    kept = cut.text;
                }
                textView[name] = kept;
            }
            textView.cutFields = cutFields;
            mustTake = false;
        } else {
            next = firstPosition;
        }
    }

    const segmentStart = Math.max(0, start - firstPosition - 1);
    const segments: Array<Record<string, unknown>> = [];
    if (next === null) {
        for (let index = segmentStart; index < transcript.length; index++) {
            const segment = transcript[index];
            if (!mustTake && !budget.fits(budget.cost(segmentText(segment)))) {
                next = firstPosition + 1 + index;
                break;
            }
            segments.push(toSegmentView(segment, budget));
            mustTake = false;
        }
    }

    const view = textView !== null || segments.length > 0
        ? {
            ...toRunMetadata(record),
            toolAllowlistKnown: record.toolAllowlist !== undefined,
            toolAllowlist: record.toolAllowlist ?? null,
            continued: textView === null,
            ...(textView ?? {}),
            segmentStart,
            segmentCount: transcript.length,
            transcript: segments
        }
        : null;
    return { view, next };
}

/**
 * Build the two prompt-run tools against the query history service.
 *
 * Takes only the three read methods the tools call, so a test can supply a
 * small fake and the tools cannot reach `append`.
 *
 * @param history - The query history service the tools read through.
 * @param logger - Module-scoped logger for unexpected failures.
 * @returns The tools, in the order the admin page lists them.
 */
export function buildPromptRunAiTools(
    history: Pick<AiQueryHistoryService, 'list' | 'get' | 'getConversation'>,
    logger: ISystemLogService
): IAiTool[] {
    const listRuns: IAiTool = {
        name: AI_TOOL_NAMES.listRuns,
        description:
            'List past prompt runs one page at a time, newest first. Each run has id, conversationId, mode, model, status, outcome, stopReason, createdAt, completedAt, costUsd, usage (token counts), promptPreview (the first 200 characters of the prompt as typed, variables unexpanded), promptChars, toolCalls, and hasTranscript. ' +
            `Use to find a run to open with ${AI_TOOL_NAMES.getRun}, or to see which recent runs failed or stopped early. Answers, transcripts, and error messages are not included. ` +
            `Parameters: limit (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}); offset (runs to skip from the newest, default 0). Returns total, offset, limit, returned, nextOffset (null on the last page), and runs[]. ` +
            SHARED_DESCRIPTION,
        capability: LIST_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which page of runs to return.',
            properties: {
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Runs per page. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` },
                offset: { type: 'integer', minimum: 0, maximum: MAX_OFFSET, description: 'Runs to skip from the newest. Pass the previous page\'s nextOffset to continue.' }
            },
            additionalProperties: false
        },
        inputExamples: [
            {},
            { limit: 50, offset: 50 }
        ],
        handler: async (input) => runAiToolCall(logger, AI_TOOL_NAMES.listRuns, FAILURE_MESSAGE, async () => {
            const limit = readInteger(input.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
            const offset = readInteger(input.offset, 'offset', 0, 0, MAX_OFFSET);
            const page = await history.list({ limit, offset });
            const nextOffset = offset + page.records.length;
            return {
                total: page.total,
                offset,
                limit,
                returned: page.records.length,
                nextOffset: nextOffset < page.total && page.records.length > 0 ? nextOffset : null,
                runs: page.records.map(toListEntry)
            };
        })
    };

    const getRun: IAiTool = {
        name: AI_TOOL_NAMES.getRun,
        description:
            'Get the full transcript of one prompt run: the prompt as typed, the prompt with its variables expanded (secret variables stay as {%name%} tokens), any error message, the tool allowlist it ran with, and the ordered transcript of thinking, answer text, tool calls with their arguments, and tool results. ' +
            'The answer is in the transcript\'s text segments; responseText is filled only for an old run that has no transcript. ' +
            `Pass a run id to read that one turn, or a conversation id to read every turn of the chat, oldest first (at most ${MAX_TURNS} turns). Ids come from ${AI_TOOL_NAMES.listRuns}. ` +
            `A long run comes back in pages of about ${MAX_TOTAL_CHARS} characters. When next is not null, call again with the same id and start set to next to read the rest; repeat until next is null. ` +
            'Each turn takes one position for its text fields (prompt, expandedPrompt, responseText, errorMessage), which always come first, plus one position per transcript segment. ' +
            'A turn whose text fields arrived on an earlier page is marked continued and leaves them out; segmentStart is the index of its first segment on this page and segmentCount its total. ' +
            `Each text field is cut to ${MAX_FIELD_CHARS} characters; a cut segment is marked truncated, a turn's cutFields names its cut text fields, and truncatedFields counts every cut on the page. ` +
            'Parameters: id (required, a run id or conversation id); start (optional, the next value from the previous page, default 0). Returns found, matchedBy (run or conversation), start, next, turns[], turnsTruncated, and truncatedFields; found is false when nothing has that id. ' +
            SHARED_DESCRIPTION,
        capability: GET_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'The run or conversation to read, and where to resume.',
            properties: {
                id: { type: 'string', description: `A run id or a conversation id from ${AI_TOOL_NAMES.listRuns}.` },
                start: { type: 'integer', minimum: 0, maximum: MAX_OFFSET, description: 'Position to resume from. Pass the previous page\'s next value; omit for the first page.' }
            },
            required: ['id'],
            additionalProperties: false
        },
        inputExamples: [
            { id: '3f2b8c1e-6a4d-4e9b-9c7a-1d5e0f8a2b6c' },
            { id: '3f2b8c1e-6a4d-4e9b-9c7a-1d5e0f8a2b6c', start: 24 }
        ],
        handler: async (input) => runAiToolCall(logger, AI_TOOL_NAMES.getRun, FAILURE_MESSAGE, async () => {
            const id = readId(input.id);
            const start = readInteger(input.start, 'start', 0, 0, MAX_OFFSET);
            const single = await history.get(id);
            const records = single ? [single] : await history.getConversation(id);
            const budget = new TextBudget(MAX_TOTAL_CHARS, MAX_FIELD_CHARS);
            const turns: Array<Record<string, unknown>> = [];
            let position = 0;
            let next: number | null = null;
            for (const record of records.slice(0, MAX_TURNS)) {
                const end = position + 1 + (record.transcript ?? []).length;
                if (end > start) {
                    const page = toTurnPage(record, position, start, budget, turns.length === 0);
                    if (page.view) {
                        turns.push(page.view);
                    }
                    next = page.next;
                }
                if (next !== null) {
                    break;
                }
                position = end;
            }
            return {
                found: records.length > 0,
                matchedBy: single ? 'run' : records.length > 0 ? 'conversation' : null,
                start,
                next,
                turns,
                turnsTruncated: records.length > MAX_TURNS,
                truncatedFields: budget.truncatedFields
            };
        })
    };

    return [listRuns, getRun];
}
