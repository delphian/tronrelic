'use client';

/**
 * @fileoverview Query tab — the core-owned, provider-neutral AI chat surface on
 * the /system/ai-tools dashboard. A multi-turn conversation streamed over the
 * shared core socket: each send mints a client-side `queryId`, POSTs the prompt
 * with the prior turns as history, and appends the streamed deltas to a pending
 * assistant turn by filtering the GLOBAL `ai-tools:query-stream` event on that
 * id. A model picker reads `GET /query/models` (graceful when empty), and a
 * history view groups past records by `conversationId` so any thread can be
 * reopened into the transcript. Like the sibling tabs this is an interactive
 * admin client surface, not an SSR-first public component — loading states are
 * appropriate for its secondary data and user-triggered sends.
 *
 * A per-run tool allowlist (a collapsed disclosure in the composer) narrows which
 * tools the next send may call. It defaults to no tools — least privilege — so a
 * manual query is inert until the operator deliberately grants a tool for that
 * run. Being one-shot, it has no three-state contract to preserve: the explicit
 * selection is sent verbatim on every send (`[]` = no tools; a name list = that
 * subset), and a scoped lethal-trifecta preview updates while the disclosure is open.
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Send, Bot, User, AlertCircle, X, Copy, CheckCircle, Plus, History, MessageSquare, RefreshCw, ChevronDown, ChevronRight, Brain, Wrench, CornerDownRight, Info, Play } from 'lucide-react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type { IAiConversationMessage, IAiQueryRecord, IAiStreamChunk, IAiToolInfo, IAiTranscriptSegment, IModelInfo, ISavedPrompt, IToolInvocationRecord, ITrifectaStatus } from '@/types';
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
    getQueryModels,
    listActivity,
    listTools,
    getTrifectaPreview,
    runSavedPromptNow,
    type IStreamAck
} from '../../../../../modules/ai-tools';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { SavedPromptsPanel } from './SavedPromptsPanel';
import { InvocationDetailPanel } from '../components/InvocationDetailPanel';
import { InvocationTable } from '../components/InvocationTable';
import { ToolAllowlistPicker } from '../components/ToolAllowlistPicker';
import { RunTrifectaBadge } from '../components/RunTrifectaBadge';
import pageStyles from '../page.module.scss';
import styles from './QueryTab.module.scss';

/** WebSocket event carrying a streamed AI response chunk to the dashboard. */
const QUERY_STREAM_EVENT = 'ai-tools:query-stream';

/** Number of history records pulled for the grouped conversation list. */
const HISTORY_LIMIT = 100;

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
 * Render an assistant turn's structured transcript — the thinking, tool calls,
 * tool results, and answer text in the order they occurred. This is what lets a
 * reopened conversation (or a just-completed live turn) show the whole turn
 * instead of only its final answer: history persists no other structure, so
 * without this the thinking and tool activity would be invisible. Thinking is
 * tucked into a collapsed `<details>` so a long chain of reasoning never buries
 * the answer; tool calls and results render as labelled blocks, errors flagged.
 * Answer text reuses the same sanitized-Markdown pipeline as a streaming turn so
 * the prose reads identically whether live or replayed.
 *
 * @param segments - The turn's ordered transcript segments.
 * @param recordsById - The conversation's audit records keyed by their `toolUseId`,
 *   so a tool_use segment can resolve its exact invocation record. Absent (or a
 *   miss) simply renders the call without a detail affordance — legacy records and
 *   the pre-`toolUseId` provider degrade gracefully rather than breaking.
 * @param onSelectRecord - Opens the matched record's detail panel. Omitted when the
 *   host has no detail surface (nothing becomes clickable).
 * @returns The rendered transcript.
 */
function AssistantSegments({ segments, recordsById, onSelectRecord }: {
    segments: IAiTranscriptSegment[];
    recordsById?: Map<string, IToolInvocationRecord>;
    onSelectRecord?: (record: IToolInvocationRecord) => void;
}) {
    return (
        <div className={styles.segments}>
            {segments.map((segment, index) => {
                if (segment.type === 'thinking') {
                    return (
                        <details key={index} className={styles.thinking}>
                            <summary className={styles.thinking_summary}>
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
                    return (
                        <div key={index} className={styles.tool_call}>
                            <div className={styles.tool_call_header}>
                                <Wrench size={14} />
                                <span className={styles.tool_call_name}>{segment.name || 'tool'}</span>
                                {segment.server && <Badge tone="info">server</Badge>}
                                {auditRecord && onSelectRecord && (
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        className={styles.tool_call_action}
                                        onClick={() => onSelectRecord(auditRecord)}
                                        aria-label={`View the audit record for the ${segment.name || 'tool'} call`}
                                    >
                                        <Info size={14} /> Details
                                    </Button>
                                )}
                            </div>
                            <pre className={styles.tool_payload}>{formatToolPayload(segment.input)}</pre>
                        </div>
                    );
                }
                if (segment.type === 'tool_result') {
                    return (
                        <div
                            key={index}
                            className={`${styles.tool_result} ${segment.isError ? styles['tool_result--error'] : ''}`}
                        >
                            <div className={styles.tool_call_header}>
                                <CornerDownRight size={14} />
                                <span className={styles.tool_call_name}>{segment.isError ? 'Tool error' : 'Tool result'}</span>
                            </div>
                            <pre className={styles.tool_payload}>{formatToolPayload(segment.content)}</pre>
                        </div>
                    );
                }
                return (
                    <div
                        key={index}
                        className={styles.turn_markdown}
                        // Assistant text is sanitized by the rehype-sanitize pipeline in renderAssistantHtml.
                        dangerouslySetInnerHTML={{ __html: renderAssistantHtml(segment.text, false) }}
                    />
                );
            })}
        </div>
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
            byId.set(id, { conversationId: id, turns: 1, firstPrompt: record.prompt, lastAt: record.createdAt, mode: record.mode, costUsd: turnCost });
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

/**
 * Query tab content. Owns the chat transcript, the streaming lifecycle keyed by
 * a per-send `queryId`, the model picker, and the grouped history view.
 *
 * @returns The tab.
 */
export function QueryTab() {
    const { push } = useToast();
    const [messages, setMessages] = useState<ChatTurn[]>([]);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [models, setModels] = useState<IModelInfo[]>([]);
    const [modelOverride, setModelOverride] = useState<string>('');
    /** The full tool registry (enabled + disabled), backing the per-run allowlist picker. */
    const [tools, setTools] = useState<IAiToolInfo[]>([]);
    /**
     * Tool names the next send is allowed to call. Defaults to none — a manual
     * query does nothing dangerous unless the operator grants a tool for that
     * run. Sent verbatim to the governor on every send: `[]` = no tools, a list =
     * that subset (no three-state contract, since a one-shot run persists nothing).
     */
    const [toolSelection, setToolSelection] = useState<string[]>([]);
    /** Whether the composer's Tools disclosure is open; gates the trifecta preview so it runs only when visible. */
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
    /** Shared saved-prompts list; the panel loads it on first open and the composer reads it. */
    const [savedPrompts, setSavedPrompts] = useState<ISavedPrompt[]>([]);
    /** Conversation ids whose full opening prompt is expanded inline in the history list. */
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
    /**
     * Per-conversation tool-invocation audit records for the history list, keyed
     * by conversationId and loaded lazily the first time a row is expanded. Kept
     * separate from {@link conversationRecords} (which backs the open chat) so an
     * expanded history row and the active conversation never overwrite each other.
     * Cached across collapse/re-expand and across a history Refresh because a past
     * conversation's tool calls are immutable — no point refetching them.
     */
    const [historyToolRecords, setHistoryToolRecords] = useState<Map<string, IToolInvocationRecord[]>>(() => new Map());
    /** Conversation ids whose history-row tool records are currently loading. */
    const [historyToolLoading, setHistoryToolLoading] = useState<Set<string>>(() => new Set());
    /** Conversation ids whose history-row tool-record fetch failed, mapped to the error. */
    const [historyToolError, setHistoryToolError] = useState<Map<string, string>>(() => new Map());
    /**
     * Tool-invocation audit records for the open conversation, loaded from the
     * Activity feed scoped by conversationId. Backs the transcript's per-call
     * "Details" deep-links and the "tools used" summary feed.
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
    const toolRecordsById = useMemo(() => {
        const map = new Map<string, IToolInvocationRecord>();
        for (const record of conversationRecords) {
            if (record.toolUseId) {
                map.set(record.toolUseId, record);
            }
        }
        return map;
    }, [conversationRecords]);

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

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (copyTimerRef.current) {
                clearTimeout(copyTimerRef.current);
            }
        };
    }, []);

    // Load the active provider's models once. Empty array ⇒ no override choices.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const list = await getQueryModels();
                if (!cancelled) {
                    setModels(list);
                }
            } catch {
                /* secondary data — the picker simply offers no choices on failure */
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
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Preview the lethal-trifecta posture of the current selection, but only
    // while the Tools disclosure is open — a closed disclosure needs no preview,
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
     * calls can deep-link to their exact invocation detail and the "tools used"
     * feed can list them. Secondary data — a failure just leaves the audit
     * affordances absent, never blocks the chat. Reads the same admin-gated feed
     * the Activity tab uses, scoped by conversationId.
     *
     * @param conversationId - The conversation whose tool calls to load.
     */
    const refreshConversationActivity = useCallback(async (conversationId: string) => {
        try {
            const page = await listActivity({ conversationId, limit: 200 });
            // Drop out-of-order responses: a slower fetch for a conversation the
            // operator has since navigated away from must not overwrite the
            // active conversation's records (which back the "Tools used" feed and
            // the transcript's per-call "Details" deep-links).
            if (isMountedRef.current && conversationId === conversationIdRef.current) {
                setConversationRecords(page.records);
            }
        } catch {
            /* secondary data — the transcript still renders without audit links */
        }
    }, []);

    /**
     * Lazily load one history row's tool-invocation audit records the first time
     * it is expanded, so the row can reveal exactly which tools that conversation
     * ran without reopening the whole thread. Reads the same admin-gated Activity
     * feed the chat view uses, scoped by conversationId. Secondary data on a user
     * action — a failure is captured per-row and shown inline rather than blocking
     * the list. Idempotent: callers gate on the cache so a record set is fetched
     * once and reused across collapse/re-expand.
     *
     * @param conversationId - The conversation whose tool calls to load.
     */
    const loadHistoryToolRecords = useCallback(async (conversationId: string) => {
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
            const page = await listActivity({ conversationId, limit: 200 });
            if (!isMountedRef.current) {
                return;
            }
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
                next.set(conversationId, err instanceof Error ? err.message : 'Failed to load tool calls');
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
     * the active queryId so a stale or unrelated query's chunks are ignored —
     * the backend broadcasts `ai-tools:query-stream` globally, so this client
     * is responsible for the correlation.
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
            updateTurn(turnId, turn => ({ content: turn.content + text }));
        } else if (chunk.type === 'done') {
            setStreaming(false);
            // Adopt the finalized transcript so the just-completed turn shows the
            // same thinking/tool structure history does, without a reload. Absent
            // for a plain text turn — the streamed `content` already covers it.
            updateTurn(turnId, {
                pending: false,
                usage: chunk.usage ?? null,
                costUsd: chunk.costUsd ?? null,
                ...(chunk.transcript && chunk.transcript.length > 0 ? { segments: chunk.transcript } : {})
            });
            streamingTurnIdRef.current = null;
            activeQueryIdRef.current = null;
            // The turn produced its audit records as it ran; pull them so the
            // just-completed tool calls gain their "Details" deep-link and the
            // tools-used feed reflects this turn without reopening from history.
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

        const userTurn: ChatTurn = { id: generateUUID(), role: 'user', content: trimmed };
        const assistantTurnId = generateUUID();
        const assistantTurn: ChatTurn = {
            id: assistantTurnId,
            role: 'assistant',
            content: '',
            pending: true,
            model: modelOverride || undefined
        };
        setMessages(prev => [...prev, userTurn, assistantTurn]);
        setInput('');

        const queryId = generateUUID();
        activeQueryIdRef.current = queryId;
        streamingTurnIdRef.current = assistantTurnId;
        setStreaming(true);

        try {
            const ack = await submitQuery({
                prompt: trimmed,
                queryId,
                socketId,
                model: modelOverride || undefined,
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
            setToolSelection([]);
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
    }, [input, streaming, messages, modelOverride, toolSelection, updateTurn]);

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

    /** Start a fresh conversation: clear the transcript and mint a new id. */
    const handleNewChat = useCallback(() => {
        if (streaming) {
            return;
        }
        setMessages([]);
        setError(null);
        streamingTurnIdRef.current = null;
        activeQueryIdRef.current = null;
        conversationIdRef.current = null;
        setConversationRecords([]);
        setSelectedRecord(null);
    }, [streaming]);

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
        // Fetch this row's tool calls once, on first expand. Skip when a prior
        // fetch already succeeded or is still in flight. A prior *failure* does not
        // skip: re-expanding retries the fetch, and loadHistoryToolRecords clears
        // the stale error at the start of the new request.
        if (
            willExpand &&
            !historyToolRecords.has(conversationId) &&
            !historyToolLoading.has(conversationId)
        ) {
            void loadHistoryToolRecords(conversationId);
        }
    }, [expandedIds, historyToolRecords, historyToolLoading, loadHistoryToolRecords]);

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
            const rebuilt: ChatTurn[] = [];
            for (const record of records) {
                rebuilt.push({ id: generateUUID(), role: 'user', content: record.prompt });
                // A turn has a body when it left answer text OR a structured
                // transcript (a tool-only round can finish with no final text yet
                // still have plenty to show). Only a truly empty, non-failed
                // record falls back to the "No response recorded" note.
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
            setStreaming(false);
            setError(null);
            streamingTurnIdRef.current = null;
            activeQueryIdRef.current = null;
            conversationIdRef.current = conversationId;
            setMessages(rebuilt);
            // Drop the previous conversation's audit records up front so the
            // "Tools used" summary and the transcript's tool-detail lookup never
            // show the prior thread's tools during this conversation's in-flight
            // activity fetch — or permanently, if that fetch fails. The clear
            // lives here, not in refreshConversationActivity, because the live
            // streaming `done` path shares that refresh and must not flash empty.
            setConversationRecords([]);
            setSelectedRecord(null);
            setView('chat');
            // Load this conversation's tool-call audit records so the transcript's
            // tool calls link to their exact invocation detail and the tools-used
            // feed populates. Fire-and-forget: it must not gate reopening the chat.
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
    const modelLabel = useMemo(
        () => new Map(models.map(model => [model.id, model.display_name])),
        [models]
    );
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
                    {models.length > 0
                        ? <>Active provider ready — <span className={styles.provider_label}>{models.length}</span> model{models.length === 1 ? '' : 's'} available.</>
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
                                const usage = turn.usage;
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
                                                <div className={styles.turn_text}>{turn.content}</div>
                                            ) : turn.segments && turn.segments.length > 0 ? (
                                                // A settled turn (live `done` or reopened from history) renders its
                                                // full transcript — thinking, tool calls, results, and text in order.
                                                // The audit-record map lets each tool call deep-link to its record.
                                                <AssistantSegments segments={turn.segments} recordsById={toolRecordsById} onSelectRecord={setSelectedRecord} />
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
                    </div>

                    <div className={styles.composer}>
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
                        <details
                            className={styles.composer_tools}
                            onToggle={(e) => setToolsOpen(e.currentTarget.open)}
                        >
                            <summary className={styles.composer_tools_summary}>
                                <Wrench size={16} />
                                Tools — {toolSelection.length === 0
                                    ? 'none (default)'
                                    : `${toolSelection.length} selected`}
                            </summary>
                            <div className={styles.composer_tools_body}>
                                <p className={styles.composer_tools_hint}>
                                    Registry tools this query may call. Defaults to none — grant only what
                                    this run needs. Provider-hosted tools (web search / fetch), when enabled
                                    for the model, still run regardless of this selection. Naming a tool
                                    that is disabled or removed fails the run.
                                </p>
                                <ToolAllowlistPicker
                                    tools={tools}
                                    selected={toolSelection}
                                    onChange={setToolSelection}
                                    disabled={streaming}
                                />
                                <RunTrifectaBadge status={trifecta} loading={trifectaLoading} />
                            </div>
                        </details>
                        <div className={styles.composer_toolbar}>
                            {models.length > 0 && (
                                <Select
                                    value={modelOverride}
                                    onChange={(e) => setModelOverride(e.target.value)}
                                    className={styles.model_select}
                                    aria-label="Model for the next message"
                                    title="Model for the next message — Default uses the provider's configured model"
                                >
                                    <option value="">Default model</option>
                                    {models.map(model => (
                                        <option key={model.id} value={model.id}>{model.display_name}</option>
                                    ))}
                                </Select>
                            )}
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
                                        disabled={!input.trim()}
                                        aria-label="Send message"
                                    >
                                        <Send size={18} /> Send
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </Card>
                {conversationRecords.length > 0 && (
                    <details className={styles.tools_used}>
                        <summary className={styles.tools_used_summary}>
                            <Wrench size={16} /> Tools used in this conversation ({conversationRecords.length})
                        </summary>
                        <div className={styles.tools_used_body}>
                            <InvocationTable records={conversationRecords} onSelect={setSelectedRecord} />
                        </div>
                    </details>
                )}
                <SavedPromptsPanel
                    prompts={savedPrompts}
                    onPromptsChange={setSavedPrompts}
                    currentPromptText={input}
                    onLoadPromptText={(text) => { setInput(text); textareaRef.current?.focus(); }}
                    onRun={(sp) => { void handleRunSavedPrompt(sp); }}
                    onError={setError}
                />
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
                                                onClick={() => { void openConversation(group.conversationId); }}
                                                aria-label={`Open conversation starting "${group.firstPrompt}" in chat`}
                                            >
                                                <MessageSquare size={16} /> Open in chat
                                            </Button>
                                        </div>
                                        {isExpanded && (
                                            // Full-width tool-call detail beneath the row (spans all three
                                            // grid tracks). Fetched lazily on first expand: a spinner while
                                            // loading, the inline error on failure, the invocation table when
                                            // the conversation ran tools, or a plain note when it ran none.
                                            <div className={styles.history_item_tools}>
                                                {historyToolLoading.has(group.conversationId) ? (
                                                    <span className={styles.history_item_tools_note}>Loading tool calls…</span>
                                                ) : historyToolError.has(group.conversationId) ? (
                                                    <span className={styles.history_item_tools_note} role="alert">
                                                        {historyToolError.get(group.conversationId)}
                                                    </span>
                                                ) : (historyToolRecords.get(group.conversationId)?.length ?? 0) > 0 ? (
                                                    <InvocationTable
                                                        records={historyToolRecords.get(group.conversationId) as IToolInvocationRecord[]}
                                                        onSelect={setSelectedRecord}
                                                    />
                                                ) : (
                                                    <span className={styles.history_item_tools_note}>No tool calls in this conversation.</span>
                                                )}
                                            </div>
                                        )}
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
