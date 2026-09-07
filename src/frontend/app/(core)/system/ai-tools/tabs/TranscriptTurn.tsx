'use client';

/**
 * @file TranscriptTurn.tsx
 *
 * One turn of the Query tab's transcript: a user message as a right-aligned
 * bubble, or an assistant answer as flush prose with its thinking and tool
 * activity folded in. The per-turn actions — copy, save-as-prompt, the tool
 * chips — and the usage line live in a footer that stays out of the way until
 * the turn is hovered or focused, so a long conversation reads as a
 * conversation rather than as a list of toolbars.
 *
 * Every export here is memoised. The transcript re-renders on every streamed
 * token, and before this split each token re-ran the Markdown pipeline for
 * every text segment of every turn on the page. Now a settled turn keeps its
 * props from one render to the next and is skipped, and a settled segment's
 * HTML is cached against its text, so the cost of a chunk is the cost of the
 * one segment still growing.
 */

import { memo, useMemo, useState } from 'react';
import { ChevronRight, Brain, Wrench, CornerDownRight, Info, Copy, CheckCircle, Bookmark, AlertCircle } from 'lucide-react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type { IAiToolResultSegment, IAiTranscriptSegment, IToolInvocationRecord } from '@/types';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { IconButton } from '../../../../../components/ui/IconButton';
import { formatUsd } from './formatUsd';
import type { IChatTurn } from './IChatTurn';
import styles from './TranscriptTurn.module.scss';

/**
 * Singleton unified processor converting assistant markdown to sanitized HTML.
 * The pipeline parses markdown (remark-parse + GFM), bridges to a HAST tree via
 * remark-rehype WITHOUT `allowDangerousHtml` so any raw HTML the model emits is
 * dropped, then runs rehype-sanitize (GitHub-flavored default schema) to strip
 * dangerous elements/attributes before serializing. This is real sanitization —
 * required because the output is rendered via dangerouslySetInnerHTML on
 * AI-generated, untrusted-influenced content.
 */
const markdownProcessor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeStringify);

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
 * One run of answer prose, rendered through the sanitising Markdown pipeline
 * and cached against its text. This is the unit the streaming cost is paid in:
 * only the segment whose text changed re-parses, every other segment on the
 * page reuses its HTML.
 *
 * @param props.text - The Markdown for this run of prose.
 * @param props.pending - Whether this is the trailing run of a turn still
 *   streaming, which is where the cursor belongs.
 * @returns The rendered prose block.
 */
const MarkdownBlock = memo(function MarkdownBlock({ text, pending }: { text: string; pending: boolean }) {
    const html = useMemo(() => renderAssistantHtml(text, pending), [text, pending]);
    return (
        <div
            className={styles.turn_markdown}
            // Assistant text is sanitized by the rehype-sanitize pipeline in renderAssistantHtml.
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
});

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
 * inside the call's own card rather than sitting in a sibling block the reader
 * has to re-pair by eye.
 *
 * @param props.segments - The turn's ordered transcript segments.
 * @param props.recordsById - The conversation's audit records keyed by their
 *   `toolUseId`, so a tool_use segment can resolve its exact invocation record.
 *   A miss simply renders the call without a detail affordance.
 * @param props.onSelectRecord - Opens the matched record's detail panel.
 * @param props.pending - Whether the turn is still streaming. Drives the cursor
 *   on the trailing prose and the "running" hint on a call whose result has not
 *   landed.
 * @returns The rendered transcript.
 */
function AssistantSegments({ segments, recordsById, onSelectRecord, pending }: {
    segments: IAiTranscriptSegment[];
    recordsById: Map<string, IToolInvocationRecord>;
    onSelectRecord: (record: IToolInvocationRecord) => void;
    pending: boolean;
}) {
    // Index each result by the call it answered so the call can render it inline.
    // A result whose `toolUseId` matches no call in this transcript stays
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
    // position rather than by `toolUseId` keeps the no-silent-drop rule honest:
    // only the first result per id is claimed inline, so a second result
    // carrying the same id still renders below as its own block.
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
                // positional keys React would reuse the DOM node, and with it the
                // open/closed state of an uncontrolled <details>, for whatever
                // segment now occupies that slot.
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
                    const auditRecord = segment.id ? recordsById.get(segment.id) : undefined;
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
                                {auditRecord && (
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        className={styles.tool_call_action}
                                        onClick={(event) => {
                                            // The button lives inside the <summary>, whose
                                            // default action is to toggle the card. Opening
                                            // the audit panel is a different intent.
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
                // right now — the last segment of a still-streaming turn.
                const isTrailingText = pending && index === segments.length - 1;
                return <MarkdownBlock key={key} text={segment.text} pending={isTrailingText} />;
            })}
        </div>
    );
}

/**
 * The usage line under an assistant answer: cost and model at a glance, with
 * the token breakdown one click away. Always showing every count made each
 * answer end in a row of numbers most readers never need; hiding it entirely
 * would lose the one figure — cost — an operator does watch.
 *
 * @param props.turn - The assistant turn whose usage to describe.
 * @param props.modelLabel - Model id to display name, so the line names a model
 *   the way the provider's own picker does rather than by raw id.
 * @returns The usage line, or null when the turn carries no usage at all.
 */
function TurnMeta({ turn, modelLabel }: { turn: IChatTurn; modelLabel: Map<string, string> }) {
    const [expanded, setExpanded] = useState(false);
    const usage = turn.usage;
    if (!usage) {
        return null;
    }
    const model = turn.model ? (modelLabel.get(turn.model) ?? turn.model) : null;
    const summary = [
        turn.costUsd != null ? `≈ ${formatUsd(turn.costUsd)}` : null,
        model
    ].filter((part): part is string => part !== null).join(' · ');
    return (
        <span className={styles.turn_meta}>
            <button
                type="button"
                className={styles.turn_meta_toggle}
                onClick={() => setExpanded(value => !value)}
                aria-expanded={expanded}
                title={expanded ? 'Hide token usage' : 'Show token usage'}
            >
                {summary || 'usage'}
            </button>
            {expanded && (
                <span className={styles.turn_meta_detail}>
                    {usage.inputTokens} in / {usage.outputTokens} out
                    {(usage.cacheReadInputTokens ?? 0) > 0 && ` · ${usage.cacheReadInputTokens} cache read`}
                    {(usage.cacheCreationInputTokens ?? 0) > 0 && ` · ${usage.cacheCreationInputTokens} cache write`}
                </span>
            )}
        </span>
    );
}

/** Props for {@link TranscriptTurn}. */
export interface ITranscriptTurnProps {
    /** The turn to render, live or rebuilt from history. */
    turn: IChatTurn;
    /**
     * Audit records keyed by `toolUseId`, so a tool call in an assistant turn
     * can open its own invocation detail. Unused on a user turn.
     */
    recordsById: Map<string, IToolInvocationRecord>;
    /** Opens the invocation detail slide-over for one record. */
    onSelectRecord: (record: IToolInvocationRecord) => void;
    /** Model id to display name for the usage line. */
    modelLabel: Map<string, string>;
    /** Whether this turn's text was just copied, so the copy control shows a check. */
    copied: boolean;
    /** Copy the turn's text, flashing confirmation on the control that asked. */
    onCopy: (turnId: string, text: string) => void;
    /**
     * For a user turn: the tools it was granted or that its answer called, as
     * chips. The parent keeps this array's identity stable across renders so
     * the memo below holds.
     */
    tools?: string[];
    /** For a user turn: the subset of `tools` the answer actually called. */
    calledTools?: ReadonlySet<string>;
    /** For a user turn: save its text and tools as a new saved prompt. Absent hides the control. */
    onSaveAsPrompt?: (turn: IChatTurn) => void;
    /** Whether the save-as-prompt control is disabled (a save is in flight). */
    saveDisabled?: boolean;
}

/**
 * One transcript turn. Memoised so a streamed chunk re-renders only the turn
 * it changed; every other turn keeps identical props and is skipped.
 *
 * The turn's root carries `data-turn-id` so the parent can find the element to
 * anchor the view to after a send, without holding a ref per turn.
 *
 * @param props - See {@link ITranscriptTurnProps}.
 * @returns The rendered turn.
 */
export const TranscriptTurn = memo(function TranscriptTurn({
    turn,
    recordsById,
    onSelectRecord,
    modelLabel,
    copied,
    onCopy,
    tools,
    calledTools,
    onSaveAsPrompt,
    saveDisabled = false
}: ITranscriptTurnProps) {
    const isUser = turn.role === 'user';

    if (isUser) {
        const tooling = tools ?? [];
        return (
            <article
                className={`${styles.turn} ${styles.turn_user}`}
                data-turn-id={turn.id}
                aria-label="Your message"
            >
                <div className={styles.turn_text}>{turn.content}</div>
                <div className={`${styles.turn_footer} ${styles.turn_footer_user}`}>
                    <div className={styles.turn_actions}>
                        <IconButton
                            variant="ghost"
                            size="xs"
                            onClick={() => onCopy(turn.id, turn.content)}
                            aria-label="Copy message to clipboard"
                            title="Copy message"
                        >
                            {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                        </IconButton>
                        {onSaveAsPrompt && (
                            <IconButton
                                variant="ghost"
                                size="xs"
                                onClick={() => onSaveAsPrompt(turn)}
                                disabled={saveDisabled || !turn.content.trim()}
                                title="Save this prompt and its tools as a saved prompt"
                                aria-label="Save this prompt and its tools as a saved prompt"
                            >
                                <Bookmark size={14} />
                            </IconButton>
                        )}
                    </div>
                    {tooling.length > 0 && (
                        <ul className={styles.turn_tool_list}>
                            {tooling.map(name => {
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
            </article>
        );
    }

    return (
        <article
            className={`${styles.turn} ${styles.turn_assistant}`}
            data-turn-id={turn.id}
            aria-label="Assistant reply"
        >
            {turn.segments && turn.segments.length > 0 ? (
                // Any turn with structure renders it: a settled one shows its full
                // transcript, and a streaming one shows what has settled so far, so
                // a tool call is visible while it runs rather than only at the end.
                <AssistantSegments
                    segments={turn.segments}
                    recordsById={recordsById}
                    onSelectRecord={onSelectRecord}
                    pending={!!turn.pending}
                />
            ) : (
                <MarkdownBlock text={turn.content} pending={!!turn.pending} />
            )}

            {turn.error && (
                <div className={styles.turn_error}>
                    <AlertCircle size={14} />
                    <span>{turn.error}</span>
                </div>
            )}

            {!turn.pending && (
                <div className={styles.turn_footer}>
                    <div className={styles.turn_actions}>
                        {turn.content && (
                            <IconButton
                                variant="ghost"
                                size="xs"
                                onClick={() => onCopy(turn.id, turn.content)}
                                aria-label="Copy reply to clipboard"
                                title="Copy reply"
                            >
                                {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                            </IconButton>
                        )}
                    </div>
                    <TurnMeta turn={turn} modelLabel={modelLabel} />
                </div>
            )}
        </article>
    );
});
