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
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Send, Bot, User, AlertCircle, X, Copy, CheckCircle, Plus, History, MessageSquare, RefreshCw } from 'lucide-react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type { IAiConversationMessage, IAiQueryRecord, IAiStreamChunk, IModelInfo, ISavedPrompt } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { IconButton } from '../../../../../components/ui/IconButton';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { getSocket } from '../../../../../lib/socketClient';
import {
    submitQuery,
    cancelQuery,
    getQueryHistory,
    getConversation,
    getQueryModels,
    type IStreamAck
} from '../../../../../modules/ai-tools';
import { SavedPromptsPanel } from './SavedPromptsPanel';
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
}

/** A run of consecutive history records sharing one `conversationId`. */
interface ConversationGroup {
    conversationId: string;
    turns: number;
    firstPrompt: string;
    lastAt: string;
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
        const existing = byId.get(id);
        if (existing) {
            existing.turns += 1;
            // Records arrive newest-first, so an earlier record carries the
            // older prompt — keep it as the conversation's opening line.
            existing.firstPrompt = record.prompt;
        } else {
            order.push(id);
            byId.set(id, { conversationId: id, turns: 1, firstPrompt: record.prompt, lastAt: record.createdAt });
        }
    }
    return order.map(id => byId.get(id) as ConversationGroup);
}

/**
 * Query tab content. Owns the chat transcript, the streaming lifecycle keyed by
 * a per-send `queryId`, the model picker, and the grouped history view.
 *
 * @returns The tab.
 */
export function QueryTab() {
    const [messages, setMessages] = useState<ChatTurn[]>([]);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [models, setModels] = useState<IModelInfo[]>([]);
    const [modelOverride, setModelOverride] = useState<string>('');
    const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null);
    const [view, setView] = useState<'chat' | 'history'>('chat');
    const [conversations, setConversations] = useState<ConversationGroup[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    /** Shared saved-prompts list; the panel loads it on first open and the composer reads it. */
    const [savedPrompts, setSavedPrompts] = useState<ISavedPrompt[]>([]);

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
            updateTurn(turnId, { pending: false, usage: chunk.usage ?? null });
            streamingTurnIdRef.current = null;
            activeQueryIdRef.current = null;
        } else if (chunk.type === 'error') {
            setStreaming(false);
            updateTurn(turnId, { pending: false, error: chunk.error || 'An unknown error occurred' });
            streamingTurnIdRef.current = null;
            activeQueryIdRef.current = null;
        }
    }, [updateTurn]);

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

    // Auto-grow the composer textarea with its content, capped by CSS max-height.
    useEffect(() => {
        const ta = textareaRef.current;
        if (ta) {
            ta.style.height = 'auto';
            ta.style.height = `${ta.scrollHeight}px`;
        }
    }, [input]);

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
                stream: true
            });
            // The streaming path acks immediately; the answer arrives over the
            // socket. A non-ack shape would mean the server didn't stream —
            // surface that rather than waiting forever for chunks.
            if (!(ack as IStreamAck).success) {
                throw new Error('Server did not start a streaming query.');
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
    }, [input, streaming, messages, modelOverride, updateTurn]);

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
    }, [streaming]);

    /**
     * Copy a turn's raw text to the clipboard, flashing a check on the button.
     *
     * @param turn - The turn whose content to copy.
     */
    const handleCopyTurn = useCallback(async (turn: ChatTurn) => {
        try {
            await navigator.clipboard.writeText(turn.content);
            setCopiedTurnId(turn.id);
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
                rebuilt.push({
                    id: generateUUID(),
                    role: 'assistant',
                    content: record.responseText ?? '',
                    model: record.model,
                    usage: record.usage,
                    error: record.responseText ? null : (record.errorMessage ?? 'No response recorded')
                });
            }
            setStreaming(false);
            setError(null);
            streamingTurnIdRef.current = null;
            activeQueryIdRef.current = null;
            conversationIdRef.current = conversationId;
            setMessages(rebuilt);
            setView('chat');
        } catch (err) {
            if (isMountedRef.current) {
                setHistoryError(err instanceof Error ? err.message : 'Failed to open conversation');
            }
        }
    }, []);

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
                <SavedPromptsPanel
                    prompts={savedPrompts}
                    onPromptsChange={setSavedPrompts}
                    currentPromptText={input}
                    onLoadPromptText={(text) => { setInput(text); textareaRef.current?.focus(); }}
                    onError={setError}
                />
                <Card className={styles.chat_card}>
                    <div className={styles.chat_header}>
                        <Bot size={16} className={styles.chat_header_icon} />
                        <span className={styles.chat_header_label}>Conversation</span>
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
                                                        onClick={() => { void handleCopyTurn(turn); }}
                                                        aria-label="Copy message to clipboard"
                                                    >
                                                        {copiedTurnId === turn.id ? <CheckCircle size={14} /> : <Copy size={14} />}
                                                    </IconButton>
                                                )}
                                            </div>

                                            {isUser ? (
                                                <div className={styles.turn_text}>{turn.content}</div>
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
                        <textarea
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
                        <div className={styles.composer_toolbar}>
                            {models.length > 0 && (
                                <select
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
                                </select>
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
                                {conversations.map(group => (
                                    <li key={group.conversationId} className={styles.history_item}>
                                        <div className={styles.history_item_main}>
                                            <span className={styles.history_item_prompt}>{group.firstPrompt}</span>
                                            <span className={styles.history_item_meta}>
                                                <ClientTime date={group.lastAt} format="datetime" />
                                                <span>· {group.turns} turn{group.turns === 1 ? '' : 's'}</span>
                                            </span>
                                        </div>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => { void openConversation(group.conversationId); }}
                                            aria-label={`Open conversation starting "${group.firstPrompt}" in chat`}
                                        >
                                            <MessageSquare size={16} /> Open in chat
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                </Stack>
            )}
        </div>
    );
}
