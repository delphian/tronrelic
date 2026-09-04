'use client';

/**
 * @fileoverview Query tab — the core-owned, provider-neutral AI chat surface on
 * the /system/ai-tools dashboard. A multi-turn conversation streamed over the
 * shared core socket: each send mints a client-side `queryId`, POSTs the prompt
 * with the prior turns as history, and appends the streamed deltas to a pending
 * assistant turn by filtering the GLOBAL `ai-tools:query-stream` event on that
 * id. A model picker reads `GET /query/providers` (graceful when empty), and a
 * history view groups past records by `conversationId` so any thread can be
 * reopened into the transcript. Like the sibling tabs this is an interactive
 * admin client surface, not an SSR-first public component — loading states are
 * appropriate for its secondary data and user-triggered sends.
 *
 * A per-run tool allowlist (a dropdown in the composer toolbar) narrows which
 * tools the next send may call. It defaults to no tools — least privilege — so a
 * manual query is inert until the operator deliberately grants a tool for that
 * run. Being one-shot, it has no three-state contract to preserve: the explicit
 * selection is sent verbatim on every send (`[]` = no tools; a name list = that
 * subset), and a scoped lethal-trifecta preview updates while the dropdown is open.
 *
 * This card is also the **saved-prompt editor**. The library is a dropdown beside
 * the header label; picking a prompt starts a fresh chat and loads that prompt's
 * text into the composer, its model pin into the picker, its allowlist into the
 * tools dropdown, and its triggers into the editor below — so one Save writes the
 * whole document and there is no separate modal. Three consequences follow from
 * the composer doubling as the body field, and each is enforced below:
 *
 * - **Send does not clear the composer while a prompt is loaded.** The text is
 *   the prompt body; clearing it would empty what Save writes. Plain chat with no
 *   prompt loaded still clears as before.
 * - **The tool selection is sticky while a prompt is loaded**, because it *is*
 *   that prompt's allowlist rather than a one-shot grant. The one-shot
 *   clear-after-send applies only to plain chat.
 * - **The allowlist keeps its three-state contract.** `undefined` means "every
 *   enabled tool, kept current" and is only pre-filled for display; `toolsTouched`
 *   records whether the operator really engaged the picker, so an untouched save
 *   writes `null` instead of freezing today's enabled set.
 *
 * The model picker spans every registered provider so a prompt can pin a model on
 * a non-active one. An interactive send always runs on the *active* provider, so a
 * pin belonging to a different provider is deliberately not forwarded as the
 * per-send model override — it still saves onto the prompt for its autonomous runs.
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Send, Bot, User, AlertCircle, X, Copy, CheckCircle, Plus, History, MessageSquare, RefreshCw, ChevronDown, ChevronRight, Brain, Wrench, CornerDownRight, Info, Bookmark, Trash2, AlertTriangle } from 'lucide-react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type { IAiConversationMessage, IAiQueryRecord, IAiStreamChunk, IAiToolInfo, IAiToolResultSegment, IAiTranscriptSegment, ISavedPrompt, IToolInvocationRecord, ITrifectaStatus } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Select } from '../../../../../components/ui/Select';
import { Textarea } from '../../../../../components/ui/Textarea';
import { Badge } from '../../../../../components/ui/Badge';
import { IconButton } from '../../../../../components/ui/IconButton';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { getSocket } from '../../../../../lib/socketClient';
import { SlideOver } from '../../../../../components/ui/SlideOver';
import {
    submitQuery,
    cancelQuery,
    getQueryHistory,
    getConversation,
    getQueryProviders,
    listActivity,
    listTools,
    getTrifectaPreview,
    runSavedPromptNow,
    listSavedPrompts,
    saveSavedPrompt,
    deleteSavedPrompt,
    listPromptTriggerHooks,
    type IAiProviderModels,
    type IBindableHookInfo,
    type IStreamAck
} from '../../../../../modules/ai-tools';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { InvocationDetailPanel } from '../components/InvocationDetailPanel';
import { InvocationTable } from '../components/InvocationTable';
import { ToolAllowlistDropdown } from '../components/ToolAllowlistDropdown';
import { SavedPromptSelector } from '../components/SavedPromptSelector';
import { PromptEditorBar } from './PromptEditorBar';
import { PromptTriggersEditor } from './PromptTriggersEditor';
import {
    type ITriggerDraft,
    toTriggerDrafts,
    toTriggerRequests,
    hasInvalidTriggerDraft,
    encodeModelPin,
    decodeModelPin,
    resolveToolAllowlistForSave,
    isPromptDirty
} from './savedPromptDraft';
import pageStyles from '../page.module.scss';
import promptStyles from './PromptEditor.module.scss';
import styles from './QueryTab.module.scss';

/** WebSocket event carrying a streamed AI response chunk to the dashboard. */
const QUERY_STREAM_EVENT = 'ai-tools:query-stream';

/** Number of history records pulled for the grouped conversation list. */
const HISTORY_LIMIT = 100;

/**
 * How often (ms) the saved-prompt list is refetched while at least one trigger
 * is enabled, so a `lastRunAt` written by the backend scheduler appears without
 * a page refresh. There is no WebSocket signal for an autonomous run, so this
 * poll is the refresh channel; the backend job ticks every two minutes, so a 30s
 * cadence surfaces a new run quickly while staying light. Gated on there being
 * an active trigger, so an all-manual prompt library never polls.
 */
const SAVED_PROMPT_REFRESH_MS = 30_000;

/**
 * Singleton unified processor converting assistant markdown to sanitized HTML.
 * The pipeline parses markdown (remark-parse + GFM), bridges to a HAST tree via
 * remark-rehype WITHOUT `allowDangerousHtml` so any raw HTML the model emits is
 * dropped, then runs rehype-sanitize (GitHub-flavored default schema) to strip
 * dangerous elements/attributes before serializing. This is real sanitization —
 * required because the output is rendered via dangerouslySetInnerHTML on
 * AI-generated, untrusted-influenced content. The deprecated remark-html
 * `{ sanitize: true }` option it replaces is a no-op in remark-html v13+.
 */
const markdownProcessor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeStringify);

/**
 * One turn in the chat transcript. `pending` marks the assistant turn currently
 * receiving stream chunks (drives the blinking cursor and the Stop control);
 * `error` carries a stream failure surfaced inside the bubble; `usage`/`model`
 * are captured at finalize so per-turn detail stays correct mid-conversation.
 */
interface ChatTurn {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    pending?: boolean;
    error?: string | null;
    model?: string;
    usage?: IAiStreamChunk['usage'] | null;
    /**
     * Provider-estimated USD cost of this turn, captured from the terminal
     * `done` chunk (or a reopened history record). `null`/absent when the
     * provider could not price it; the provider owns the rate card, so core
     * only displays the number it is handed.
     */
    costUsd?: number | null;

    /**
     * Ordered transcript of an assistant turn — thinking, answer text, tool
     * calls, and tool results — captured from the terminal `done` chunk on a
     * live turn or rebuilt from a reopened history record. When present it is
     * rendered in place of `content`, so the bubble shows the whole turn rather
     * than only the final answer. Absent on a user turn, on a turn still
     * streaming, and on legacy records written before transcripts existed (which
     * fall back to `content`).
     */
    segments?: IAiTranscriptSegment[];

    /**
     * Tool names this send was allowed to call — the composer's per-run
     * allowlist, captured at send time. Recorded on the user turn because the
     * grant belongs to the prompt, not the answer: it drives the per-turn tool
     * chips and is what "save this prompt with its tools" persists. A turn
     * reopened from history has no value here, since the allowlist is not part
     * of the stored query record; those turns show only the tools the assistant
     * actually called, recovered from its transcript.
     */
    tools?: string[];
}

/** A run of consecutive history records sharing one `conversationId`. */
interface ConversationGroup {
    conversationId: string;
    turns: number;
    firstPrompt: string;
    lastAt: string;
    /**
     * Execution mode of the group's latest turn, taken from the first record
     * encountered (newest-first). Drives the `Scheduled` badge so an operator
     * can tell an autonomous cron run apart from a query they typed — the only
     * cross-mode distinction the grouped list surfaces.
     */
    mode: IAiQueryRecord['mode'];
    /**
     * Terminal status of the group's latest turn, taken from the first record
     * encountered (newest-first). Without it the list cannot say whether a run
     * succeeded, so a failed scheduled prompt looked identical to a clean one
     * and an operator had to reopen every conversation to find the failure. A
     * group whose older turns failed but whose latest succeeded reads as
     * `completed`, which is consistent with `mode` and `lastAt` already
     * describing the newest turn rather than the whole run.
     */
    status: IAiQueryRecord['status'];
    /**
     * Failure reason of that latest turn, or null when it succeeded. Carried on
     * the group so the row can show why a run failed on hover, rather than
     * making the operator open the conversation to read one sentence.
     */
    errorMessage: string | null;
    /**
     * Estimated total USD cost of the conversation, summed across every priced
     * turn at the rates captured when each turn ran. `null` when not a single
     * turn could be priced, so the row shows a dash rather than a misleading
     * $0.00 — mirrors the live transcript's sum-or-hide behavior.
     */
    costUsd: number | null;
}

/**
 * Generate an RFC-4122 v4 UUID, preferring the native crypto implementation and
 * falling back to a Math.random() generator. `crypto.randomUUID` is only defined
 * in secure contexts (HTTPS or localhost), so a plain-HTTP staging deployment
 * would otherwise throw when minting turn, conversation, and query ids. Called
 * only from event handlers, never during render, so the non-deterministic
 * fallback cannot cause a hydration mismatch.
 *
 * @returns A v4 UUID string.
 */
function generateUUID(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Convert assistant markdown to sanitized HTML, appending a blinking cursor span
 * while the turn is still streaming. Falls back to HTML-escaped preformatted text
 * if remark throws, so a malformed partial never injects raw markup.
 *
 * @param text - Raw assistant markdown (possibly partial).
 * @param pending - Whether the turn is still receiving chunks.
 * @returns Sanitized HTML for dangerouslySetInnerHTML.
 */
function renderAssistantHtml(text: string, pending: boolean): string {
    let html: string;
    try {
        html = String(markdownProcessor.processSync(text));
        if (pending) {
            html += `<span class="${styles.cursor}"></span>`;
        }
    } catch {
        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        html = `<pre>${escaped}</pre>`;
    }
    return html;
}

/**
 * Pretty-print a tool's JSON argument or result payload for display. Tool input
 * arrives as an arbitrary object the model produced and a result as a string the
 * tool returned; both read best as indented JSON when they parse as such, and as
 * raw text otherwise. Kept tolerant — a transcript must render even if a payload
 * is malformed — so any stringify failure degrades to `String(value)` rather
 * than throwing inside render.
 *
 * @param value - The tool input object, or the tool result string.
 * @returns A human-readable, multi-line string safe to drop into a `<pre>`.
 */
function formatToolPayload(value: unknown): string {
    let formatted: string;
    if (typeof value === 'string') {
        try {
            formatted = JSON.stringify(JSON.parse(value), null, 2);
        } catch {
            formatted = value;
        }
    } else {
        try {
            formatted = JSON.stringify(value ?? null, null, 2);
        } catch {
            formatted = String(value);
        }
    }
    return formatted;
}

/**
 * Fold a streamed text delta into a turn's live transcript, extending the run of
 * prose already in progress or starting a new one after a tool call.
 *
 * A streaming turn builds the same segment structure the settled transcript
 * uses, so the answer and the tool activity render in one ordered list rather
 * than prose in one place and tool cards appended somewhere after it. Text
 * merges into a trailing text segment because the provider streams prose token
 * by token — a segment per delta would fragment one paragraph into dozens of
 * separately-rendered Markdown blocks.
 *
 * Returns a new array rather than mutating, since the caller stores the result
 * in React state where an in-place edit would not re-render.
 *
 * @param segments - The turn's live segments so far, if any.
 * @param text - The delta just received.
 * @returns The segments with the delta folded in.
 */
function appendLiveText(segments: IAiTranscriptSegment[] | undefined, text: string): IAiTranscriptSegment[] {
    const next = [...(segments ?? [])];
    const last = next[next.length - 1];
    if (last && last.type === 'text') {
        next[next.length - 1] = { type: 'text', text: last.text + text };
    } else {
        next.push({ type: 'text', text });
    }
    return next;
}

/**
 * Render an assistant turn's structured transcript — the thinking, tool calls,
 * tool results, and answer text in the order they occurred. This is what lets a
 * conversation (live, or reopened from history) show the whole turn instead of
 * only its final answer: history persists no other structure, so without this
 * the thinking and tool activity would be invisible.
 *
 * Every non-prose event renders as a **collapsed** `<details>` — thinking, a
 * tool call and its result, an unpaired result. The answer is what the reader
 * came for, and a turn that calls three tools would otherwise bury it under
 * screens of JSON. The summary row carries what matters at a glance (the tool
 * name, whether it is still running, whether it failed), so nothing has to be
 * expanded to know whether it needs to be.
 *
 * A call and the result that answered it are one event, so the result nests
 * inside the call's own card — arguments payload, then a "Tool result" label,
 * then the result payload carrying the success/error accent — rather than
 * sitting in a sibling block the reader has to re-pair by eye. Answer text uses
 * the same sanitized-Markdown pipeline whether it is streaming or replayed, so
 * the prose reads identically either way.
 *
 * @param segments - The turn's ordered transcript segments.
 * @param recordsById - The conversation's audit records keyed by their `toolUseId`,
 *   so a tool_use segment can resolve its exact invocation record. Absent (or a
 *   miss) simply renders the call without a detail affordance — legacy records and
 *   the pre-`toolUseId` provider degrade gracefully rather than breaking.
 * @param onSelectRecord - Opens the matched record's detail panel. Omitted when the
 *   host has no detail surface (nothing becomes clickable).
 * @param pending - Whether the turn is still streaming. Drives the cursor on the
 *   trailing prose and the "running" hint on a call whose result has not landed,
 *   which is the difference between "this tool is working" and "this tool
 *   answered with nothing".
 * @returns The rendered transcript.
 */
function AssistantSegments({ segments, recordsById, onSelectRecord, pending = false }: {
    segments: IAiTranscriptSegment[];
    recordsById?: Map<string, IToolInvocationRecord>;
    onSelectRecord?: (record: IToolInvocationRecord) => void;
    pending?: boolean;
}) {
    // Index each result by the call it answered so the call can render it inline.
    // A result whose `toolUseId` matches no call in this transcript — truncated
    // history, or a provider that emitted the pairing id inconsistently — stays
    // unclaimed and still renders as its own block below, so nothing a turn
    // produced is silently dropped from the transcript.
    const resultsByToolUseId = new Map<string, { segment: IAiToolResultSegment; index: number }>();
    const callIds = new Set<string>();
    segments.forEach((segment, index) => {
        if (segment.type === 'tool_use' && segment.id) {
            callIds.add(segment.id);
        } else if (segment.type === 'tool_result' && segment.toolUseId && !resultsByToolUseId.has(segment.toolUseId)) {
            resultsByToolUseId.set(segment.toolUseId, { segment, index });
        }
    });

    // The exact results that will be drawn inside a call's card. Skipping by
    // *position* rather than by `toolUseId` is what keeps the no-silent-drop
    // rule honest: only the first result per id is claimed inline, so a second
    // result carrying the same id — which an id-based skip would swallow
    // entirely — still renders below as its own block.
    const claimedResultIndices = new Set<number>();
    for (const id of callIds) {
        const claimed = resultsByToolUseId.get(id);
        if (claimed) {
            claimedResultIndices.add(claimed.index);
        }
    }

    return (
        <div className={styles.segments}>
            {segments.map((segment, index) => {
                // Key a tool card by the call it belongs to, not by its position.
                // When the turn settles, the authoritative transcript replaces the
                // live one and can interleave segments the live stream never sent
                // (thinking blocks), shifting every index after them. Under
                // positional keys React would reuse the DOM node — and with it the
                // open/closed state of an uncontrolled <details> — for whatever
                // segment now occupies that slot, so a card the reader had just
                // expanded would silently start showing a different payload. Text
                // and thinking carry no id and keep the positional key; neither
                // holds state a shift can corrupt (text is not collapsible, and
                // thinking only ever moves relative to other thinking).
                const key = segment.type === 'tool_use' && segment.id
                    ? `use:${segment.id}`
                    : segment.type === 'tool_result' && segment.toolUseId
                        ? `result:${segment.toolUseId}:${index}`
                        : `segment:${index}`;
                if (segment.type === 'thinking') {
                    return (
                        <details key={key} className={styles.thinking}>
                            <summary className={styles.thinking_summary}>
                                <ChevronRight size={14} className={styles.disclosure_chevron} aria-hidden="true" />
                                <Brain size={14} /> Thinking
                            </summary>
                            <div className={styles.thinking_body}>{segment.text}</div>
                        </details>
                    );
                }
                if (segment.type === 'tool_use') {
                    // Resolve this call's exact audit record by the provider-neutral
                    // toolUseId. A hit turns the header into a link to the full
                    // invocation detail (status, duration, cost, forensic error,
                    // screen verdict) the transcript alone can't show.
                    const auditRecord = segment.id ? recordsById?.get(segment.id) : undefined;
                    const result = segment.id ? resultsByToolUseId.get(segment.id)?.segment : undefined;
                    return (
                        <details key={key} className={styles.tool_call}>
                            <summary className={styles.tool_call_header}>
                                <ChevronRight size={14} className={styles.disclosure_chevron} aria-hidden="true" />
                                <Wrench size={14} />
                                <span className={styles.tool_call_name}>{segment.name || 'tool'}</span>
                                {segment.server && <Badge tone="info">server</Badge>}
                                {/* The outcome has to survive the collapse: without it a
                                    reader would have to open every card to find the one
                                    that failed, or to tell a slow call from a finished one. */}
                                {result?.isError && <Badge tone="danger">error</Badge>}
                                {!result && pending && (
                                    <span className={styles.tool_call_status}>running…</span>
                                )}
                                {auditRecord && onSelectRecord && (
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        className={styles.tool_call_action}
                                        onClick={(event) => {
                                            // The button lives inside the <summary>, whose
                                            // default action is to toggle the card. Opening
                                            // the audit panel is a different intent, so stop
                                            // the click from also collapsing what the reader
                                            // is looking at.
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onSelectRecord(auditRecord);
                                        }}
                                        aria-label={`View the audit record for the ${segment.name || 'tool'} call`}
                                    >
                                        <Info size={14} /> Details
                                    </Button>
                                )}
                            </summary>
                            <pre className={styles.tool_payload}>{formatToolPayload(segment.input)}</pre>
                            {result && (
                                <>
                                    <div className={`${styles.tool_call_header} ${styles.tool_result_header}`}>
                                        <CornerDownRight size={14} />
                                        <span className={styles.tool_call_name}>{result.isError ? 'Tool error' : 'Tool result'}</span>
                                    </div>
                                    <pre
                                        className={`${styles.tool_payload} ${styles.tool_result_payload} ${result.isError ? styles['tool_result_payload--error'] : ''}`}
                                    >
                                        {formatToolPayload(result.content)}
                                    </pre>
                                </>
                            )}
                        </details>
                    );
                }
                if (segment.type === 'tool_result') {
                    // This exact result is already drawn inside its call's card —
                    // skip the duplicate. Any other result, including a second one
                    // sharing the same `toolUseId`, falls through and renders here.
                    if (claimedResultIndices.has(index)) {
                        return null;
                    }
                    return (
                        <details
                            key={key}
                            className={`${styles.tool_result} ${segment.isError ? styles['tool_result--error'] : ''}`}
                        >
                            <summary className={styles.tool_call_header}>
                                <ChevronRight size={14} className={styles.disclosure_chevron} aria-hidden="true" />
                                <CornerDownRight size={14} />
                                <span className={styles.tool_call_name}>{segment.isError ? 'Tool error' : 'Tool result'}</span>
                            </summary>
                            <pre className={styles.tool_payload}>{formatToolPayload(segment.content)}</pre>
                        </details>
                    );
                }
                // The blinking cursor belongs on the prose the model is writing
                // right now — the last segment of a still-streaming turn. Putting
                // it on an earlier text run would park a cursor above a finished
                // tool call.
                const isTrailingText = pending && index === segments.length - 1;
                return (
                    <div
                        key={key}
                        className={styles.turn_markdown}
                        // Assistant text is sanitized by the rehype-sanitize pipeline in renderAssistantHtml.
                        dangerouslySetInnerHTML={{ __html: renderAssistantHtml(segment.text, isTrailingText) }}
                    />
                );
            })}
        </div>
    );
}

/**
 * Key tool-invocation audit records by their provider-neutral `toolUseId` so a
 * transcript's tool_use segment resolves to its exact record in O(1). Shared by
 * the open conversation and by each expanded History row, which load their
 * records from different places but link them to a transcript the same way.
 * Records without a `toolUseId` (legacy rows, or a provider that predates the
 * field) are skipped; their calls simply render without a detail link.
 *
 * @param records - Audit records for one conversation, in any order.
 * @returns The records that carry a `toolUseId`, keyed by it.
 */
function indexByToolUseId(records: IToolInvocationRecord[]): Map<string, IToolInvocationRecord> {
    const map = new Map<string, IToolInvocationRecord>();
    for (const record of records) {
        if (record.toolUseId) {
            map.set(record.toolUseId, record);
        }
    }
    return map;
}

/** Stable empty index for a row whose tool records have not loaded, so an
 *  expanded transcript never gets a fresh Map identity on every render. */
const NO_TOOL_RECORDS: Map<string, IToolInvocationRecord> = new Map();

/**
 * Select the audit records a transcript has no route to. A record is reachable
 * from a transcript only when its `toolUseId` matches a `tool_use` segment, so a
 * record written without one — a legacy row, or a provider that never emitted the
 * pairing id — carries no "Details" link and would be unreachable otherwise.
 * Listing exactly those leftovers keeps the transcript the primary account of
 * what ran while making sure no invocation goes missing.
 *
 * Shared by the live chat and by an expanded History row so neither can start
 * double-listing a call that the transcript already shows inline.
 *
 * @param turns - The turns rendered above the leftovers, live or replayed.
 * @param records - The conversation's tool-invocation audit records.
 * @returns The records the transcript cannot reach, in their original order.
 */
function selectUnlinkedRecords(turns: ChatTurn[], records: IToolInvocationRecord[]): IToolInvocationRecord[] {
    const linked = new Set<string>();
    for (const turn of turns) {
        for (const segment of turn.segments ?? []) {
            if (segment.type === 'tool_use' && segment.id) {
                linked.add(segment.id);
            }
        }
    }
    return records.filter(record => !record.toolUseId || !linked.has(record.toolUseId));
}

/**
 * Rebuild a stored conversation into the alternating user/assistant turns the
 * transcript renders. Shared by "Open in chat" and by an expanded History row so
 * the two cannot drift: a turn that reads one way in chat has to read the same
 * way in history, since both are replaying the identical persisted record.
 *
 * A failed turn carries no answer text and no transcript, so without the
 * fallback below it would render as a blank assistant bubble that looks like the
 * model simply said nothing. Surfacing `errorMessage` — or a plain note when the
 * record has neither text, structure, nor a reason — is what makes a failure
 * legible at all.
 *
 * @param records - One conversation's turns, oldest first.
 * @returns Chat turns ready to render, two per stored record.
 */
function recordsToChatTurns(records: IAiQueryRecord[]): ChatTurn[] {
    const rebuilt: ChatTurn[] = [];
    for (const record of records) {
        rebuilt.push({ id: generateUUID(), role: 'user', content: record.prompt });
        // A turn has a body when it left answer text OR a structured transcript
        // (a tool-only round can finish with no final text yet still have plenty
        // to show). Only a truly empty, non-failed record falls back to the note.
        const hasBody = !!record.responseText || (record.transcript?.length ?? 0) > 0;
        rebuilt.push({
            id: generateUUID(),
            role: 'assistant',
            content: record.responseText ?? '',
            model: record.model,
            usage: record.usage,
            costUsd: record.costUsd ?? null,
            error: record.errorMessage ?? (hasBody ? null : 'No response recorded'),
            ...(record.transcript && record.transcript.length > 0 ? { segments: record.transcript } : {})
        });
    }
    return rebuilt;
}

/**
 * Render one assistant turn's body: its transcript segments or markdown answer,
 * the failure reason when the turn failed, and the usage, model, and cost line.
 * Extracted so the live chat and an expanded History row show a past turn in
 * identical detail. Keeping one copy is what guarantees they agree — the two
 * surfaces previously shared no markup, which is how History came to show a
 * conversation's tool calls but never its answer, its error, or its cost.
 *
 * Chat-only affordances stay with the caller. The copy button, the save-as-prompt
 * bookmark, and the granted-tool chips are authoring controls that belong to the
 * composer's surface, not to a read-only replay of a past run.
 *
 * @param turn - The assistant turn to render, live or rebuilt from history.
 * @param recordsById - Audit records keyed by `toolUseId`, so a tool call in the
 *        transcript can open its own invocation detail.
 * @param onSelectRecord - Opens the invocation detail slide-over for one record.
 * @param modelLabel - Model id to display name, so the usage line names a model
 *        the way the provider's own picker does rather than by raw id.
 * @returns The turn's body sections, omitting any the record has no data for.
 */
function AssistantTurnBody({ turn, recordsById, onSelectRecord, modelLabel }: {
    turn: ChatTurn;
    recordsById: Map<string, IToolInvocationRecord>;
    onSelectRecord: (record: IToolInvocationRecord) => void;
    modelLabel: Map<string, string>;
}) {
    const usage = turn.usage;
    return (
        <>
            {turn.segments && turn.segments.length > 0 ? (
                // Any turn with structure renders it: a settled one (live `done` or
                // reopened from history) shows its full transcript, and a streaming
                // one shows what has settled so far, so a tool call is visible while
                // it runs rather than only once the turn ends. The audit-record map
                // lets each tool call deep-link to its record.
                <AssistantSegments
                    segments={turn.segments}
                    recordsById={recordsById}
                    onSelectRecord={onSelectRecord}
                    pending={!!turn.pending}
                />
            ) : (
                <div
                    className={styles.turn_markdown}
                    // Assistant output is sanitized by the rehype-sanitize pipeline in renderAssistantHtml.
                    dangerouslySetInnerHTML={{ __html: renderAssistantHtml(turn.content, !!turn.pending) }}
                />
            )}

            {turn.error && (
                <div className={styles.turn_error}>
                    <AlertCircle size={14} />
                    <span>{turn.error}</span>
                </div>
            )}

            {usage && (
                <div className={styles.turn_usage}>
                    <span>{usage.inputTokens} in / {usage.outputTokens} out</span>
                    {(usage.cacheReadInputTokens ?? 0) > 0 && (
                        <span> · {usage.cacheReadInputTokens} cache read</span>
                    )}
                    {(usage.cacheCreationInputTokens ?? 0) > 0 && (
                        <span> · {usage.cacheCreationInputTokens} cache write</span>
                    )}
                    {turn.model && (
                        <span> · {modelLabel.get(turn.model) ?? turn.model}</span>
                    )}
                    {turn.costUsd != null && (
                        <span className={styles.turn_cost}> · ≈ {formatUsd(turn.costUsd)}</span>
                    )}
                </div>
            )}
        </>
    );
}

/**
 * Collapse a newest-first history page into conversation groups, one per run of
 * records sharing a `conversationId`. Records without a conversationId (one-shot
 * turns) are skipped — only multi-turn chats can be reopened. Within the
 * newest-first feed the first record of each group is the latest turn, so its
 * timestamp dates the group.
 *
 * @param records - History records, newest first.
 * @returns Conversation groups in newest-first order.
 */
function groupConversations(records: IAiQueryRecord[]): ConversationGroup[] {
    const order: string[] = [];
    const byId = new Map<string, ConversationGroup>();
    for (const record of records) {
        const id = record.conversationId;
        if (!id) {
            continue;
        }
        // Add this turn's priced cost, treating an unpriced turn as a no-op so
        // a partially-priced conversation still surfaces the sum of what could
        // be priced rather than collapsing to null.
        const turnCost = typeof record.costUsd === 'number' ? record.costUsd : null;
        const existing = byId.get(id);
        if (existing) {
            existing.turns += 1;
            if (turnCost !== null) {
                existing.costUsd = (existing.costUsd ?? 0) + turnCost;
            }
            // Records arrive newest-first, so an earlier record carries the
            // older prompt — keep it as the conversation's opening line.
            existing.firstPrompt = record.prompt;
        } else {
            order.push(id);
            // Records arrive newest-first, so this first sighting is the latest
            // turn — the one whose status and failure reason the row reports.
            byId.set(id, {
                conversationId: id,
                turns: 1,
                firstPrompt: record.prompt,
                lastAt: record.createdAt,
                mode: record.mode,
                status: record.status,
                errorMessage: record.errorMessage ?? null,
                costUsd: turnCost
            });
        }
    }
    return order.map(id => byId.get(id) as ConversationGroup);
}

/**
 * Format a provider-estimated USD cost for display, with precision that stays
 * useful at the sub-cent scale of a single turn while staying readable at the
 * dollar scale of a whole conversation. Mirrors the provider's own formatting so
 * the core Query tab reads identically to the plugin's query tool. The provider
 * computes the figure (it owns the rate card); core only renders it.
 *
 * @param amount - Cost in USD, or null/undefined when the turn was not priced.
 * @returns A display string (e.g. '$0.0042', '<$0.0001', '$1.27'), or '—'.
 */
function formatUsd(amount: number | null | undefined): string {
    if (amount === null || amount === undefined || Number.isNaN(amount)) {
        return '—';
    }
    if (amount <= 0) {
        return '$0.00';
    }
    if (amount < 0.0001) {
        return '<$0.0001';
    }
    if (amount < 1) {
        return `$${amount.toFixed(4)}`;
    }
    return `$${amount.toFixed(2)}`;
}

/** Name prefix for prompts saved straight from a chat turn. */
const TURN_PROMPT_NAME_PREFIX = 'Saved Prompt';

/**
 * Neutralise regex metacharacters so a plain string can be embedded in a pattern
 * literally. Needed because the turn-prompt pattern below is built from the
 * display prefix above; if that prefix ever gains a character like `(` or `.`,
 * an unescaped interpolation would compile into a pattern that quietly matches
 * the wrong names — or throws — instead of the literal text an operator sees.
 *
 * @param value - The literal text to embed; callers pass display strings that
 *   were never written with regex syntax in mind.
 * @returns The same text with every metacharacter backslash-escaped.
 */
function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matches an auto-generated turn-saved prompt name so its number can be read
 * back. Derived from `TURN_PROMPT_NAME_PREFIX` rather than repeating it, so the
 * generator and the parser cannot drift apart if the prefix ever changes.
 */
const TURN_PROMPT_NAME_PATTERN = new RegExp(`^${escapeRegex(TURN_PROMPT_NAME_PREFIX)} (\\d+)$`, 'i');

/**
 * Pick the next auto-generated name for a prompt saved from a chat turn. Saving
 * from a turn is a one-click action with nowhere to type a name, so the name has
 * to be derived — and it must not collide, because the backend enforces a
 * case-insensitive unique index and would reject a duplicate with a 409. Counting
 * up from the highest existing `Saved Prompt NN` gives a name that is stable for a
 * given list and never reuses a number still in play, even after earlier ones are
 * deleted.
 *
 * @param existing - The current saved prompts, whose names are scanned for the
 *   auto-generated pattern; names an operator typed are ignored.
 * @returns The next name, zero-padded to two digits (e.g. `Saved Prompt 03`).
 */
function nextTurnPromptName(existing: ISavedPrompt[]): string {
    let highest = 0;
    for (const prompt of existing) {
        const match = TURN_PROMPT_NAME_PATTERN.exec(prompt.name.trim());
        if (!match) {
            continue;
        }
        const value = Number.parseInt(match[1], 10);
        if (Number.isFinite(value) && value > highest) {
            highest = value;
        }
    }
    return `${TURN_PROMPT_NAME_PREFIX} ${String(highest + 1).padStart(2, '0')}`;
}

/**
 * Query tab content. Owns the chat transcript, the streaming lifecycle keyed by
 * a per-send `queryId`, the model picker, and the grouped history view.
 *
 * @returns The tab.
 */
export function QueryTab() {
    const { push } = useToast();
    const modal = useModal();
    const [messages, setMessages] = useState<ChatTurn[]>([]);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /**
     * Every registered AI provider with its model catalog. Spans providers (not
     * just the active one) because a saved prompt may pin a model on a provider
     * that is not currently the transport — the picker has to be able to offer it.
     */
    const [providers, setProviders] = useState<IAiProviderModels[]>([]);
    /**
     * The composer's model choice, encoded `providerId|model`; `''` = the active
     * provider's default. One control serves two purposes: the override for the
     * next interactive send, and — while a prompt is loaded — that prompt's
     * persisted pin.
     */
    const [modelOverride, setModelOverride] = useState<string>('');
    /** The full tool registry (enabled + disabled), backing the per-run allowlist picker. */
    const [tools, setTools] = useState<IAiToolInfo[]>([]);
    /**
     * Whether the tool-registry request is still in flight. Distinguishes "no
     * tools granted" from "not known yet": an unrestricted prompt's selection is
     * `[]` until the pre-fill runs, and `[]` is an explicit deny on the wire, so
     * a send during this window would run the test with no tools at all.
     */
    const [toolsLoading, setToolsLoading] = useState(true);
    /**
     * Tool names the next send is allowed to call. Defaults to none — a manual
     * query does nothing dangerous unless the operator grants a tool for that
     * run. Sent verbatim to the governor on every send: `[]` = no tools, a list =
     * that subset (no three-state contract, since a one-shot run persists nothing).
     */
    const [toolSelection, setToolSelection] = useState<string[]>([]);
    /** Whether the composer's Tools dropdown is open; gates the trifecta preview so it runs only when visible. */
    const [toolsOpen, setToolsOpen] = useState(false);
    /** Scoped lethal-trifecta verdict for the current selection, or null before the first preview resolves. */
    const [trifecta, setTrifecta] = useState<ITrifectaStatus | null>(null);
    /** Whether a trifecta preview request is in flight (drives the badge's pending state). */
    const [trifectaLoading, setTrifectaLoading] = useState(false);
    const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null);
    const [view, setView] = useState<'chat' | 'history'>('chat');
    const [conversations, setConversations] = useState<ConversationGroup[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    /** The saved-prompt library, backing the header selector and the editor. */
    const [savedPrompts, setSavedPrompts] = useState<ISavedPrompt[]>([]);
    /** Id of the user turn whose "save as prompt" write is in flight, or null when idle. */
    const [savingTurnId, setSavingTurnId] = useState<string | null>(null);

    /*
     * ---- Saved-prompt editor -------------------------------------------------
     * Whether the prompt bar is showing, which stored prompt it edits (null while
     * writing a brand-new one), and the drafts for the fields the composer does
     * not already own. Body, model, and tools live in the composer controls above
     * — that is the whole point of retiring the modal — so only the name and the
     * trigger rows need state of their own.
     */
    /** Whether a prompt is being edited; drives the bar and the triggers section. */
    const [editingPrompt, setEditingPrompt] = useState(false);
    /** Id of the stored prompt under edit, or null for one not yet created. */
    const [loadedPromptId, setLoadedPromptId] = useState<string | null>(null);
    /** The name field's draft value. */
    const [promptName, setPromptName] = useState('');
    /** The trigger rows as edited; saved together with everything else. */
    const [triggerDrafts, setTriggerDrafts] = useState<ITriggerDraft[]>([]);
    /** Whether the triggers editor is revealed beneath the composer. */
    const [triggersOpen, setTriggersOpen] = useState(false);
    /** Whether the single prompt save is in flight. */
    const [promptSaving, setPromptSaving] = useState(false);
    /**
     * Whether the operator actually engaged the Tools picker while editing this
     * prompt. The pre-fill seeds the selection to the full enabled set for
     * display, which is indistinguishable from a deliberate "select all"; this
     * flag records real intent so an untouched save of an unset prompt writes
     * `null` (all enabled, auto-updating) rather than freezing today's set.
     */
    const [toolsTouched, setToolsTouched] = useState(false);
    /** Declared hook seams a hook trigger may bind to, for the triggers editor. */
    const [bindableHooks, setBindableHooks] = useState<IBindableHookInfo[]>([]);
    /** Conversation ids whose full opening prompt is expanded inline in the history list. */
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
    /**
     * Per-conversation tool-invocation audit records for the history list, keyed
     * by conversationId and loaded lazily the first time a row is expanded. Kept
     * separate from {@link conversationRecords} (which backs the open chat) so an
     * expanded history row and the active conversation never overwrite each other.
     * Cached across collapse/re-expand and across a history Refresh, since a past
     * conversation's tool calls do not change on their own. Continuing that
     * conversation in chat does add to them, so `handleSend` drops the entry for
     * the conversation it just extended.
     */
    const [historyToolRecords, setHistoryToolRecords] = useState<Map<string, IToolInvocationRecord[]>>(() => new Map());
    /**
     * The replayed turns of each expanded history row, keyed by conversationId
     * and loaded by the same lazy fetch as the tool records above. Holding them
     * here is what lets a row show the answer, the failure reason, and the usage
     * line in place, instead of making the operator leave the list and reopen the
     * conversation in the chat view to see any of it. Cached across a collapse and
     * re-expand, which is safe only while the conversation stands still. It does
     * not stand still once it is reopened in chat and continued — the send appends
     * turns under the same id — so `handleSend` drops this entry and collapses the
     * row rather than letting a refreshed turn count sit beside an older
     * transcript. Growth from another browser tab is still not detected.
     */
    const [historyTurns, setHistoryTurns] = useState<Map<string, ChatTurn[]>>(() => new Map());
    /** Conversation ids whose history-row detail is currently loading. */
    const [historyToolLoading, setHistoryToolLoading] = useState<Set<string>>(() => new Set());
    /** Conversation ids whose history-row detail fetch failed, mapped to the error. */
    const [historyToolError, setHistoryToolError] = useState<Map<string, string>>(() => new Map());
    /**
     * Tool-invocation audit records for the open conversation, loaded from the
     * Activity feed scoped by conversationId. Backs the transcript's per-call
     * "Details" deep-links — the transcript itself shows what ran, so the chat
     * view carries no summary table over the records it can already reach. The
     * leftovers it cannot reach are listed separately (see {@link unlinkedRecords}).
     */
    const [conversationRecords, setConversationRecords] = useState<IToolInvocationRecord[]>([]);
    /** The audit record whose detail slide-over is open, or null when closed. */
    const [selectedRecord, setSelectedRecord] = useState<IToolInvocationRecord | null>(null);
    /**
     * Audit records keyed by their provider-neutral `toolUseId`, so a transcript
     * tool_use segment resolves to its exact invocation record in O(1). Records
     * without a `toolUseId` (legacy, or the pre-`toolUseId` provider) are skipped
     * — their calls simply render without a detail link.
     */
    const toolRecordsById = useMemo(() => indexByToolUseId(conversationRecords), [conversationRecords]);

    /**
     * Registry tool names actually invoked in answer to each user turn, keyed by
     * that turn's id. Read from the assistant turns that follow a prompt (up to
     * the next prompt), because the transcript is the only per-turn record of
     * what the model chose to call — the audit feed is conversation-scoped and
     * cannot say which prompt triggered a given call. Drives the "called" state
     * of the per-turn tool chips, and works identically for a live turn and one
     * reopened from history since both carry the same segments.
     *
     * Provider-hosted calls (`segment.server`) are excluded on purpose. They run
     * on the provider's own infrastructure and are exempt from the allowlist
     * entirely, so they are not grantable: showing one as a chip would imply an
     * allowlist entry that cannot exist, and — since this set is also what the
     * bookmark persists — naming one in a saved prompt's `toolAllowlist` would
     * resolve to no registered tool and fail the whole run.
     */
    const calledToolsByTurnId = useMemo(() => {
        const map = new Map<string, Set<string>>();
        messages.forEach((turn, index) => {
            if (turn.role !== 'user') {
                return;
            }
            const called = new Set<string>();
            for (let next = index + 1; next < messages.length && messages[next].role === 'assistant'; next += 1) {
                for (const segment of messages[next].segments ?? []) {
                    if (segment.type === 'tool_use' && segment.name && !segment.server) {
                        called.add(segment.name);
                    }
                }
            }
            map.set(turn.id, called);
        });
        return map;
    }, [messages]);

    /**
     * The tools each user turn is credited with, keyed by turn id: the grant
     * captured at send time unioned with the registry tools the answer actually
     * called. One source for both the chips a turn renders and the allowlist its
     * bookmark saves, so what an operator sees beside the bookmark is exactly
     * what the bookmark persists.
     *
     * The union is what makes a turn reopened from history saveable at all. The
     * grant is not part of the stored query record, so `turn.tools` is undefined
     * there and the transcript's calls are the only surviving evidence of what
     * that prompt was permitted to do. Crediting them reconstructs an allowlist
     * that is narrower than the original but sufficient to reproduce the run —
     * which is the point of saving it, and safer than widening to every enabled
     * tool.
     */
    const turnToolsByTurnId = useMemo(() => {
        const map = new Map<string, string[]>();
        for (const turn of messages) {
            if (turn.role !== 'user') {
                continue;
            }
            const union = new Set([...(turn.tools ?? []), ...(calledToolsByTurnId.get(turn.id) ?? [])]);
            map.set(turn.id, [...union].sort((a, b) => a.localeCompare(b)));
        }
        return map;
    }, [messages, calledToolsByTurnId]);

    /**
     * Audit records the transcript has no route to. A record is reachable from a
     * transcript only when its `toolUseId` matches a `tool_use` segment, so a
     * record written without one — a legacy row, or a provider that never
     * emitted the pairing id — carries no "Details" link and would be
     * unreachable on this view entirely. Listing exactly those leftovers keeps
     * the transcript the primary account of what ran while making sure no
     * invocation goes missing from the chat.
     */
    const unlinkedRecords = useMemo(
        () => selectUnlinkedRecords(messages, conversationRecords),
        [messages, conversationRecords]
    );

    /**
     * Per-conversation tool-record indexes for the expanded History rows, so a
     * tool call in a replayed transcript opens its invocation detail exactly as
     * it does in the live chat. Derived once per record-cache change rather than
     * rebuilt inside the row map, which would re-index every expanded row on any
     * unrelated render of the tab.
     */
    const historyRecordsById = useMemo(() => {
        const byConversation = new Map<string, Map<string, IToolInvocationRecord>>();
        for (const [conversationId, records] of historyToolRecords) {
            byConversation.set(conversationId, indexByToolUseId(records));
        }
        return byConversation;
    }, [historyToolRecords]);

    /**
     * The pending grant as chips under the composer, sorted so the row does not
     * reshuffle as options are ticked in the dropdown.
     */
    const grantedTools = useMemo(
        () => [...toolSelection].sort((a, b) => a.localeCompare(b)),
        [toolSelection]
    );

    /**
     * Drop one tool from the pending grant, so the chips are a control and not
     * just a readout — narrowing a selection should not mean reopening the
     * dropdown to hunt for the checkbox.
     *
     * Marks the selection as touched for the same reason the dropdown's onChange
     * does: while a saved prompt is loaded this chip row edits that prompt's
     * allowlist, and a removal here has to count as real intent or the save path
     * would discard it as part of the display-only pre-fill.
     *
     * @param name - The tool name to revoke.
     */
    const handleRevokeTool = useCallback((name: string) => {
        setToolsTouched(true);
        setToolSelection(prev => prev.filter(entry => entry !== name));
    }, []);

    /** The queryId whose stream chunks the handler currently accepts. */
    const activeQueryIdRef = useRef<string | null>(null);
    /** Id of the assistant turn currently receiving stream chunks. */
    const streamingTurnIdRef = useRef<string | null>(null);
    /** Stable id shared by every turn of this chat session; minted lazily on first send. */
    const conversationIdRef = useRef<string | null>(null);
    const transcriptRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /**
     * False once the component unmounts. Stream chunks and the POST response can
     * arrive after the tab switches away mid-stream; guarding state updates on
     * this flag prevents setState-after-unmount work.
     */
    const isMountedRef = useRef(true);
    /**
     * Bumped on every authoritative write to {@link savedPrompts} (a save, a
     * duplicate, a delete). The background refresh poll captures it before its
     * request and discards its own response if the value moved, so a slow poll
     * can never overwrite fresher data it started before.
     */
    const savedPromptsWriteRef = useRef(0);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (copyTimerRef.current) {
                clearTimeout(copyTimerRef.current);
            }
        };
    }, []);

    // Load every provider's model catalog once. Empty array ⇒ no override choices.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const list = await getQueryProviders();
                if (!cancelled) {
                    setProviders(list);
                }
            } catch {
                /* secondary data — the picker simply offers no choices on failure */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Load the saved-prompt library once, so the header selector is populated
    // before the operator opens it. Secondary data on an admin surface: a quiet
    // failure leaves the selector empty, never a broken chat.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const list = await listSavedPrompts();
                if (!cancelled) {
                    setSavedPrompts(list);
                }
            } catch {
                /* selector renders its empty state */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Load the bindable-hook catalog for the triggers editor's hook picker. A
    // quiet failure leaves the picker empty and "Add hook trigger" disabled.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const hooks = await listPromptTriggerHooks();
                if (!cancelled) {
                    setBindableHooks(hooks);
                }
            } catch {
                /* picker stays empty; hook triggers cannot be added */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Load the tool registry once for the per-run allowlist picker. Secondary
    // data on an interactive surface — a quiet failure leaves the picker empty,
    // which only means the run gets no tools (the default), never a broken chat.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const list = await listTools();
                if (!cancelled) {
                    setTools(list);
                }
            } catch {
                /* picker shows no options; the run simply gets no tools */
            } finally {
                if (!cancelled) {
                    setToolsLoading(false);
                }
            }
        })();
        return () => { cancelled = true; };
    }, []);

    /** The stored document behind the editor, or null while creating a new one. */
    const loadedPrompt = useMemo(
        () => savedPrompts.find(prompt => prompt.id === loadedPromptId) ?? null,
        [savedPrompts, loadedPromptId]
    );

    /** The provider an interactive send actually runs on, or null when none is installed. */
    const activeProvider = useMemo(
        () => providers.find(provider => provider.active) ?? null,
        [providers]
    );

    /**
     * The model override forwarded with the next interactive send. An interactive
     * query always executes on the active provider, so a pin belonging to a
     * different provider is deliberately dropped here rather than handed over as
     * a model that provider cannot resolve. The pin itself is untouched and still
     * saves onto the prompt, where its autonomous runs resolve the right transport.
     */
    const sendModel = useMemo(() => {
        const { providerId, model } = decodeModelPin(modelOverride);
        if (!model) {
            return undefined;
        }
        return providerId === activeProvider?.id ? model : undefined;
    }, [modelOverride, activeProvider]);

    /**
     * Whether the composer's pin names a provider that is not the active one — the
     * case {@link sendModel} drops. Surfaced beside the picker so the operator is
     * never left wondering why a different model answered. The note's wording is
     * conditional because the consequence differs: while editing a prompt the pin
     * still governs its autonomous runs, but in plain chat there is no prompt and
     * no schedule, so the choice simply does not apply to anything.
     */
    const pinnedProviderInactive = useMemo(() => {
        const { providerId } = decodeModelPin(modelOverride);
        return providerId !== null && providerId !== activeProvider?.id;
    }, [modelOverride, activeProvider]);

    /** Whether any prompt carries an enabled trigger; gates the refresh poll. */
    const hasActiveSchedule = useMemo(
        () => savedPrompts.some(prompt => (prompt.triggers ?? []).some(trigger => trigger.enabled)),
        [savedPrompts]
    );

    // Refetch the library while a schedule is live so a backend-written
    // `lastRunAt` surfaces without a manual refresh. Errors are swallowed — the
    // next tick retries — and only the stored list is replaced, so an in-progress
    // edit in the bar or the triggers editor is never disturbed.
    useEffect(() => {
        if (!hasActiveSchedule) {
            return;
        }
        const id = setInterval(() => {
            // Two writers share `savedPrompts`: this poll and the save response.
            // A poll that started before a save would land afterwards carrying
            // pre-save data — for a create that momentarily un-resolves
            // `loadedPrompt`, flipping the bar back to "Not saved yet" and hiding
            // its actions. Discarding any response whose generation is stale
            // makes the save the winner without serialising the two.
            const generation = savedPromptsWriteRef.current;
            listSavedPrompts()
                .then(list => {
                    if (isMountedRef.current && savedPromptsWriteRef.current === generation) {
                        setSavedPrompts(list);
                    }
                })
                .catch(() => {});
        }, SAVED_PROMPT_REFRESH_MS);
        return () => clearInterval(id);
    }, [hasActiveSchedule]);

    /** Names of every enabled tool — the display-only pre-fill set. */
    const enabledToolNames = useMemo(
        () => tools.filter(tool => tool.enabled).map(tool => tool.name),
        [tools]
    );

    /**
     * Whether the Tools picker should show the pre-fill. True for an editor whose
     * prompt carries no explicit allowlist — a stored prompt with `undefined`, or
     * a brand-new one — and only while the operator has not engaged the picker.
     * Deliberately a boolean rather than a prompt object, so the 30s library poll
     * minting a fresh `loadedPrompt` identity cannot re-trigger the effect below.
     */
    const needsToolPrefill = editingPrompt
        && !toolsTouched
        && (loadedPrompt ? loadedPrompt.toolAllowlist === undefined : true);

    // Show every enabled tool for a prompt that restricts none. Display only:
    // `toolsTouched` stays false, so the save path still writes `null` — freezing
    // today's set here would silently exclude every tool enabled later. The
    // equality bail matters as much as the fill: without it each poll response
    // would rewrite an identical array and re-issue the trifecta preview.
    useEffect(() => {
        if (!needsToolPrefill || enabledToolNames.length === 0) {
            return;
        }
        setToolSelection(prev => (
            prev.length === enabledToolNames.length && prev.every(name => enabledToolNames.includes(name))
                ? prev
                : enabledToolNames
        ));
    }, [needsToolPrefill, enabledToolNames]);

    /**
     * Whether the editor holds changes the stored prompt does not have yet,
     * across every field the single Save writes. Drives the unsaved dot — the
     * only signal that the composer text an operator is iterating on has diverged
     * from what a schedule would actually fire — and gates the discard guard below.
     */
    const promptDirty = useMemo(() => editingPrompt && isPromptDirty(loadedPrompt, {
        name: promptName,
        body: input,
        modelPin: modelOverride,
        toolSelection,
        toolsTouched,
        triggers: triggerDrafts
    }), [editingPrompt, loadedPrompt, promptName, input, modelOverride, toolSelection, toolsTouched, triggerDrafts]);

    /**
     * Run an action that would overwrite the editor, asking first when there are
     * unsaved changes. Every entry point that replaces editor state — loading
     * another prompt, New chat, closing the bar, reopening a past conversation —
     * routes through here, because those edits are invisible once discarded and
     * the unsaved dot is the only warning an operator ever gets. Passes straight
     * through when nothing is dirty, so the common path stays one click.
     *
     * @param action - The state-replacing work to run once it is safe.
     */
    const guardUnsavedPrompt = useCallback((action: () => void) => {
        if (!promptDirty) {
            action();
            return;
        }
        const modalId = modal.open({
            title: 'Discard unsaved changes?',
            size: 'sm',
            dismissible: true,
            content: (
                <div className={promptStyles.confirm}>
                    <p className={promptStyles.confirm_text}>
                        This prompt has edits that have not been saved. Continuing discards them.
                    </p>
                    <div className={promptStyles.confirm_actions}>
                        <Button variant="ghost" size="xs" onClick={() => modal.close(modalId)}>
                            Keep editing
                        </Button>
                        <Button
                            variant="danger"
                            size="xs"
                            onClick={() => { modal.close(modalId); action(); }}
                        >
                            Discard changes
                        </Button>
                    </div>
                </div>
            )
        });
    }, [promptDirty, modal]);

    // Preview the lethal-trifecta posture of the current selection, but only
    // while the Tools dropdown is open — a closed dropdown needs no preview,
    // so an operator who never opens it pays for no requests. Debounced so rapid
    // toggling issues one request. The verdict is server-computed (it folds in
    // provider server-tools and secret variables an allowlist cannot gate), so
    // this only renders what the preview endpoint returns.
    useEffect(() => {
        if (!toolsOpen) {
            return;
        }
        let cancelled = false;
        setTrifectaLoading(true);
        const timer = setTimeout(() => {
            void (async () => {
                try {
                    const status = await getTrifectaPreview(toolSelection);
                    if (!cancelled) {
                        setTrifecta(status);
                    }
                } catch {
                    if (!cancelled) {
                        setTrifecta(null);
                    }
                } finally {
                    if (!cancelled) {
                        setTrifectaLoading(false);
                    }
                }
            })();
        }, 350);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [toolSelection, toolsOpen]);

    /**
     * Mutate a single turn in place by id. Used by the stream handler to append
     * text and finalize usage/error on the pending assistant turn.
     *
     * @param id - Target turn id.
     * @param patch - Partial turn, or a function producing one from the prior turn.
     */
    const updateTurn = useCallback((
        id: string,
        patch: Partial<ChatTurn> | ((turn: ChatTurn) => Partial<ChatTurn>)
    ) => {
        setMessages(prev => prev.map(turn => {
            if (turn.id !== id) {
                return turn;
            }
            const resolved = typeof patch === 'function' ? patch(turn) : patch;
            return { ...turn, ...resolved };
        }));
    }, []);

    /**
     * Load a conversation's tool-invocation audit records so the transcript's tool
     * calls can deep-link to their exact invocation detail. Secondary data — a
     * failure just leaves the audit affordances absent, never blocks the chat.
     * Reads the same admin-gated feed the Activity tab uses, scoped by
     * conversationId.
     *
     * @param conversationId - The conversation whose tool calls to load.
     */
    const refreshConversationActivity = useCallback(async (conversationId: string) => {
        try {
            const page = await listActivity({ conversationId, limit: 200 });
            // Drop out-of-order responses: a slower fetch for a conversation the
            // operator has since navigated away from must not overwrite the
            // active conversation's records (which back the transcript's per-call
            // "Details" deep-links and the leftover-record list beneath it).
            if (isMountedRef.current && conversationId === conversationIdRef.current) {
                setConversationRecords(page.records);
            }
        } catch {
            /* secondary data — the transcript still renders without audit links */
        }
    }, []);

    /**
     * Lazily load everything one history row needs the first time it is expanded:
     * the conversation's stored turns and its tool-invocation audit records. Both
     * come from admin-gated endpoints the chat view already reads — the same
     * conversation fetch "Open in chat" uses, and the Activity feed scoped by
     * conversationId — so an expanded row can show the answer, the failure reason,
     * the usage line, and the tool calls without the operator leaving the list.
     *
     * The two are fetched together and share one loading flag and one error slot,
     * because they are two halves of a single disclosure: showing the tool table
     * while the transcript is still arriving would read as though the run produced
     * nothing else. This is secondary data behind a user action, so a loading line
     * is correct here and a failure is captured per-row rather than blocking the
     * list. Idempotent: callers gate on the cache, so an expanded row is fetched
     * once and reused across collapse and re-expand.
     *
     * @param conversationId - The conversation whose detail to load.
     */
    const loadHistoryDetail = useCallback(async (conversationId: string) => {
        setHistoryToolLoading(prev => {
            const next = new Set(prev);
            next.add(conversationId);
            return next;
        });
        setHistoryToolError(prev => {
            if (!prev.has(conversationId)) {
                return prev;
            }
            const next = new Map(prev);
            next.delete(conversationId);
            return next;
        });
        try {
            // Issued together so the row settles in one step rather than filling
            // in piecemeal; either rejecting fails the whole disclosure, which is
            // the honest outcome when half the detail is missing.
            const [records, page] = await Promise.all([
                getConversation(conversationId),
                listActivity({ conversationId, limit: 200 })
            ]);
            if (!isMountedRef.current) {
                return;
            }
            setHistoryTurns(prev => {
                const next = new Map(prev);
                next.set(conversationId, recordsToChatTurns(records));
                return next;
            });
            setHistoryToolRecords(prev => {
                const next = new Map(prev);
                next.set(conversationId, page.records);
                return next;
            });
        } catch (err) {
            if (!isMountedRef.current) {
                return;
            }
            setHistoryToolError(prev => {
                const next = new Map(prev);
                next.set(conversationId, err instanceof Error ? err.message : 'Failed to load conversation detail');
                return next;
            });
        } finally {
            if (isMountedRef.current) {
                setHistoryToolLoading(prev => {
                    const next = new Set(prev);
                    next.delete(conversationId);
                    return next;
                });
            }
        }
    }, []);

    /**
     * Route an incoming stream chunk to the pending assistant turn. Filters by
     * the active queryId so a stale or unrelated query's chunks are ignored.
     * The backend addresses `ai-tools:query-stream` to the requesting socket, so
     * this filter is not what keeps another operator's run out — it is what
     * keeps *this* socket's own runs apart, since one socket can start a second
     * query while an abandoned one is still settling.
     *
     * @param chunk - The stream chunk payload.
     */
    const handleStreamChunk = useCallback((chunk: IAiStreamChunk) => {
        if (!isMountedRef.current || chunk.queryId !== activeQueryIdRef.current) {
            return;
        }
        const turnId = streamingTurnIdRef.current;
        if (!turnId) {
            return;
        }
        if (chunk.type === 'chunk' && chunk.text) {
            const text = chunk.text;
            // `content` stays the flat answer (the copy button and the history
            // payload read it); `segments` is that same text placed in the live
            // structure, so prose arriving after a tool call renders below that
            // call instead of being merged into one block above it.
            updateTurn(turnId, turn => ({
                content: turn.content + text,
                segments: appendLiveText(turn.segments, text)
            }));
        } else if (chunk.type === 'segment' && chunk.segment) {
            // A tool call or its result, reported the moment it settled. Append
            // in arrival order — the governor emits a call when it dispatches it
            // and its result when the handler returns, so arrival order is the
            // order things actually happened.
            const segment = chunk.segment;
            updateTurn(turnId, turn => ({ segments: [...(turn.segments ?? []), segment] }));
        } else if (chunk.type === 'done') {
            setStreaming(false);
            // Adopt the finalized transcript so the just-completed turn shows the
            // same thinking/tool structure history does, without a reload. It
            // replaces whatever the live stream accumulated, which is what makes
            // the live view safe to be approximate — a segment that arrived
            // unpaired or out of order is corrected here. Absent for a plain text
            // turn, where the live segments (or `content`) already cover it.
            updateTurn(turnId, {
                pending: false,
                usage: chunk.usage ?? null,
                costUsd: chunk.costUsd ?? null,
                ...(chunk.transcript && chunk.transcript.length > 0 ? { segments: chunk.transcript } : {})
            });
            streamingTurnIdRef.current = null;
            activeQueryIdRef.current = null;
            // The turn produced its audit records as it ran; pull them so the
            // just-completed tool calls gain their "Details" deep-link without
            // the operator having to reopen the conversation from history.
            const settledConversationId = conversationIdRef.current;
            if (settledConversationId) {
                void refreshConversationActivity(settledConversationId);
            }
        } else if (chunk.type === 'error') {
            setStreaming(false);
            updateTurn(turnId, { pending: false, error: chunk.error || 'An unknown error occurred' });
            streamingTurnIdRef.current = null;
            activeQueryIdRef.current = null;
        }
    }, [updateTurn, refreshConversationActivity]);

    // Subscribe to the global stream event once; correlation happens in the
    // handler. The shared socket is reused across the app, so only detach our
    // own listener on unmount — never disconnect the socket.
    useEffect(() => {
        const socket = getSocket();
        socket.on(QUERY_STREAM_EVENT, handleStreamChunk);
        return () => { socket.off(QUERY_STREAM_EVENT, handleStreamChunk); };
    }, [handleStreamChunk]);

    // Auto-follow the transcript as it grows, but only when the reader is already
    // near the bottom — don't yank a reviewer of earlier turns back down.
    useEffect(() => {
        const el = transcriptRef.current;
        if (!el) {
            return;
        }
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom < 120) {
            el.scrollTop = el.scrollHeight;
        }
    }, [messages]);

    /**
     * Send the composer text as the next chat turn. Snapshots the completed
     * transcript as the history payload, appends a user turn and an empty pending
     * assistant turn, then POSTs the prompt with a fresh `queryId`. Streamed
     * deltas flow into the pending turn via {@link handleStreamChunk}.
     */
    const handleSend = useCallback(async () => {
        const trimmed = input.trim();
        if (!trimmed || streaming) {
            return;
        }
        setError(null);

        // A prompt with no stored allowlist means "every enabled tool" — a state
        // the composer can only express once the registry has loaded and the
        // pre-fill has filled the picker. Sending before that resolves would
        // submit `[]`, an explicit "no tools", so the interactive test would run
        // unlike the prompt's own autonomous runs. Ctrl+Enter reaches this
        // handler past the disabled Send button, so the guard belongs here too.
        if (needsToolPrefill && toolsLoading) {
            setError('Tool registry still loading — wait a moment and try again.');
            return;
        }

        // The backend scopes stream chunks to the requesting socket, so the live
        // socket id is required. It is only undefined before the deferred socket
        // connects; surface that instead of POSTing an empty value the server
        // could never route a stream back to.
        const socketId = getSocket().id;
        if (!socketId) {
            setError('Live connection not ready yet — wait a moment and try again.');
            return;
        }

        // Exclude failed turns so a stream error does not poison later context.
        const priorMessages: IAiConversationMessage[] = messages
            .filter(turn => !turn.error && turn.content)
            .map(turn => ({ role: turn.role, content: turn.content }));

        if (!conversationIdRef.current) {
            conversationIdRef.current = generateUUID();
        }
        const conversationId = conversationIdRef.current;

        // This send appends turns to `conversationId`, so any History row detail
        // cached for it is now short by at least one turn. The cache assumes a past
        // conversation is immutable, which stops being true the moment a reopened
        // conversation is continued: History refreshes the row's turn count on the
        // next view switch while the cached transcript stays behind, and the row
        // would report the new count while replaying the old turns. Drop the cached
        // detail and collapse the row together, so re-expanding refetches the
        // conversation as it now stands — dropping the cache alone would leave the
        // still-expanded row rendering "Nothing recorded for this conversation",
        // because the fetch only fires on the expand edge.
        setHistoryTurns(prev => {
            if (!prev.has(conversationId)) {
                return prev;
            }
            const next = new Map(prev);
            next.delete(conversationId);
            return next;
        });
        setHistoryToolRecords(prev => {
            if (!prev.has(conversationId)) {
                return prev;
            }
            const next = new Map(prev);
            next.delete(conversationId);
            return next;
        });
        setExpandedIds(prev => {
            if (!prev.has(conversationId)) {
                return prev;
            }
            const next = new Set(prev);
            next.delete(conversationId);
            return next;
        });

        // Snapshot the grant onto the turn: `toolSelection` is cleared once the
        // send is accepted, so the turn must carry its own copy to keep showing
        // which tools this prompt was allowed to use.
        const userTurn: ChatTurn = { id: generateUUID(), role: 'user', content: trimmed, tools: [...toolSelection] };
        const assistantTurnId = generateUUID();
        const assistantTurn: ChatTurn = {
            id: assistantTurnId,
            role: 'assistant',
            content: '',
            pending: true,
            // The resolved override, not the raw pin: a pin on a non-active
            // provider is not what actually answers, so labelling the turn with
            // it would misreport which model produced the text.
            model: sendModel
        };
        setMessages(prev => [...prev, userTurn, assistantTurn]);
        // While a prompt is loaded the composer holds that prompt's body, so the
        // text stays put — the operator is iterating on a prompt, not spending a
        // one-shot chat turn, and clearing it would empty what Save writes.
        if (!editingPrompt) {
            setInput('');
        }

        const queryId = generateUUID();
        activeQueryIdRef.current = queryId;
        streamingTurnIdRef.current = assistantTurnId;
        setStreaming(true);

        try {
            const ack = await submitQuery({
                prompt: trimmed,
                queryId,
                socketId,
                model: sendModel,
                messages: priorMessages,
                conversationId,
                stream: true,
                // Sent verbatim: `[]` grants no tools (the default), a name list
                // grants that subset. The governor enforces it for this run.
                toolAllowlist: toolSelection
            });
            // The streaming path acks immediately; the answer arrives over the
            // socket. A non-ack shape would mean the server didn't stream —
            // surface that rather than waiting forever for chunks.
            if (!(ack as IStreamAck).success) {
                throw new Error('Server did not start a streaming query.');
            }
            // Per-run grant consumed: clear the allowlist once the governor has
            // accepted this run so a later ordinary message cannot silently
            // reuse a previously granted side-effecting tool. Honors the
            // "grant only what this run needs" contract this picker advertises.
            //
            // Skipped while a prompt is loaded: there the selection is that
            // prompt's persisted allowlist rather than a one-shot grant, so
            // clearing it would stage "no tools" onto the next Save.
            if (!editingPrompt) {
                setToolSelection([]);
            }
        } catch (err) {
            streamingTurnIdRef.current = null;
            activeQueryIdRef.current = null;
            if (!isMountedRef.current) {
                return;
            }
            setStreaming(false);
            updateTurn(assistantTurnId, {
                pending: false,
                error: err instanceof Error ? err.message : 'Failed to submit query'
            });
        }
    }, [input, streaming, messages, modelOverride, sendModel, editingPrompt, toolSelection, needsToolPrefill, toolsLoading, updateTurn]);

    /**
     * Save a chat turn's prompt — together with the tools that turn was granted
     * — as a new saved prompt, from the bookmark beside the turn's tool chips.
     * The point is to capture a run that worked: a prompt is only reproducible
     * alongside the allowlist it ran under, so the two are persisted together
     * rather than leaving the operator to re-pick tools in the editor afterwards.
     *
     * The allowlist saved is {@link turnToolsByTurnId} — the same set the turn
     * shows as chips, so the bookmark persists what the operator can see. Read
     * from there rather than from `turn.tools`, which is populated only at send
     * time: a turn reopened from history has none, and saving that absence as
     * `[]` would write a hard deny (the backend reads `[]` as "no tools", not
     * "unspecified") into a prompt whose chips were advertising tools.
     *
     * The saved-prompt list is re-read before naming instead of trusting local
     * state, because the panel only loads its list on first open — naming from a
     * stale (often empty) list would collide with an existing `Saved Prompt NN`
     * and be rejected by the backend's case-insensitive unique-name index.
     *
     * @param turn - The user turn to persist; its `content` becomes the prompt body.
     */
    const handleSaveTurnAsPrompt = useCallback(async (turn: ChatTurn) => {
        const prompt = turn.content.trim();
        if (!prompt || savingTurnId) {
            return;
        }
        setSavingTurnId(turn.id);
        try {
            const name = nextTurnPromptName(await listSavedPrompts());
            const granted = turnToolsByTurnId.get(turn.id) ?? [];
            const updated = await saveSavedPrompt({ name, prompt, toolAllowlist: granted });
            if (!isMountedRef.current) {
                return;
            }
            savedPromptsWriteRef.current += 1;
            setSavedPrompts(updated);
            push({
                tone: 'success',
                title: 'Prompt saved',
                // Name the inert case outright rather than reporting "0 tools":
                // an empty allowlist is a deny, and a prompt that can call
                // nothing is worth flagging before it is put on a schedule.
                description: granted.length === 0
                    ? `Saved as "${name}" with no tools — it will run inert until you grant some.`
                    : granted.length === 1
                        ? `Saved as "${name}" with 1 tool.`
                        : `Saved as "${name}" with ${granted.length} tools.`
            });
        } catch (err) {
            if (!isMountedRef.current) {
                return;
            }
            push({
                tone: 'danger',
                title: 'Could not save prompt',
                description: err instanceof Error ? err.message : 'Failed to save the prompt.'
            });
        } finally {
            if (isMountedRef.current) {
                setSavingTurnId(null);
            }
        }
    }, [savingTurnId, push, turnToolsByTurnId]);

    /**
     * Execute a saved prompt immediately from the saved-prompts panel — a
     * self-contained autonomous run, exactly as its schedule would fire it. It
     * runs server-side (programmatic mode, the prompt's own tools, its owner
     * principal) rather than in this interactive conversation, so the result
     * lands in the Query-tab History badged Scheduled, not the live transcript.
     * The POST returns as soon as the run is accepted; a toast confirms it
     * started or surfaces an upfront rejection (missing prompt or no provider).
     *
     * @param sp - The saved prompt to run now.
     */
    const handleRunSavedPrompt = useCallback(async (sp: ISavedPrompt) => {
        try {
            await runSavedPromptNow(sp.id);
            push({
                tone: 'success',
                title: 'Prompt run started',
                description: `"${sp.name}" is running autonomously — its result appears in History.`
            });
        } catch (err) {
            push({
                tone: 'danger',
                title: 'Could not run prompt',
                description: err instanceof Error ? err.message : 'Failed to start the run.'
            });
        }
    }, [push]);

    /**
     * Abort the in-flight streaming query via the backend cancel route. The
     * backend aborts the provider stream and emits a terminal chunk, handled
     * like any other stream end.
     */
    const handleStop = useCallback(async () => {
        const queryId = activeQueryIdRef.current;
        if (!queryId) {
            return;
        }
        try {
            await cancelQuery(queryId);
        } catch {
            // Best-effort: the stream delivers its own terminal chunk regardless.
        }
    }, []);

    /**
     * Reset the conversation surface itself — transcript, ids, and audit records.
     * Split out from {@link handleNewChat} because loading a saved prompt needs
     * exactly this much (a fresh chat to try the prompt in) and must not touch
     * the composer, which is about to receive the prompt's body.
     */
    const resetConversation = useCallback(() => {
        setMessages([]);
        setError(null);
        streamingTurnIdRef.current = null;
        activeQueryIdRef.current = null;
        conversationIdRef.current = null;
        setConversationRecords([]);
        setSelectedRecord(null);
    }, []);

    /**
     * Start over completely: a fresh conversation *and* a cleared composer, model
     * pin, and tool grant, with any prompt editor dismissed. This is the escape
     * hatch from prompt-authoring mode — where the composer deliberately keeps its
     * text after a send — back to an empty least-privilege chat, so it clears more
     * than the transcript.
     */
    const handleNewChat = useCallback(() => {
        if (streaming) {
            return;
        }
        guardUnsavedPrompt(() => {
            resetConversation();
            setInput('');
            setModelOverride('');
            setToolSelection([]);
            setToolsTouched(false);
            setEditingPrompt(false);
            setLoadedPromptId(null);
            setPromptName('');
            setTriggerDrafts([]);
            setTriggersOpen(false);
        });
    }, [streaming, resetConversation, guardUnsavedPrompt]);

    /**
     * Load a saved prompt for editing: start a fresh chat, then fill every control
     * that makes up the prompt — composer body, model pin, tool allowlist, and
     * trigger rows. This is what replaces the old edit modal; from here a single
     * Save writes all of it back.
     *
     * The allowlist seeding carries the three-state contract: a prompt with an
     * explicit list (including `[]`) seeds verbatim, while one with none is
     * pre-filled with the enabled set for display only, leaving `toolsTouched`
     * false so an untouched save still writes `null`.
     *
     * @param prompt - The prompt picked from the header selector.
     */
    const handleSelectPrompt = useCallback((prompt: ISavedPrompt) => {
        if (streaming) {
            return;
        }
        guardUnsavedPrompt(() => {
            resetConversation();
            setInput(prompt.prompt);
            setPromptName(prompt.name);
            setModelOverride(encodeModelPin(prompt));
            // `??` not `||`: a stored `[]` is a deliberate "no tools" and must
            // survive, where the pre-fill effect handles the `undefined` case.
            setToolSelection(prompt.toolAllowlist ?? []);
            setToolsTouched(false);
            setTriggerDrafts(toTriggerDrafts(prompt.triggers));
            setLoadedPromptId(prompt.id);
            setEditingPrompt(true);
            setTriggersOpen(false);
            textareaRef.current?.focus();
        });
    }, [streaming, resetConversation, guardUnsavedPrompt]);

    /**
     * Begin a new saved prompt from what is already in the composer. Deliberately
     * keeps the composer text, model choice, and tool grant — "from composer" is
     * the whole affordance, and it is how a query an operator just tuned by hand
     * becomes a reusable prompt without retyping it.
     */
    const handleCreateNewPrompt = useCallback(() => {
        guardUnsavedPrompt(() => {
            setLoadedPromptId(null);
            setPromptName('');
            setTriggerDrafts([]);
            // Only an actual grant counts as intent. Forcing this true would make
            // the composer's least-privilege default (`[]`) save as a hard deny,
            // producing a prompt that runs inert on every scheduled firing; left
            // false, an empty selection falls through to the pre-fill and saves
            // as "unset", which is what a new prompt is supposed to mean.
            setToolsTouched(toolSelection.length > 0);
            setEditingPrompt(true);
            setTriggersOpen(false);
        });
    }, [guardUnsavedPrompt, toolSelection]);

    /**
     * Stop editing without altering the conversation. The composer keeps its text
     * — an operator dismissing the bar is stepping out of prompt-editing mode, not
     * discarding the query they were working on — but the tool grant is reset.
     *
     * That reset is deliberate and not symmetric with the text: while editing, the
     * selection may be the display-only pre-fill of *every enabled tool*, which
     * was never a grant the operator made. Carrying it into the next ad-hoc
     * message would hand a one-off question every enabled tool, contradicting the
     * dropdown's own least-privilege contract.
     */
    const handleCloseEditor = useCallback(() => {
        guardUnsavedPrompt(() => {
            setEditingPrompt(false);
            setLoadedPromptId(null);
            setPromptName('');
            setTriggerDrafts([]);
            setTriggersOpen(false);
            setToolsTouched(false);
            setToolSelection([]);
        });
    }, [guardUnsavedPrompt]);

    /**
     * Record a real selection edit and update the grant. Wraps the tool dropdown's
     * onChange so every toggle marks the selection as engaged — distinguishing a
     * deliberate choice from the display-only pre-fill, which the save path treats
     * differently.
     *
     * @param names - The next selected tool names from the picker.
     */
    const handleToolSelectionChange = useCallback((names: string[]) => {
        setToolsTouched(true);
        setToolSelection(names);
    }, []);

    /**
     * Persist the whole prompt in one write — name, body, model pin, tool
     * allowlist, and triggers. One Save because the operator edits all of it in
     * one surface; sending every field together also means the stored document
     * always matches what the card is showing, which is what the unsaved
     * indicator promises.
     */
    const handleSavePrompt = useCallback(async () => {
        const trimmedName = promptName.trim();
        const trimmedBody = input.trim();
        if (!trimmedName || !trimmedBody) {
            return;
        }
        setPromptSaving(true);
        try {
            const { providerId, model } = decodeModelPin(modelOverride);
            const saved = await saveSavedPrompt({
                ...(loadedPromptId ? { id: loadedPromptId } : {}),
                name: trimmedName,
                prompt: trimmedBody,
                providerId,
                model,
                toolAllowlist: resolveToolAllowlistForSave(loadedPrompt, toolSelection, toolsTouched),
                triggers: toTriggerRequests(triggerDrafts)
            });
            if (!isMountedRef.current) {
                return;
            }
            savedPromptsWriteRef.current += 1;
            setSavedPrompts(saved);
            // Adopt the server's identity and its normalized triggers. A create
            // has no id to match on, so it is found by name — the backend's
            // unique index is case-insensitive, so this cannot be ambiguous.
            // Without adopting the id, the next Save would create a second copy;
            // without adopting the triggers, newly added rows would resend
            // `id: undefined` and be treated as brand new, re-anchoring their
            // cron and discarding their run bookkeeping.
            const stored = loadedPromptId
                ? saved.find(prompt => prompt.id === loadedPromptId)
                : saved.find(prompt => prompt.name.toLowerCase() === trimmedName.toLowerCase());
            if (stored) {
                setLoadedPromptId(stored.id);
                setTriggerDrafts(toTriggerDrafts(stored.triggers));
                // The stored document is the new baseline, so intent is recorded
                // in it now rather than in this flag.
                setToolsTouched(false);
            }
            push({
                tone: 'success',
                title: loadedPromptId ? 'Prompt updated' : 'Prompt created',
                description: `"${trimmedName}" saved.`
            });
        } catch (err) {
            if (isMountedRef.current) {
                push({
                    tone: 'danger',
                    title: 'Could not save prompt',
                    description: err instanceof Error ? err.message : 'Failed to save the prompt.'
                });
            }
        } finally {
            if (isMountedRef.current) {
                setPromptSaving(false);
            }
        }
    }, [promptName, input, modelOverride, loadedPromptId, loadedPrompt, toolSelection, toolsTouched, triggerDrafts, push]);

    /**
     * Duplicate the prompt under an auto-suffixed name. The candidate is compared
     * lowercased because the backend's unique-name index is case-insensitive, so
     * a case-variant match must count as a collision here too — otherwise the save
     * round-trips to a 409.
     */
    const handleDuplicatePrompt = useCallback(async () => {
        if (!loadedPrompt) {
            return;
        }
        const existingNames = new Set(savedPrompts.map(prompt => prompt.name.toLowerCase()));
        let candidate = `${loadedPrompt.name} (copy)`;
        let counter = 2;
        while (existingNames.has(candidate.toLowerCase())) {
            candidate = `${loadedPrompt.name} (copy ${counter})`;
            counter += 1;
        }
        try {
            // Carry the model pin and the allowlist, not just name + body. An
            // omitted `toolAllowlist` reads as "every enabled tool", so copying a
            // narrowly-scoped prompt without it would silently hand the copy more
            // privilege than the original — `null` reproduces a source that
            // genuinely restricts nothing. Triggers are deliberately NOT copied:
            // a duplicate that inherits a cron would start firing on a schedule
            // the operator never asked for.
            const duplicated = await saveSavedPrompt({
                name: candidate,
                prompt: loadedPrompt.prompt,
                providerId: loadedPrompt.providerId ?? null,
                model: loadedPrompt.model ?? null,
                toolAllowlist: loadedPrompt.toolAllowlist ?? null
            });
            // Bump only once the write has landed and immediately before adopting
            // its response, matching handleSavePrompt: a poll that started while
            // the POST was in flight is then guaranteed to fail the generation
            // check rather than replay a list that predates the duplicate.
            savedPromptsWriteRef.current += 1;
            setSavedPrompts(duplicated);
            push({
                tone: 'success',
                title: 'Prompt duplicated',
                description: `Created "${candidate}" with the same model and tools. Triggers were not copied.`
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to duplicate prompt');
        }
    }, [loadedPrompt, savedPrompts, push]);

    /**
     * Delete the prompt under edit and dismiss the editor. Called only from the
     * confirm dialog below.
     *
     * @param id - The prompt id to delete.
     */
    const handleDeletePrompt = useCallback(async (id: string) => {
        try {
            await deleteSavedPrompt(id);
            savedPromptsWriteRef.current += 1;
            setSavedPrompts(prev => prev.filter(prompt => prompt.id !== id));
            // Straight to the raw reset: the document is gone, so there is nothing
            // left for the discard guard in handleCloseEditor to protect.
            setEditingPrompt(false);
            setLoadedPromptId(null);
            setPromptName('');
            setTriggerDrafts([]);
            setTriggersOpen(false);
            setToolsTouched(false);
            setToolSelection([]);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete prompt');
        }
    }, []);

    /**
     * Confirm before deleting, calling out attached triggers. This is the one
     * dialog the inline editor still opens: deleting a prompt that something is
     * scheduled to fire is not an action to take on a stray click, and the
     * consequence (a schedule silently stopping) is invisible from the bar.
     */
    const confirmDeletePrompt = useCallback(() => {
        if (!loadedPrompt) {
            return;
        }
        const prompt = loadedPrompt;
        const triggers = prompt.triggers ?? [];
        const scheduleIsActive = triggers.some(trigger => trigger.enabled);
        const modalId = modal.open({
            title: 'Delete saved prompt?',
            size: 'sm',
            dismissible: true,
            content: (
                <div className={promptStyles.confirm}>
                    <p className={promptStyles.confirm_text}>
                        Delete <strong>{prompt.name}</strong>? This cannot be undone.
                    </p>
                    {scheduleIsActive && (
                        <p className={promptStyles.confirm_warning}>
                            <AlertTriangle size={14} /> Active triggers will stop firing.
                        </p>
                    )}
                    {triggers.length > 0 && !scheduleIsActive && (
                        <p className={promptStyles.confirm_warning}>
                            <AlertTriangle size={14} /> Paused triggers will be removed with the prompt.
                        </p>
                    )}
                    <div className={promptStyles.confirm_actions}>
                        <Button variant="ghost" size="xs" onClick={() => modal.close(modalId)}>
                            Cancel
                        </Button>
                        <Button
                            variant="danger"
                            size="xs"
                            onClick={() => { modal.close(modalId); void handleDeletePrompt(prompt.id); }}
                        >
                            <Trash2 size={12} /> Delete
                        </Button>
                    </div>
                </div>
            )
        });
    }, [modal, loadedPrompt, handleDeletePrompt]);

    /**
     * Copy arbitrary text to the clipboard, flashing a check on whichever control
     * triggered it. Shared by the transcript's per-turn copy and the history
     * list's per-query copy so both surfaces get identical 2-second confirmation
     * feedback from one timer and one piece of "last copied" state.
     *
     * @param id - Id of the control to flash (a turn id or a conversation id).
     * @param text - The text to place on the clipboard.
     */
    const handleCopy = useCallback(async (id: string, text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedTurnId(id);
            if (copyTimerRef.current) {
                clearTimeout(copyTimerRef.current);
            }
            copyTimerRef.current = setTimeout(() => {
                if (isMountedRef.current) {
                    setCopiedTurnId(null);
                }
            }, 2000);
        } catch {
            setError('Could not copy to clipboard');
        }
    }, []);

    /**
     * Toggle whether a history row reveals its full opening prompt. The list
     * truncates each prompt to one line by default; expanding drops the clamp so
     * an operator can read or copy a long query in full without reopening the
     * whole conversation. Tracked as a Set so several rows can stay open at once.
     *
     * @param conversationId - Id of the conversation row to expand or collapse.
     */
    const toggleExpanded = useCallback((conversationId: string) => {
        // Decide direction from the current set before mutating it, so the fetch
        // is triggered only on the expand edge — never on collapse.
        const willExpand = !expandedIds.has(conversationId);
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(conversationId)) {
                next.delete(conversationId);
            } else {
                next.add(conversationId);
            }
            return next;
        });
        // Fetch this row's detail once, on first expand. Skip when a prior fetch
        // already succeeded or is still in flight. A prior *failure* does not
        // skip: re-expanding retries the fetch, and loadHistoryDetail clears the
        // stale error at the start of the new request. The gate reads the turns
        // cache because the transcript is what the row exists to show; the two
        // caches are written together, so either would answer the same.
        if (
            willExpand &&
            !historyTurns.has(conversationId) &&
            !historyToolLoading.has(conversationId)
        ) {
            void loadHistoryDetail(conversationId);
        }
    }, [expandedIds, historyTurns, historyToolLoading, loadHistoryDetail]);

    /** Load the grouped conversation history for the History view. */
    const loadHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const page = await getQueryHistory({ limit: HISTORY_LIMIT });
            setConversations(groupConversations(page.records));
            setHistoryError(null);
        } catch (err) {
            setHistoryError(err instanceof Error ? err.message : 'Failed to load history');
        } finally {
            setHistoryLoading(false);
        }
    }, []);

    // Fetch history when the History view opens.
    useEffect(() => {
        if (view === 'history') {
            void loadHistory();
        }
    }, [view, loadHistory]);

    /**
     * Reopen a past conversation into the transcript. Fetches every turn
     * (oldest-first), rebuilds user/assistant bubbles, restores the conversation
     * id so continued turns extend the same thread, then switches to the chat view.
     *
     * @param conversationId - Id of the conversation to resume.
     */
    const openConversation = useCallback(async (conversationId: string) => {
        // If a stream is still in flight, abort it before abandoning the current
        // transcript — otherwise the server query keeps consuming tokens after the
        // user has navigated away from it. Clear the streaming UI state up front so
        // any late chunk from the old query is rejected by the queryId filter.
        const inFlightQueryId = activeQueryIdRef.current;
        if (inFlightQueryId) {
            activeQueryIdRef.current = null;
            streamingTurnIdRef.current = null;
            setStreaming(false);
            try {
                await cancelQuery(inFlightQueryId);
            } catch {
                // Best-effort: even if the cancel call fails, the queryId filter
                // already discards the abandoned stream's chunks on this client.
            }
            if (!isMountedRef.current) {
                return;
            }
        }
        try {
            const records = await getConversation(conversationId);
            if (!isMountedRef.current) {
                return;
            }
            const rebuilt = recordsToChatTurns(records);
            setStreaming(false);
            setError(null);
            streamingTurnIdRef.current = null;
            activeQueryIdRef.current = null;
            conversationIdRef.current = conversationId;
            setMessages(rebuilt);
            // Leave prompt-editing mode. The composer holds the prompt's body,
            // and the operator has just moved into an unrelated thread that the
            // next send would extend — keeping the bar up would claim they are
            // still authoring a prompt while the surface below says otherwise.
            // The caller has already cleared the discard guard.
            setEditingPrompt(false);
            setLoadedPromptId(null);
            setPromptName('');
            setTriggerDrafts([]);
            setTriggersOpen(false);
            setToolsTouched(false);
            setToolSelection([]);
            // Drop the previous conversation's audit records up front so the
            // transcript's tool-detail lookup never shows the prior thread's
            // tools during this conversation's in-flight activity fetch — or
            // permanently, if that fetch fails. The clear lives here, not in
            // refreshConversationActivity, because the live streaming `done`
            // path shares that refresh and must not flash empty.
            setConversationRecords([]);
            setSelectedRecord(null);
            setView('chat');
            // Load this conversation's tool-call audit records so the transcript's
            // tool calls link to their exact invocation detail. Fire-and-forget:
            // it must not gate reopening the chat.
            void refreshConversationActivity(conversationId);
        } catch (err) {
            if (isMountedRef.current) {
                setHistoryError(err instanceof Error ? err.message : 'Failed to open conversation');
            }
        }
    }, [refreshConversationActivity]);

    /**
     * Ctrl/Cmd+Enter submits from the composer.
     *
     * @param event - Keyboard event from the textarea.
     */
    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void handleSend();
        }
    }, [handleSend]);

    const hasTurns = messages.length > 0;
    // Labels span every provider's catalog, not just the active one: a turn
    // reopened from history may name a model whose provider is no longer active,
    // and showing its raw id there would be a needless regression.
    const modelLabel = useMemo(
        () => new Map(providers.flatMap(provider => provider.models).map(model => [model.id, model.display_name])),
        [providers]
    );

    /**
     * Why Save is unavailable, or null when it is available. Returned as prose
     * rather than a boolean because the blocking condition can live in a section
     * the operator is not looking at — an invalid cron is two clicks away — and a
     * Save that is greyed out for no visible reason reads as a bug.
     */
    const saveBlockedReason = useMemo(() => {
        if (!promptName.trim()) {
            return 'Give the prompt a name before saving.';
        }
        if (!input.trim()) {
            return 'The composer is empty — it holds this prompt’s text.';
        }
        if (hasInvalidTriggerDraft(triggerDrafts)) {
            return 'A trigger is incomplete — open Triggers to fix it.';
        }
        return null;
    }, [promptName, input, triggerDrafts]);
    // Running conversation cost: sum every priced turn. `null` when not a single
    // turn could be priced, so the header hides the figure rather than showing
    // a misleading $0.00 (mirrors the provider's own sum-or-hide behavior).
    const conversationCost = useMemo(() => {
        let total = 0;
        let priced = false;
        for (const turn of messages) {
            if (typeof turn.costUsd === 'number') {
                total += turn.costUsd;
                priced = true;
            }
        }
        return priced ? total : null;
    }, [messages]);

    return (
        <div className={styles.query}>
            <div className={styles.provider_line}>
                <Bot size={16} className={styles.chat_header_icon} />
                <span>
                    {activeProvider
                        ? <>Active provider ready — <span className={styles.provider_label}>{activeProvider.models.length}</span> model{activeProvider.models.length === 1 ? '' : 's'} available.</>
                        : 'No active AI provider is installed — install and enable a provider plugin to run queries.'}
                </span>
                <span style={{ marginLeft: 'auto' }}>
                    <Button
                        variant={view === 'chat' ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setView('chat')}
                        aria-pressed={view === 'chat'}
                    >
                        <MessageSquare size={16} /> Chat
                    </Button>
                    {' '}
                    <Button
                        variant={view === 'history' ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setView('history')}
                        aria-pressed={view === 'history'}
                    >
                        <History size={16} /> History
                    </Button>
                </span>
            </div>

            {view === 'chat' ? (
                <>
                <Card className={styles.chat_card}>
                    <div className={styles.chat_header}>
                        <Bot size={16} className={styles.chat_header_icon} />
                        <span className={styles.chat_header_label}>Conversation</span>
                        <SavedPromptSelector
                            prompts={savedPrompts}
                            loadedPromptId={loadedPromptId}
                            onSelect={handleSelectPrompt}
                            onCreateNew={handleCreateNewPrompt}
                            disabled={streaming}
                        />
                        {conversationCost != null && (
                            <span
                                className={styles.conversation_cost}
                                title="Estimated total cost of this conversation, summed across turns at the provider's per-model rates."
                            >
                                ≈ {formatUsd(conversationCost)}
                            </span>
                        )}
                        {streaming && (
                            <span className={styles.streaming_indicator}>
                                <span className={styles.streaming_dot} aria-hidden="true" />
                                Streaming
                            </span>
                        )}
                        <div className={styles.chat_header_actions}>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleNewChat}
                                disabled={streaming || !hasTurns}
                                aria-label="Start a new conversation"
                            >
                                <Plus size={16} /> New chat
                            </Button>
                        </div>
                    </div>

                    {editingPrompt && (
                        <PromptEditorBar
                            prompt={loadedPrompt}
                            name={promptName}
                            onNameChange={setPromptName}
                            dirty={promptDirty}
                            saving={promptSaving}
                            saveBlockedReason={saveBlockedReason}
                            onSave={() => { void handleSavePrompt(); }}
                            runBlockedReason={promptDirty
                                ? 'Save first — Run executes the stored prompt, not your unsaved edits.'
                                : null}
                            onRun={() => { if (loadedPrompt) { void handleRunSavedPrompt(loadedPrompt); } }}
                            onDuplicate={() => { void handleDuplicatePrompt(); }}
                            onDelete={confirmDeletePrompt}
                            onClose={handleCloseEditor}
                            triggersOpen={triggersOpen}
                            onToggleTriggers={() => setTriggersOpen(open => !open)}
                            triggerCount={triggerDrafts.length}
                        />
                    )}

                    <div ref={transcriptRef} className={styles.transcript}>
                        {error && (
                            <div className={styles.chat_error} role="alert">
                                <AlertCircle size={16} className={styles.chat_error_icon} />
                                <span>{error}</span>
                            </div>
                        )}

                        {hasTurns ? (
                            messages.map(turn => {
                                const isUser = turn.role === 'user';
                                // Chips for a user turn: what the prompt was granted, unioned
                                // with the registry tools the answer actually called. Both come
                                // from turnToolsByTurnId, which is also what the bookmark saves,
                                // so the row and the saved allowlist can never disagree.
                                const calledTools = isUser ? calledToolsByTurnId.get(turn.id) : undefined;
                                const turnTools = isUser ? (turnToolsByTurnId.get(turn.id) ?? []) : [];
                                return (
                                    <div
                                        key={turn.id}
                                        className={`${styles.turn} ${isUser ? styles.turn_user : styles.turn_assistant}`}
                                    >
                                        <div className={styles.turn_avatar}>
                                            {isUser ? <User size={16} /> : <Bot size={16} />}
                                        </div>
                                        <div className={styles.turn_main}>
                                            <div className={styles.turn_header}>
                                                <span className={styles.turn_role}>{isUser ? 'You' : 'Assistant'}</span>
                                                {!isUser && turn.content && !turn.pending && (
                                                    <IconButton
                                                        variant="primary"
                                                        size="sm"
                                                        className={styles.turn_copy}
                                                        onClick={() => { void handleCopy(turn.id, turn.content); }}
                                                        aria-label="Copy message to clipboard"
                                                    >
                                                        {copiedTurnId === turn.id ? <CheckCircle size={14} /> : <Copy size={14} />}
                                                    </IconButton>
                                                )}
                                            </div>

                                            {isUser ? (
                                                <>
                                                    <div className={styles.turn_text}>{turn.content}</div>
                                                    <div className={styles.turn_tools}>
                                                        <IconButton
                                                            variant="ghost"
                                                            size="xs"
                                                            className={styles.turn_tools_save}
                                                            onClick={() => { void handleSaveTurnAsPrompt(turn); }}
                                                            disabled={savingTurnId !== null || !turn.content.trim()}
                                                            title="Save this prompt and its tools below"
                                                            aria-label="Save this prompt and its tools as a saved prompt"
                                                        >
                                                            <Bookmark size={14} />
                                                        </IconButton>
                                                        {turnTools.length > 0 && (
                                                            <ul className={styles.turn_tool_list}>
                                                                {turnTools.map(name => {
                                                                    const wasCalled = calledTools?.has(name) ?? false;
                                                                    return (
                                                                        <li
                                                                            key={name}
                                                                            className={`${styles.turn_tool_chip} ${wasCalled ? styles['turn_tool_chip--called'] : ''}`}
                                                                            title={wasCalled
                                                                                ? `${name} — called in this turn`
                                                                                : `${name} — allowed for this turn, not called`}
                                                                        >
                                                                            {name}
                                                                        </li>
                                                                    );
                                                                })}
                                                            </ul>
                                                        )}
                                                    </div>
                                                </>
                                            ) : (
                                                <AssistantTurnBody
                                                    turn={turn}
                                                    recordsById={toolRecordsById}
                                                    onSelectRecord={setSelectedRecord}
                                                    modelLabel={modelLabel}
                                                />
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            !error && (
                                <div className={styles.empty_state}>
                                    <Bot size={24} className={styles.empty_state_icon} />
                                    <span>Start a conversation with the active AI provider. Responses stream in live.</span>
                                </div>
                            )
                        )}

                        {unlinkedRecords.length > 0 && (
                            // Invocations the transcript above cannot link to, because they
                            // carry no `toolUseId` to pair with a call. Without this block
                            // their detail — status, duration, cost, screen verdict — would
                            // be unreachable from the chat view.
                            <div className={styles.unlinked_records}>
                                <span className={styles.unlinked_records_note}>
                                    Tool calls this transcript cannot link to
                                </span>
                                <InvocationTable records={unlinkedRecords} onSelect={setSelectedRecord} />
                            </div>
                        )}
                    </div>

                    <div className={styles.composer}>
                        {/* Textarea and granted-tool chips are one group so the chips sit
                            tight under the input rather than a full composer gap away. */}
                        <div className={styles.composer_input_group}>
                            <Textarea
                                ref={textareaRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Send a message… (Ctrl+Enter to send)"
                                className={styles.composer_input}
                                rows={3}
                                aria-label="Message input"
                                disabled={streaming}
                            />
                            {grantedTools.length > 0 && (
                                <ul className={styles.composer_chips}>
                                    {grantedTools.map(name => (
                                        <li key={name}>
                                            <button
                                                type="button"
                                                className={styles.composer_chip}
                                                onClick={() => handleRevokeTool(name)}
                                                disabled={streaming}
                                                title={`Remove ${name} from this message`}
                                                aria-label={`Remove ${name} from the tools this message may call`}
                                            >
                                                {name}
                                                <X size={12} aria-hidden="true" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <div className={styles.composer_toolbar}>
                            {providers.length > 0 && (
                                <Select
                                    value={modelOverride}
                                    onChange={(e) => setModelOverride(e.target.value)}
                                    className={styles.model_select}
                                    aria-label="Model for the next message"
                                    title={editingPrompt
                                        ? 'Model for the next message, and the model this prompt pins for its autonomous runs'
                                        : "Model for the next message — Default uses the active provider's configured model"}
                                >
                                    <option value="">Default model</option>
                                    {providers.map(provider => (
                                        <optgroup
                                            key={provider.id}
                                            label={provider.active ? `${provider.label} (active)` : provider.label}
                                        >
                                            {provider.models.map(model => (
                                                <option key={`${provider.id}|${model.id}`} value={`${provider.id}|${model.id}`}>
                                                    {model.display_name}
                                                </option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </Select>
                            )}
                            {pinnedProviderInactive && (
                                <span className={styles.model_pin_note}>
                                    {editingPrompt
                                        ? 'Not the active provider — applies to scheduled runs only.'
                                        : 'Not the active provider — this message runs on the active provider’s default model.'}
                                </span>
                            )}
                            <ToolAllowlistDropdown
                                tools={tools}
                                selected={toolSelection}
                                onChange={handleToolSelectionChange}
                                trifecta={trifecta}
                                trifectaLoading={trifectaLoading}
                                onOpenChange={setToolsOpen}
                                disabled={streaming}
                                hint={editingPrompt
                                    ? 'Tools this saved prompt may call, on this message and on every autonomous run. An empty selection runs it with no tools. Provider-hosted tools (web search / fetch), when enabled for the model, still run regardless. Naming a tool that is later disabled or removed fails the run.'
                                    : undefined}
                            />
                            <div className={styles.composer_send}>
                                {streaming ? (
                                    <Button
                                        variant="danger"
                                        size="md"
                                        onClick={() => { void handleStop(); }}
                                        aria-label="Stop the in-flight response"
                                    >
                                        <X size={18} /> Stop
                                    </Button>
                                ) : (
                                    <Button
                                        variant="primary"
                                        size="md"
                                        onClick={() => { void handleSend(); }}
                                        disabled={!input.trim() || (needsToolPrefill && toolsLoading)}
                                        aria-label="Send message"
                                    >
                                        <Send size={18} /> Send
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>

                    {editingPrompt && triggersOpen && (
                        <PromptTriggersEditor
                            promptId={loadedPromptId ?? 'new'}
                            drafts={triggerDrafts}
                            onChange={setTriggerDrafts}
                            stored={loadedPrompt?.triggers ?? []}
                            bindableHooks={bindableHooks}
                            disabled={promptSaving}
                        />
                    )}
                </Card>
                </>
            ) : (
                <Stack gap="md">
                    <div className={styles.history_header}>
                        <span className={styles.history_title}>
                            <History size={16} /> Past conversations
                        </span>
                        <span className={styles.history_count}>
                            {historyLoading ? 'Loading…' : `${conversations.length} conversation${conversations.length === 1 ? '' : 's'}`}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => { void loadHistory(); }} aria-label="Refresh history">
                            <RefreshCw size={16} /> Refresh
                        </Button>
                    </div>

                    {historyError && <div className="alert" role="alert">{historyError}</div>}

                    {!historyLoading && conversations.length === 0
                        ? <div className={pageStyles.placeholder}>No conversations recorded yet.</div>
                        : (
                            <ul className={styles.history_list}>
                                {conversations.map(group => {
                                    const isExpanded = expandedIds.has(group.conversationId);
                                    return (
                                    <li key={group.conversationId} className={styles.history_item}>
                                        <div className={styles.history_item_main}>
                                            <div className={styles.history_item_prompt_row}>
                                                <IconButton
                                                    variant="ghost"
                                                    size="sm"
                                                    className={styles.history_item_expand}
                                                    onClick={() => toggleExpanded(group.conversationId)}
                                                    aria-expanded={isExpanded}
                                                    aria-label={isExpanded ? 'Collapse query' : 'Expand full query'}
                                                >
                                                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                </IconButton>
                                                <span
                                                    className={`${styles.history_item_prompt} ${isExpanded ? styles.history_item_prompt_expanded : ''}`}
                                                >
                                                    {group.firstPrompt}
                                                </span>
                                            </div>
                                            <span className={styles.history_item_meta}>
                                                <ClientTime date={group.lastAt} format="datetime" />
                                                <span>· {group.turns} turn{group.turns === 1 ? '' : 's'}</span>
                                                {group.mode === 'scheduled' && <Badge tone="info">Scheduled</Badge>}
                                                {group.status === 'failed' && (
                                                    // The reason rides along as a tooltip so the common
                                                    // case — reading why last night's scheduled run died —
                                                    // costs a hover rather than an expand.
                                                    <Badge tone="danger" title={group.errorMessage ?? undefined}>Failed</Badge>
                                                )}
                                            </span>
                                        </div>
                                        <span
                                            className={styles.history_item_cost}
                                            title="Estimated cost across this conversation's recently-loaded turns, at the provider's per-model rates. Open the conversation to see every turn."
                                            aria-label={group.costUsd !== null ? `Estimated cost across loaded turns: ${formatUsd(group.costUsd)}` : 'Cost not available'}
                                        >
                                            {formatUsd(group.costUsd)}
                                        </span>
                                        <div className={styles.history_item_actions}>
                                            <IconButton
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => { void handleCopy(group.conversationId, group.firstPrompt); }}
                                                aria-label="Copy query to clipboard"
                                            >
                                                {copiedTurnId === group.conversationId ? <CheckCircle size={14} /> : <Copy size={14} />}
                                            </IconButton>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => guardUnsavedPrompt(() => { void openConversation(group.conversationId); })}
                                                aria-label={`Open conversation starting "${group.firstPrompt}" in chat`}
                                            >
                                                <MessageSquare size={16} /> Open in chat
                                            </Button>
                                        </div>
                                        {isExpanded && (() => {
                                            // Full-width detail beneath the row (spans all three grid tracks),
                                            // fetched lazily on first expand. It replays the conversation with
                                            // the same markup the live chat uses — prompt, answer or transcript,
                                            // failure reason, usage and cost — then lists any tool call the
                                            // transcript could not account for, exactly as the chat does.
                                            const turns = historyTurns.get(group.conversationId) ?? [];
                                            const records = historyToolRecords.get(group.conversationId) ?? [];
                                            const leftovers = selectUnlinkedRecords(turns, records);
                                            return (
                                            <div className={styles.history_item_tools}>
                                                {historyToolLoading.has(group.conversationId) ? (
                                                    <span className={styles.history_item_tools_note}>Loading conversation…</span>
                                                ) : historyToolError.has(group.conversationId) ? (
                                                    <span className={styles.history_item_tools_note} role="alert">
                                                        {historyToolError.get(group.conversationId)}
                                                    </span>
                                                ) : (
                                                    <>
                                                        <div className={styles.history_item_transcript}>
                                                            {turns.map(turn => {
                                                                const isUserTurn = turn.role === 'user';
                                                                return (
                                                                    <div
                                                                        key={turn.id}
                                                                        className={`${styles.turn} ${isUserTurn ? styles.turn_user : styles.turn_assistant}`}
                                                                    >
                                                                        <div className={styles.turn_avatar}>
                                                                            {isUserTurn ? <User size={16} /> : <Bot size={16} />}
                                                                        </div>
                                                                        <div className={styles.turn_main}>
                                                                            <div className={styles.turn_header}>
                                                                                <span className={styles.turn_role}>{isUserTurn ? 'You' : 'Assistant'}</span>
                                                                            </div>
                                                                            {isUserTurn ? (
                                                                                <div className={styles.turn_text}>{turn.content}</div>
                                                                            ) : (
                                                                                <AssistantTurnBody
                                                                                    turn={turn}
                                                                                    recordsById={historyRecordsById.get(group.conversationId) ?? NO_TOOL_RECORDS}
                                                                                    onSelectRecord={setSelectedRecord}
                                                                                    modelLabel={modelLabel}
                                                                                />
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                        {leftovers.length > 0 && (
                                                            <div className={styles.unlinked_records}>
                                                                <span className={styles.unlinked_records_note}>
                                                                    Tool calls this transcript cannot link to
                                                                </span>
                                                                <InvocationTable records={leftovers} onSelect={setSelectedRecord} />
                                                            </div>
                                                        )}
                                                        {turns.length === 0 && records.length === 0 && (
                                                            <span className={styles.history_item_tools_note}>
                                                                Nothing recorded for this conversation.
                                                            </span>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                            );
                                        })()}
                                    </li>
                                    );
                                })}
                            </ul>
                        )}
                </Stack>
            )}

            <SlideOver
                open={selectedRecord !== null}
                onClose={() => setSelectedRecord(null)}
                label={selectedRecord ? `Invocation ${selectedRecord.toolName}` : undefined}
                title={selectedRecord ? <span className={styles.tool_call_name}>{selectedRecord.toolName}</span> : null}
            >
                {selectedRecord && <InvocationDetailPanel record={selectedRecord} />}
            </SlideOver>
        </div>
    );
}
